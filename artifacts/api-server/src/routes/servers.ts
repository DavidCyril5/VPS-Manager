import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, serversTable, activityTable } from "@workspace/db";
import {
  CreateServerBody,
  UpdateServerBody,
  GetServerParams,
  UpdateServerParams,
  DeleteServerParams,
  TestServerConnectionParams,
  InstallNginxParams,
  GetServerStatsParams,
} from "@workspace/api-zod";
import { testSshConnection, runSshCommand } from "../lib/ssh";

const router: IRouter = Router();

router.get("/servers", async (req, res): Promise<void> => {
  const servers = await db.select().from(serversTable).orderBy(desc(serversTable.createdAt));
  res.json(servers.map(s => ({ ...s, password: undefined, privateKey: undefined })));
});

router.post("/servers", async (req, res): Promise<void> => {
  const parsed = CreateServerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [server] = await db.insert(serversTable).values(parsed.data).returning();
  res.status(201).json({ ...server, password: undefined, privateKey: undefined });
});

router.get("/servers/:id", async (req, res): Promise<void> => {
  const params = GetServerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [server] = await db.select().from(serversTable).where(eq(serversTable.id, params.data.id));
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  res.json({ ...server, password: undefined, privateKey: undefined });
});

router.patch("/servers/:id", async (req, res): Promise<void> => {
  const params = UpdateServerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateServerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [server] = await db.update(serversTable).set(parsed.data).where(eq(serversTable.id, params.data.id)).returning();
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  res.json({ ...server, password: undefined, privateKey: undefined });
});

router.delete("/servers/:id", async (req, res): Promise<void> => {
  const params = DeleteServerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [server] = await db.delete(serversTable).where(eq(serversTable.id, params.data.id)).returning();
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  res.sendStatus(204);
});

router.post("/servers/:id/test-connection", async (req, res): Promise<void> => {
  const params = TestServerConnectionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [server] = await db.select().from(serversTable).where(eq(serversTable.id, params.data.id));
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const result = await testSshConnection({
    host: server.host,
    port: server.port,
    username: server.username,
    password: server.password,
    privateKey: server.privateKey,
  });

  await db.update(serversTable)
    .set({ status: result.success ? "connected" : "disconnected" })
    .where(eq(serversTable.id, server.id));

  await db.insert(activityTable).values({
    serverId: server.id,
    type: "connection_test",
    status: result.success ? "success" : "failure",
    message: result.success ? `Connection to ${server.host} successful` : `Connection to ${server.host} failed`,
    details: result.output ?? result.message,
  });

  res.json(result);
});

router.post("/servers/:id/install-nginx", async (req, res): Promise<void> => {
  const params = InstallNginxParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [server] = await db.select().from(serversTable).where(eq(serversTable.id, params.data.id));
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const installScript = `
    export DEBIAN_FRONTEND=noninteractive && \
    apt-get update -qq && \
    apt-get install -y nginx certbot python3-certbot-nginx git curl && \
    systemctl enable nginx && \
    systemctl start nginx && \
    echo "Nginx installed and started successfully"
  `.trim();

  const result = await runSshCommand(
    { host: server.host, port: server.port, username: server.username, password: server.password, privateKey: server.privateKey },
    installScript,
    120000
  );

  if (result.success) {
    await db.update(serversTable).set({ nginxInstalled: true }).where(eq(serversTable.id, server.id));
  }

  await db.insert(activityTable).values({
    serverId: server.id,
    type: "nginx_install",
    status: result.success ? "success" : "failure",
    message: result.success ? "Nginx installed successfully" : "Nginx installation failed",
    details: result.output,
  });

  res.json(result);
});

router.get("/servers/:id/stats", async (req, res): Promise<void> => {
  const params = GetServerStatsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [server] = await db.select().from(serversTable).where(eq(serversTable.id, params.data.id));
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const statsCmd = `
    echo "CPU:$(top -bn1 | grep 'Cpu(s)' | awk '{print $2+$4}')" && \
    echo "MEM:$(free -m | awk 'NR==2{print $3":"$2}')" && \
    echo "DISK:$(df / | awk 'NR==2{print $3":"$2}')" && \
    echo "UPTIME:$(uptime -p)"
  `.trim();

  const result = await runSshCommand(
    { host: server.host, port: server.port, username: server.username, password: server.password, privateKey: server.privateKey },
    statsCmd,
    20000
  );

  if (!result.success) {
    res.json({ cpu: 0, memoryUsed: 0, memoryTotal: 0, diskUsed: 0, diskTotal: 0, uptime: "unknown" });
    return;
  }

  const lines = result.output.split("\n");
  let cpu = 0, memoryUsed = 0, memoryTotal = 0, diskUsed = 0, diskTotal = 0, uptime = "unknown";

  for (const line of lines) {
    if (line.startsWith("CPU:")) {
      cpu = parseFloat(line.replace("CPU:", "")) || 0;
    } else if (line.startsWith("MEM:")) {
      const parts = line.replace("MEM:", "").split(":");
      memoryUsed = parseInt(parts[0] ?? "0", 10);
      memoryTotal = parseInt(parts[1] ?? "0", 10);
    } else if (line.startsWith("DISK:")) {
      const parts = line.replace("DISK:", "").split(":");
      diskUsed = parseInt(parts[0] ?? "0", 10) * 1024;
      diskTotal = parseInt(parts[1] ?? "0", 10) * 1024;
    } else if (line.startsWith("UPTIME:")) {
      uptime = line.replace("UPTIME:", "").trim();
    }
  }

  res.json({ cpu, memoryUsed, memoryTotal, diskUsed, diskTotal, uptime });
});

export default router;
