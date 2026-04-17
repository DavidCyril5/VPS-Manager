import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { Client as SshClient } from "ssh2";
import { connectDB, Server, Site, decryptSecret } from "./lib/db";
import app from "./app";
import { logger } from "./lib/logger";
import { runSshCommand } from "./lib/ssh";

// --- Auto log-clear background job ---
// Every 10 minutes, check every nodejs/python site's PM2 log file sizes.
// If either log file exceeds the site's logSizeLimitMb, truncate it in-place
// (same safe method as manual clean-logs) so the running process is never disturbed.
async function autoCleanLogsIfNeeded(): Promise<void> {
  try {
    const sites = await Site.find({ siteType: { $in: ["nodejs", "python"] } });
    for (const site of sites) {
      const siteData = site.toObject() as Record<string, unknown>;
      const limitMb = (siteData.logSizeLimitMb as number | null) ?? 50;
      const pm2Name = (siteData.domain as string).replace(/[^a-zA-Z0-9]/g, "-");
      const server = await Server.findOne({ id: siteData.serverId });
      if (!server) continue;
      const s = server.toObject() as Record<string, unknown>;
      const sshOpts = {
        host: s.host as string,
        port: s.port as number,
        username: s.username as string,
        password: decryptSecret(s.password as string),
        privateKey: s.privateKey ? decryptSecret(s.privateKey as string) : null,
      };
      // Check combined size of out + error log in bytes, then truncate if over limit
      const checkAndClear = [
        `OUT=~/.pm2/logs/${pm2Name}-out.log`,
        `ERR=~/.pm2/logs/${pm2Name}-error.log`,
        `LIMIT=$((${limitMb} * 1024 * 1024))`,
        `OUT_SIZE=$(stat -c%s "$OUT" 2>/dev/null || echo 0)`,
        `ERR_SIZE=$(stat -c%s "$ERR" 2>/dev/null || echo 0)`,
        `if [ "$OUT_SIZE" -gt "$LIMIT" ] || [ "$ERR_SIZE" -gt "$LIMIT" ]; then`,
        `  truncate -s 0 "$OUT" 2>/dev/null`,
        `  truncate -s 0 "$ERR" 2>/dev/null`,
        `  echo "auto-cleared"`,
        `else`,
        `  echo "ok"`,
        `fi`,
      ].join("; ");
      const result = await runSshCommand(sshOpts, checkAndClear, 15000).catch(() => null);
      if (result?.output?.includes("auto-cleared")) {
        logger.info({ domain: siteData.domain, limitMb }, "Auto-cleared PM2 logs (size limit reached)");
      }
    }
  } catch (err) {
    logger.error({ err }, "Auto log-clear job failed");
  }
}

const LOG_CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = createServer(app);

// WebSocket SSH Terminal
const wss = new WebSocketServer({ server: httpServer, path: "/api/terminal" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "", `http://localhost`);
  const serverId = Number(url.searchParams.get("serverId"));

  if (!serverId) {
    ws.send(JSON.stringify({ type: "error", data: "serverId is required\r\n" }));
    ws.close();
    return;
  }

  let sshConn: InstanceType<typeof SshClient> | null = null;
  let sshStream: ReturnType<InstanceType<typeof SshClient>["shell"]> extends Promise<infer T> ? T : unknown = null as unknown;

  Server.findOne({ id: serverId }).then((server) => {
    if (!server) {
      ws.send(JSON.stringify({ type: "error", data: "Server not found\r\n" }));
      ws.close();
      return;
    }

    const s = server.toObject() as Record<string, unknown>;
    sshConn = new SshClient();

    sshConn.on("ready", () => {
      ws.send(JSON.stringify({ type: "data", data: `\x1b[32mConnected to ${s.host}\x1b[0m\r\n` }));

      sshConn!.shell({ term: "xterm-256color", cols: 220, rows: 50 }, (err, stream) => {
        if (err) {
          ws.send(JSON.stringify({ type: "error", data: `Shell error: ${err.message}\r\n` }));
          ws.close();
          return;
        }

        sshStream = stream as unknown;

        (stream as NodeJS.ReadableStream).on("data", (data: Buffer) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "data", data: data.toString("binary") }));
          }
        });

        (stream as NodeJS.EventEmitter & { stderr: NodeJS.ReadableStream }).stderr.on("data", (data: Buffer) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "data", data: data.toString("binary") }));
          }
        });

        (stream as NodeJS.EventEmitter).on("close", () => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "exit", data: "" }));
            ws.close();
          }
        });

        ws.on("message", (msg) => {
          try {
            const parsed = JSON.parse(msg.toString());
            if (parsed.type === "data" && sshStream) {
              (sshStream as NodeJS.WritableStream).write(parsed.data);
            } else if (parsed.type === "resize" && sshStream) {
              (stream as unknown as { setWindow: (rows: number, cols: number, height: number, width: number) => void }).setWindow(
                parsed.rows ?? 50,
                parsed.cols ?? 220,
                0,
                0
              );
            }
          } catch {
            // ignore malformed messages
          }
        });
      });
    });

    sshConn.on("error", (err) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "error", data: `SSH error: ${err.message}\r\n` }));
        ws.close();
      }
    });

    const connectOpts: Record<string, unknown> = {
      host: s.host,
      port: s.port,
      username: s.username,
      readyTimeout: 15000,
    };

    if (s.privateKey) {
      connectOpts.privateKey = decryptSecret(s.privateKey as string);
    } else {
      connectOpts.password = decryptSecret(s.password as string);
    }

    sshConn.connect(connectOpts as Parameters<InstanceType<typeof SshClient>["connect"]>[0]);
  }).catch((err: Error) => {
    logger.error({ err }, "Terminal: DB error");
    ws.close();
  });

  ws.on("close", () => {
    if (sshConn) {
      sshConn.end();
    }
  });
});

// Connect to MongoDB then start listening
connectDB()
  .then(() => {
    logger.info("Connected to MongoDB");
    // Start auto log-clear background job
    setInterval(() => { void autoCleanLogsIfNeeded(); }, LOG_CHECK_INTERVAL_MS);
    logger.info({ intervalMs: LOG_CHECK_INTERVAL_MS }, "Auto log-clear job scheduled");
    httpServer.listen(port, (err?: Error) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
    });
  })
  .catch((err: Error) => {
    logger.error({ err }, "Failed to connect to MongoDB");
    process.exit(1);
  });
