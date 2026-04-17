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

// --- Memory watchdog + CPU alert + stats history background job ---
// Runs every 10 minutes. For each connected server:
//   1. Collects CPU/memory and appends to a rolling 24-point history
//   2. Restarts any PM2 app exceeding the server memoryLimitMb threshold
//   3. Sends a webhook alert if CPU stays above cpuAlertThreshold 2 checks in a row

const cpuHighStreak = new Map<number, number>(); // serverId -> consecutive high-cpu count

async function serverHealthJob(): Promise<void> {
  try {
    const servers = await Server.find({ status: "connected" });
    for (const server of servers) {
      const s = server.toObject() as Record<string, unknown>;
      const sshOpts = {
        host: s.host as string,
        port: s.port as number,
        username: s.username as string,
        password: decryptSecret(s.password as string),
        privateKey: s.privateKey ? decryptSecret(s.privateKey as string) : null,
      };
      const serverId = s.id as number;
      const memLimitMb = (s.memoryLimitMb as number | null) ?? 512;
      const cpuThreshold = (s.cpuAlertThreshold as number | null) ?? 85;

      // Collect stats + PM2 process list in one SSH call
      const statsCmd = [
        `echo "CPU:$(top -bn1 | grep 'Cpu(s)' | awk '{print $2+$4}')"`,
        `echo "MEM:$(free -m | awk 'NR==2{print $3\":\"$2}')"`,
        `pm2 jlist 2>/dev/null || echo "[]"`,
      ].join(" && ");

      const result = await runSshCommand(sshOpts, statsCmd, 20000).catch(() => null);
      if (!result?.success) continue;

      const lines = result.output.split("\n");
      let cpu = 0, memUsed = 0, memTotal = 0, pm2Json = "[]";
      for (const line of lines) {
        if (line.startsWith("CPU:")) cpu = parseFloat(line.replace("CPU:", "")) || 0;
        else if (line.startsWith("MEM:")) {
          const parts = line.replace("MEM:", "").split(":");
          memUsed = parseInt(parts[0] ?? "0", 10);
          memTotal = parseInt(parts[1] ?? "0", 10);
        } else if (line.trim().startsWith("[")) pm2Json = line.trim();
      }

      // 1. Append to stats history (rolling 24 points)
      const history = ((s.statsHistory as unknown[]) ?? []).slice(-23);
      history.push({ ts: new Date(), cpu, memoryUsed: memUsed, memoryTotal: memTotal });
      await Server.findOneAndUpdate({ id: serverId }, { statsHistory: history, updatedAt: new Date() });

      // 2. PM2 memory watchdog
      if (memLimitMb > 0) {
        try {
          const pm2List = JSON.parse(pm2Json) as Array<Record<string, unknown>>;
          for (const proc of pm2List) {
            const memBytes = ((proc.monit as Record<string, number>)?.memory) ?? 0;
            const memMb = Math.round(memBytes / 1024 / 1024);
            const procName = proc.name as string;
            if (memMb > memLimitMb) {
              await runSshCommand(sshOpts, `pm2 restart "${procName}" 2>&1`, 15000).catch(() => null);
              logger.warn({ serverId, procName, memMb, memLimitMb }, "Memory watchdog: restarted oversize PM2 process");
            }
          }
        } catch { /* pm2 jlist unavailable or parse failed - skip this cycle */ }
      }

      // 3. CPU spike alert (webhook after 2 consecutive high readings)
      if (cpuThreshold > 0) {
        const streak = (cpuHighStreak.get(serverId) ?? 0);
        if (cpu >= cpuThreshold) {
          const newStreak = streak + 1;
          cpuHighStreak.set(serverId, newStreak);
          if (newStreak >= 2) {
            try {
              const settings = await (await import("./lib/db")).getSettings();
              const webhookUrl = settings.alertWebhookUrl as string | null;
              if (webhookUrl) {
                const payload = JSON.stringify({
                  event: "high_cpu", server: s.name, host: s.host,
                  cpu: `${cpu.toFixed(1)}%`, threshold: `${cpuThreshold}%`,
                  consecutiveChecks: newStreak, timestamp: new Date().toISOString(),
                });
                const parsed = new URL(webhookUrl);
                const mod = parsed.protocol === "https:" ? (await import("https")).default : (await import("http")).default;
                await new Promise<void>((resolve) => {
                  const req = mod.request(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } }, () => resolve());
                  req.on("error", () => resolve());
                  req.write(payload); req.end();
                });
                logger.warn({ serverId, cpu, cpuThreshold, streak: newStreak }, "CPU alert webhook fired");
              }
            } catch { /* webhook failure is non-fatal */ }
          }
        } else {
          cpuHighStreak.set(serverId, 0);
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "Server health job failed");
  }
}

const HEALTH_CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

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
    // Start server health job (memory watchdog + CPU alerts + stats history)
    setInterval(() => { void serverHealthJob(); }, HEALTH_CHECK_INTERVAL_MS);
    logger.info({ intervalMs: HEALTH_CHECK_INTERVAL_MS }, "Server health job scheduled");
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
