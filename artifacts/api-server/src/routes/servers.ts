import { Router, type IRouter } from "express";
import { Server, Site, Activity, nextId } from "../lib/db";
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

function safeServer(doc: Record<string, unknown>) {
  const { password: _p, privateKey: _k, ...rest } = doc;
  return rest;
}

router.get("/servers", async (_req, res): Promise<void> => {
  const servers = await Server.find().sort({ createdAt: -1 });
  res.json(servers.map((s) => safeServer(s.toObject() as Record<string, unknown>)));
});

router.post("/servers", async (req, res): Promise<void> => {
  const parsed = CreateServerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const id = await nextId("servers");
  const data = { ...parsed.data };
  const server = await Server.create({ id, ...data, createdAt: new Date(), updatedAt: new Date() });
  res.status(201).json(safeServer(server.toObject() as Record<string, unknown>));
});

router.get("/servers/:id", async (req, res): Promise<void> => {
  const params = GetServerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const server = await Server.findOne({ id: params.data.id });
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  res.json(safeServer(server.toObject() as Record<string, unknown>));
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
  const updateData = { ...parsed.data } as Record<string, unknown>;
  const server = await Server.findOneAndUpdate(
    { id: params.data.id },
    { ...updateData, updatedAt: new Date() },
    { returnDocument: "after" }
  );
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  res.json(safeServer(server.toObject() as Record<string, unknown>));
});

router.delete("/servers/:id", async (req, res): Promise<void> => {
  const params = DeleteServerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const server = await Server.findOneAndDelete({ id: params.data.id });
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
  const server = await Server.findOne({ id: params.data.id });
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  const s = server.toObject() as Record<string, unknown>;

  const result = await testSshConnection({
    host: s.host as string,
    port: s.port as number,
    username: s.username as string,
    password: s.password as string,
    privateKey: s.privateKey ? s.privateKey as string : null,
  });

  await Server.findOneAndUpdate(
    { id: s.id },
    { status: result.success ? "connected" : "disconnected", updatedAt: new Date() }
  );

  const actId = await nextId("activity");
  await Activity.create({
    id: actId,
    serverId: s.id,
    type: "connection_test",
    status: result.success ? "success" : "failure",
    message: result.success
      ? `Connection to ${s.host} successful`
      : `Connection to ${s.host} failed`,
    details: result.output ?? result.message,
    createdAt: new Date(),
  });

  res.json(result);
});

router.post("/servers/:id/install-nginx", async (req, res): Promise<void> => {
  const params = InstallNginxParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const server = await Server.findOne({ id: params.data.id });
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  const s = server.toObject() as Record<string, unknown>;

  const installScript = `
    export DEBIAN_FRONTEND=noninteractive && \
    apt-get update -qq && \
    apt-get install -y nginx certbot python3-certbot-nginx git curl && \
    systemctl enable nginx && \
    systemctl start nginx && \
    echo "Nginx installed and started successfully"
  `.trim();

  const result = await runSshCommand(
    { host: s.host as string, port: s.port as number, username: s.username as string, password: s.password as string, privateKey: s.privateKey ? s.privateKey as string : null },
    installScript,
    120000
  );

  if (result.success) {
    await Server.findOneAndUpdate({ id: s.id }, { nginxInstalled: true, updatedAt: new Date() });
  }

  const actId = await nextId("activity");
  await Activity.create({
    id: actId,
    serverId: s.id,
    type: "nginx_install",
    status: result.success ? "success" : "failure",
    message: result.success ? "Nginx installed successfully" : "Nginx installation failed",
    details: result.output,
    createdAt: new Date(),
  });

  res.json(result);
});

router.post("/servers/:id/install-node", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const server = await Server.findOne({ id });
  if (!server) { res.status(404).json({ error: "Server not found" }); return; }
  const s = server.toObject() as Record<string, unknown>;

  const script = `
    export DEBIAN_FRONTEND=noninteractive && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    node -v && npm -v && \
    echo "Node.js installed successfully"
  `.trim();

  const result = await runSshCommand(
    { host: s.host as string, port: s.port as number, username: s.username as string, password: s.password as string, privateKey: s.privateKey ? s.privateKey as string : null },
    script,
    120000
  );

  await Activity.create({
    id: await nextId("activity"),
    serverId: s.id,
    type: "node_install",
    status: result.success ? "success" : "failure",
    message: result.success ? "Node.js installed successfully" : "Node.js installation failed",
    details: result.output,
    createdAt: new Date(),
  });

  res.json(result);
});

router.get("/servers/:id/node-status", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const server = await Server.findOne({ id });
  if (!server) { res.status(404).json({ error: "Server not found" }); return; }
  const s = server.toObject() as Record<string, unknown>;

  const result = await runSshCommand(
    { host: s.host as string, port: s.port as number, username: s.username as string, password: s.password as string, privateKey: s.privateKey ? s.privateKey as string : null },
    "node -v && npm -v 2>&1",
    15000
  );

  const installed = result.success && result.output.includes("v");
  const version = result.output.match(/v(\d+\.\d+\.\d+)/)?.[1] ?? null;
  res.json({ installed, version, output: result.output });
});

router.get("/servers/:id/nginx-status", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const server = await Server.findOne({ id });
  if (!server) { res.status(404).json({ error: "Server not found" }); return; }
  const s = server.toObject() as Record<string, unknown>;

  const result = await runSshCommand(
    { host: s.host as string, port: s.port as number, username: s.username as string, password: s.password as string, privateKey: s.privateKey ? s.privateKey as string : null },
    "which nginx && nginx -v 2>&1 && systemctl is-active nginx 2>/dev/null || echo 'not-running'",
    15000
  );

  const installed = result.success && result.output.includes("nginx");
  await Server.findOneAndUpdate({ id }, { nginxInstalled: installed, updatedAt: new Date() });

  res.json({ installed, version: result.output.match(/nginx\/([^\s]+)/)?.[1] ?? null, output: result.output });
});

