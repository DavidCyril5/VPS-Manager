import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { Client as SshClient } from "ssh2";
import { eq } from "drizzle-orm";
import { db, serversTable } from "@workspace/db";
import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = createServer(app);

// WebSocket SSH Terminal
const wss = new WebSocketServer({ server, path: "/api/terminal" });

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

  db.select().from(serversTable).where(eq(serversTable.id, serverId)).then(([server]) => {
    if (!server) {
      ws.send(JSON.stringify({ type: "error", data: "Server not found\r\n" }));
      ws.close();
      return;
    }

    sshConn = new SshClient();

    sshConn.on("ready", () => {
      ws.send(JSON.stringify({ type: "data", data: `\x1b[32mConnected to ${server.host}\x1b[0m\r\n` }));

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
      host: server.host,
      port: server.port,
      username: server.username,
      readyTimeout: 15000,
    };

    if (server.privateKey) {
      connectOpts.privateKey = server.privateKey;
    } else {
      connectOpts.password = server.password;
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

server.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});
