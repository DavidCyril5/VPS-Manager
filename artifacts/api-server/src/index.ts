import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { Client as SshClient } from "ssh2";
import { connectDB, Server, Site } from "./lib/db";
import app from "./app";
import { logger } from "./lib/logger";
import { runSshCommand } from "./lib/ssh";

// --- Auto log-clear background job ---
// Groups sites by server so we open only one SSH connection per server.
// For each PM2-managed site (nodejs/python), resolves the actual log file paths
// via `pm2 jlist` (falling back to the default ~/.pm2/logs/ pattern), then
// checks each log file individually: if it exceeds the configured limit it is
// truncated in-place with `truncate -s 0` so the running process keeps its
// file-descriptor open and is never interrupted.

function buildAutoCleanScript(
  sites: Array<{ pm2Name: string; limitBytes: number; domain: string }>
): string {
  // Each site runs inside a subshell so a failure for one never stops the others.
  const perSiteBlocks = sites.map(({ pm2Name, limitBytes, domain }) => `
(
  OUT="$HOME/.pm2/logs/${pm2Name}-out.log"
  ERR="$HOME/.pm2/logs/${pm2Name}-error.log"
  if command -v pm2 >/dev/null 2>&1; then
    JLIST=$(pm2 jlist 2>/dev/null || echo '[]')
    if command -v python3 >/dev/null 2>&1; then
      PATHS=$(echo "$JLIST" | python3 -c "
import sys, json
try:
  procs = [p for p in json.load(sys.stdin) if p.get('name') == '${pm2Name}']
  if procs:
    env = procs[0].get('pm2_env', {})
    o = env.get('pm_out_log_path', '')
    e = env.get('pm_err_log_path', '')
    if o: print('OUT=' + o)
    if e: print('ERR=' + e)
except Exception:
  pass
" 2>/dev/null || true)
      [ -n "$PATHS" ] && eval "$PATHS" 2>/dev/null || true
    fi
  fi
  for LOG in "$OUT" "$ERR"; do
    [ -f "$LOG" ] || continue
    SZ=$(stat -c%s "$LOG" 2>/dev/null || echo 0)
    if [ "$SZ" -gt "${limitBytes}" ]; then
      truncate -s 0 "$LOG"
      echo "CLEARED|${domain}|$LOG|$((SZ / 1048576))"
    fi
  done
)`);
  return perSiteBlocks.join("\n");
}

async function autoCleanLogsIfNeeded(): Promise<void> {
  try {
    const sites = await Site.find({ siteType: { $in: ["nodejs", "python"] } });
    if (!sites.length) return;

    // Group sites by serverId — one SSH connection per server.
    const byServer = new Map<number, Array<{ pm2Name: string; limitBytes: number; domain: string }>>();
    for (const site of sites) {
      const d = site.toObject() as Record<string, unknown>;
      const serverId = d.serverId as number;
      const pm2Name = (d.domain as string).replace(/[^a-zA-Z0-9]/g, "-");
      const limitBytes = ((d.logSizeLimitMb as number | null) ?? 50) * 1024 * 1024;
      if (!byServer.has(serverId)) byServer.set(serverId, []);
      byServer.get(serverId)!.push({ pm2Name, limitBytes, domain: d.domain as string });
    }

    // Run all servers concurrently.
    await Promise.all(
      [...byServer.entries()].map(async ([serverId, serverSites]) => {
        const server = await Server.findOne({ id: serverId });
        if (!server) return;
        const s = server.toObject() as Record<string, unknown>;
        const sshOpts = {
          host: s.host as string,
          port: s.port as number,
          username: s.username as string,
          password: s.password as string,
          privateKey: s.privateKey ? (s.privateKey as string) : null,
        };

        const script = buildAutoCleanScript(serverSites);
        const result = await runSshCommand(sshOpts, script, 30000).catch((err: Error) => {
          logger.warn({ host: s.host, err: err.message }, "Auto log-clear: SSH failed");
          return null;
        });

        if (!result) return;

        // Parse structured output lines from the script.
        for (const line of result.output.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("CLEARED|")) continue;
          const [, domain, logPath, sizeMb] = trimmed.split("|");
          logger.info(
            { host: s.host, domain, logPath, sizeMb: `${sizeMb}MB` },
            "Auto-cleared PM2 log (size limit reached)"
          );
        }
      })
    );
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
      connectOpts.privateKey = s.privateKey as string;
    } else {
      connectOpts.password = s.password as string;
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
    // Start auto log-clear background job — run once immediately, then every 10 minutes.
    void autoCleanLogsIfNeeded();
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