router.get("/servers/:id/stats", async (req, res): Promise<void> => {
  const params = GetServerStatsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const server = await Server.findOne({ id: params.data.id });
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  const s = server.toObject() as Record<string, unknown>;

  const statsCmd = `
    echo "CPU:$(top -bn1 | grep 'Cpu(s)' | awk '{print $2+$4}')" && \
    echo "MEM:$(free -m | awk 'NR==2{print $3":"$2}')" && \
    echo "DISK:$(df / | awk 'NR==2{print $3":"$2}')" && \
    echo "UPTIME:$(uptime -p)"
  `.trim();

  const result = await runSshCommand(
    { host: s.host as string, port: s.port as number, username: s.username as string, password: s.password as string, privateKey: s.privateKey ? s.privateKey as string : null },
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

const RESERVED_PORTS = new Set([
  3306, 5432, 5433, 6379, 6000, 6001, 8080, 8443, 8888, 9090, 9200, 9300,
  27017, 27018, 11211, 2181, 2375, 2376,
]);

router.get("/servers/:id/available-port", async (req, res): Promise<void> => {
  const params = GetServerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const server = await Server.findOne({ id: params.data.id });
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  const s = server.toObject() as Record<string, unknown>;
  const sshOpts = {
    host: s.host as string,
    port: s.port as number,
    username: s.username as string,
    password: s.password as string,
    privateKey: s.privateKey ? (s.privateKey as string) : null,
  };

  const serverUsedPorts = new Set<number>();
  const result = await runSshCommand(
    sshOpts,
    "ss -tlnp 2>/dev/null | awk 'NR>1 {print $4}' | grep -oE '[0-9]+$' | sort -un",
    10000
  ).catch(() => null);
  if (result?.success) {
    for (const line of result.output.split("\n")) {
      const p = parseInt(line.trim(), 10);
      if (!isNaN(p) && p > 0) serverUsedPorts.add(p);
    }
  }

  const dbUsedPorts = new Set<number>();
  const sites = await Site.find({ serverId: params.data.id, port: { $ne: null } });
  for (const site of sites) {
    const p = (site.toObject() as Record<string, unknown>).port as number | null;
    if (p) dbUsedPorts.add(p);
  }

  let port = 3001;
  while (port <= 9999) {
    if (!serverUsedPorts.has(port) && !dbUsedPorts.has(port) && !RESERVED_PORTS.has(port)) break;
    port++;
  }

  if (port > 9999) {
    res.status(503).json({ error: "No available ports found in range 3001–9999" });
    return;
  }

  res.json({ port });
});

router.post("/servers/:id/setup-watchdog", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const server = await Server.findOne({ id });
  if (!server) { res.status(404).json({ error: "Server not found" }); return; }
  const s = server.toObject() as Record<string, unknown>;
  const sshOpts = {
    host: s.host as string, port: s.port as number,
    username: s.username as string, password: s.password as string,
    privateKey: s.privateKey ? (s.privateKey as string) : null,
  };

  // The watchdog script checks every minute (via cron) if any PM2 app is
  // not "online" and force-restarts it from the permanent config file.
  // It also handles nvm-installed pm2 which isn't in the default cron PATH.
  const watchdogScript = `#!/bin/bash
# Auto-generated by VPS Manager — do not edit manually
PM2=$(command -v pm2 2>/dev/null)
if [ -z "$PM2" ]; then
  for d in /root/.nvm/versions/node/*/bin; do
    [ -x "$d/pm2" ] && PM2="$d/pm2" && break
  done
fi
[ -n "$PM2" ] || exit 0
mkdir -p /root/.pm2-apps
for config in /root/.pm2-apps/*.json; do
  [ -f "$config" ] || continue
  name=$(basename "$config" .json)
  if ! $PM2 list --no-color 2>/dev/null | grep -F "$name" | grep -q "online"; then
    logger "[pm2-watchdog] $name not running — restarting"
    $PM2 delete "$name" 2>/dev/null
    $PM2 start "$config" 2>/dev/null
    $PM2 save 2>/dev/null
  fi
done`;

  const setup = [
    `mkdir -p /root/.pm2-apps`,
    `cat > /usr/local/bin/pm2-watchdog.sh << 'ENDSCRIPT'\n${watchdogScript}\nENDSCRIPT`,
    `chmod +x /usr/local/bin/pm2-watchdog.sh`,
    `(crontab -l 2>/dev/null | grep -v pm2-watchdog; echo '* * * * * /usr/local/bin/pm2-watchdog.sh >> /var/log/pm2-watchdog.log 2>&1') | crontab -`,
    `pm2 startup systemd -u root --hp /root 2>&1 || pm2 startup 2>&1`,
    `pm2 save 2>&1`,
    `echo "Watchdog active. Runs every minute via cron. PM2 startup configured for reboots."`,
  ].join(" && ");

  const result = await runSshCommand(sshOpts, setup, 60000);

  const actId = await nextId("activity");
  await Activity.create({
    id: actId,
    serverId: id,
    siteId: null,
    type: "connection_test",
    status: result.success ? "success" : "failure",
    message: result.success
      ? `PM2 watchdog installed on ${s.name ?? s.host} — sites restart automatically if crashed`
      : `Watchdog setup failed on ${s.name ?? s.host}`,
    details: result.output,
    createdAt: new Date(),
  });

  res.json(result);
});

export default router;
