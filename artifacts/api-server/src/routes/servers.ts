import { Router, type IRouter } from "express";
import { Server, Activity, nextId, encryptSecret, decryptSecret } from "../lib/db";
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

/**
 * Encode a multi-line bash script as base64 and run it on the remote server.
 * This avoids ALL quoting/newline issues with JSON.stringify + bash -c.
 * base64 output only contains [A-Za-z0-9+/=] so single-quoting is safe.
 */
function b64script(lines: string[]): string {
  const script = lines.join("\n");
  const encoded = Buffer.from(script).toString("base64");
  return `echo '${encoded}' | base64 -d | bash`;
}

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
  if (data.password) data.password = encryptSecret(data.password);
  if (data.privateKey) data.privateKey = encryptSecret(data.privateKey);
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
  if (updateData.password) updateData.password = encryptSecret(updateData.password as string);
  if (updateData.privateKey) updateData.privateKey = encryptSecret(updateData.privateKey as string);
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
    password: decryptSecret(s.password as string),
    privateKey: s.privateKey ? decryptSecret(s.privateKey as string) : null,
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
    if command -v apt-get &>/dev/null; then
      export DEBIAN_FRONTEND=noninteractive
      sudo apt-get update -qq
      sudo apt-get install -y nginx certbot python3-certbot-nginx git curl
    elif command -v dnf &>/dev/null; then
      sudo dnf install -y nginx certbot python3-certbot-nginx git curl
    elif command -v yum &>/dev/null; then
      sudo yum install -y epel-release
      sudo yum install -y nginx certbot python3-certbot-nginx git curl
    else
      echo "ERROR: No supported package manager found (apt/dnf/yum)" && exit 1
    fi
    sudo systemctl enable nginx
    sudo systemctl start nginx
    echo "Nginx installed and started successfully"
  `.trim();

  const result = await runSshCommand(
    { host: s.host as string, port: s.port as number, username: s.username as string, password: decryptSecret(s.password as string), privateKey: s.privateKey ? decryptSecret(s.privateKey as string) : null },
    `bash -c '${installScript.replace(/'/g, "'\\''")}'`,
    180000
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
    if command -v apt-get &>/dev/null; then
      export DEBIAN_FRONTEND=noninteractive
      curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
      sudo apt-get install -y nodejs
    elif command -v dnf &>/dev/null; then
      curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
      sudo dnf install -y nodejs
    elif command -v yum &>/dev/null; then
      curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
      sudo yum install -y nodejs
    else
      echo "ERROR: No supported package manager found (apt/dnf/yum)" && exit 1
    fi
    node -v && npm -v
    echo "Node.js installed successfully"
  `.trim();

  const result = await runSshCommand(
    { host: s.host as string, port: s.port as number, username: s.username as string, password: decryptSecret(s.password as string), privateKey: s.privateKey ? decryptSecret(s.privateKey as string) : null },
    `bash -c '${script.replace(/'/g, "'\\''")}'`,
    180000
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
    { host: s.host as string, port: s.port as number, username: s.username as string, password: decryptSecret(s.password as string), privateKey: s.privateKey ? decryptSecret(s.privateKey as string) : null },
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
    { host: s.host as string, port: s.port as number, username: s.username as string, password: decryptSecret(s.password as string), privateKey: s.privateKey ? decryptSecret(s.privateKey as string) : null },
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
    { host: s.host as string, port: s.port as number, username: s.username as string, password: decryptSecret(s.password as string), privateKey: s.privateKey ? decryptSecret(s.privateKey as string) : null },
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

// --- Disk scan: show what's eating space ---
router.get("/servers/:id/disk-scan", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const server = await Server.findOne({ id });
  if (!server) { res.status(404).json({ error: "Server not found" }); return; }
  const s = server.toObject() as Record<string, unknown>;
  const sshOpts = { host: s.host as string, port: s.port as number, username: s.username as string, password: decryptSecret(s.password as string), privateKey: s.privateKey ? decryptSecret(s.privateKey as string) : null };

  // Scan key disk hogs in a single SSH call
  const cmd = [
    `echo "DFREE:$(df -h / | awk 'NR==2{print $3\"|\"$4\"|\"$5}')"`,
    `echo "NGINXLOG:$(du -sh /var/log/nginx 2>/dev/null | cut -f1 || echo '0')"`,
    `echo "JOURNAL:$(du -sh /var/log/journal 2>/dev/null | cut -f1 || journalctl --disk-usage 2>/dev/null | grep -oE '[0-9.]+ [A-Z]+' | tail -1 || echo '0')"`,
    `echo "APTCACHE:$(du -sh /var/cache/apt 2>/dev/null | cut -f1 || du -sh /var/cache/yum 2>/dev/null | cut -f1 || echo '0')"`,
    `if [ -d /etc/nginx/sites-available ]; then echo "NGINXCFG:$(ls /etc/nginx/sites-available | grep -v '^default$' | wc -l) configs in sites-available"; else echo "NGINXCFG:$(ls /etc/nginx/conf.d 2>/dev/null | grep -v '^default' | wc -l) configs in conf.d"; fi`,
    `echo "TMP:$(du -sh /tmp 2>/dev/null | cut -f1 || echo '0')"`,
    `echo "HOME:$(du -sh /home 2>/dev/null | cut -f1 || echo '0')"`,
    `if [ -d /etc/nginx/sites-available ]; then ls /etc/nginx/sites-available 2>/dev/null | grep -v '^default$' | sed 's/^/CFGFILE:/'; else ls /etc/nginx/conf.d 2>/dev/null | grep -v '^default' | sed 's/\\.conf$//' | sed 's/^/CFGFILE:/'; fi`,
    // Root-level overview — where is the space actually going?
    `du -sh /* 2>/dev/null | sort -rh | head -20 | awk '{print "BIGDIR:" $1 "\\t" $2}'`,
    // Drill into the biggest subdirs of /var (Docker, databases, logs all live here)
    `du -sh /var/* 2>/dev/null | sort -rh | head -15 | awk '{print "BIGDIR:" $1 "\\t" $2}'`,
    // Drill into /var/lib (Docker images, MySQL, PostgreSQL, etc.)
    `du -sh /var/lib/* 2>/dev/null | sort -rh | head -10 | awk '{print "BIGDIR:" $1 "\\t" $2}'`,
    // Large files over 100MB anywhere on the system
    `find / -xdev -type f -size +100M 2>/dev/null | head -20 | xargs -I{} sh -c 'echo "BIGFILE:$(du -sh "{}" 2>/dev/null | cut -f1)\\t{}"'`,
  ].join(" && ");

  const result = await runSshCommand(sshOpts, cmd, 60000);
  if (!result.success) {
    res.status(500).json({ error: result.error ?? "Scan failed", output: result.output });
    return;
  }

  const lines = result.output.split("\n");
  const scan: Record<string, string> = {};
  const cfgFiles: string[] = [];
  const largeDirs: { size: string; path: string }[] = [];
  const largeFiles: { size: string; path: string }[] = [];

  for (const line of lines) {
    if (line.startsWith("CFGFILE:")) {
      const name = line.replace("CFGFILE:", "").trim();
      if (name) cfgFiles.push(name);
    } else if (line.startsWith("BIGDIR:")) {
      const parts = line.replace("BIGDIR:", "").split("\t");
      if (parts.length >= 2) largeDirs.push({ size: parts[0]!.trim(), path: parts[1]!.trim() });
    } else if (line.startsWith("BIGFILE:")) {
      const parts = line.replace("BIGFILE:", "").split("\t");
      if (parts.length >= 2) largeFiles.push({ size: parts[0]!.trim(), path: parts[1]!.trim() });
    } else {
      const colon = line.indexOf(":");
      if (colon !== -1) {
        const key = line.slice(0, colon);
        scan[key] = line.slice(colon + 1).trim();
      }
    }
  }

  res.json({
    diskUsage: scan["DFREE"] ?? "unknown",
    nginxLogs: scan["NGINXLOG"] ?? "0",
    journal: scan["JOURNAL"] ?? "0",
    aptCache: scan["APTCACHE"] ?? "0",
    nginxConfigs: scan["NGINXCFG"] ?? "0",
    tmp: scan["TMP"] ?? "0",
    home: scan["HOME"] ?? "0",
    cfgFiles,
    largeDirs,
    largeFiles,
  });
});

// --- Disk cleanup: remove specified categories ---
router.post("/servers/:id/disk-cleanup", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const server = await Server.findOne({ id });
  if (!server) { res.status(404).json({ error: "Server not found" }); return; }
  const s = server.toObject() as Record<string, unknown>;
  const sshOpts = { host: s.host as string, port: s.port as number, username: s.username as string, password: decryptSecret(s.password as string), privateKey: s.privateKey ? decryptSecret(s.privateKey as string) : null };

  const body = req.body as {
    nginxLogs?: boolean;
    journal?: boolean;
    aptCache?: boolean;
    tmp?: boolean;
    orphanConfigs?: string[];
  };

  // Build a single bash script so SUDO variable persists across all steps
  const scriptLines: string[] = [
    // Detect if we are root; if not use sudo -n (non-interactive, works with NOPASSWD)
    `if [ "$(id -u)" = "0" ]; then S=""; else S="sudo -n"; fi`,
    `echo "--- Running as: $(id -un) (uid=$(id -u)) ---"`,
  ];

  if (body.nginxLogs) {
    scriptLines.push(`echo "--- Clearing nginx logs ---"`);
    scriptLines.push(`$S truncate -s 0 /var/log/nginx/access.log && echo "OK: access.log cleared" || echo "ERR: access.log failed"`);
    scriptLines.push(`$S truncate -s 0 /var/log/nginx/error.log && echo "OK: error.log cleared" || echo "ERR: error.log failed"`);
    scriptLines.push(`$S find /var/log/nginx -name "*.log.*" -delete && echo "OK: rotated logs deleted" || echo "ERR: rotated log delete failed"`);
    scriptLines.push(`echo "--- Nginx log sizes after: $(du -sh /var/log/nginx 2>/dev/null | cut -f1) ---"`);
  }

  if (body.journal) {
    scriptLines.push(`echo "--- Trimming journal logs ---"`);
    scriptLines.push(`$S journalctl --vacuum-size=20M && echo "OK: journal trimmed" || echo "ERR: journal vacuum failed"`);
  }

  if (body.aptCache) {
    scriptLines.push(`echo "--- Clearing package cache ---"`);
    scriptLines.push(`$S apt-get clean -y && echo "OK: apt cache cleared" || { $S yum clean all && echo "OK: yum cache cleared" || echo "ERR: cache clear failed"; }`);
  }

  if (body.tmp) {
    scriptLines.push(`echo "--- Clearing old /tmp files ---"`);
    scriptLines.push(`$S find /tmp -type f -mtime +1 -delete && echo "OK: /tmp old files deleted" || echo "ERR: /tmp clean failed"`);
  }

  if (Array.isArray(body.orphanConfigs) && body.orphanConfigs.length > 0) {
    scriptLines.push(`echo "--- Removing nginx configs ---"`);
    for (const cfg of body.orphanConfigs) {
      const safe = cfg.replace(/[^a-zA-Z0-9._-]/g, "");
      if (!safe) continue;
      scriptLines.push(
        `if [ -d /etc/nginx/sites-available ]; then` +
        `  $S rm -f /etc/nginx/sites-enabled/${safe} && echo "OK: removed sites-enabled/${safe}" || echo "ERR: remove sites-enabled/${safe} failed";` +
        `  $S rm -f /etc/nginx/sites-available/${safe} && echo "OK: removed sites-available/${safe}" || echo "ERR: remove sites-available/${safe} failed";` +
        `else` +
        `  $S rm -f /etc/nginx/conf.d/${safe}.conf && echo "OK: removed conf.d/${safe}.conf" || echo "ERR: remove conf.d/${safe}.conf failed";` +
        `fi`
      );
    }
    scriptLines.push(`echo "--- Testing nginx config ---"`);
    scriptLines.push(`$S nginx -t && $S systemctl reload nginx && echo "OK: nginx reloaded" || echo "WARN: nginx test/reload had issues (check config)"`);
  }

  scriptLines.push(`echo "--- Disk free after cleanup: $(df -h / | awk 'NR==2{print $4\" free of \"$2\" (\"$5\" used)\"}') ---"`);

  if (scriptLines.length <= 2) {
    res.json({ success: true, output: "Nothing to clean." });
    return;
  }

  const cmd = b64script(scriptLines);
  const result = await runSshCommand(sshOpts, cmd, 90000);

  await Activity.create({
    id: await nextId("activity"),
    serverId: s.id,
    type: "cleanup",
    status: result.success ? "success" : "failure",
    message: result.success ? `Disk cleanup completed on ${s.host}` : `Disk cleanup failed on ${s.host}`,
    details: result.output,
    createdAt: new Date(),
  });

  res.json(result);
});

// --- Delete a specific path ---
router.post("/servers/:id/delete-path", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const server = await Server.findOne({ id });
  if (!server) { res.status(404).json({ error: "Server not found" }); return; }
  const s = server.toObject() as Record<string, unknown>;
  const sshOpts = { host: s.host as string, port: s.port as number, username: s.username as string, password: decryptSecret(s.password as string), privateKey: s.privateKey ? decryptSecret(s.privateKey as string) : null };

  const { path: rawPath } = req.body as { path?: string };
  if (!rawPath || typeof rawPath !== "string") { res.status(400).json({ error: "path required" }); return; }

  // Safety: block deleting critical system paths
  const blocked = ["/", "/bin", "/boot", "/dev", "/etc", "/lib", "/lib64", "/proc", "/run", "/sbin", "/sys", "/usr/bin", "/usr/sbin"];
  const normalised = rawPath.replace(/\/+$/, "") || "/";
  if (blocked.includes(normalised)) {
    res.status(400).json({ error: `Refusing to delete protected path: ${normalised}` });
    return;
  }

  const script = [
    `if [ "$(id -u)" = "0" ]; then S=""; else S="sudo -n"; fi`,
    `echo "Deleting: ${normalised}"`,
    `echo "Size before: $(du -sh '${normalised}' 2>/dev/null | cut -f1 || echo 'unknown')"`,
    `$S rm -rf '${normalised}' && echo "OK: deleted ${normalised}" || echo "ERR: delete failed"`,
    `echo "Disk free after: $(df -h / | awk 'NR==2{print $4\" free (\"$5\" used)\"}')"`,
  ];

  const cmd = b64script(script);
  const result = await runSshCommand(sshOpts, cmd, 60000);

  await Activity.create({
    id: await nextId("activity"),
    serverId: s.id,
    type: "cleanup",
    status: result.success ? "success" : "failure",
    message: `Deleted path ${normalised} on ${s.host as string}`,
    details: result.output,
    createdAt: new Date(),
  });

  res.json(result);
});

// --- VPS Nuke: destroy selected categories ---
router.post("/servers/:id/nuke", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const server = await Server.findOne({ id });
  if (!server) { res.status(404).json({ error: "Server not found" }); return; }
  const s = server.toObject() as Record<string, unknown>;
  const sshOpts = { host: s.host as string, port: s.port as number, username: s.username as string, password: decryptSecret(s.password as string), privateKey: s.privateKey ? decryptSecret(s.privateKey as string) : null };

  const body = req.body as {
    nginxConfigs?: boolean;   // wipe all nginx site configs
    siteFiles?: boolean;      // rm -rf everything in /var/www (except default html)
    nginxLogs?: boolean;      // truncate all nginx logs
    pm2?: boolean;            // pm2 delete all
    aptCache?: boolean;       // apt-get clean
    journal?: boolean;        // journalctl vacuum
    confirm?: string;         // must equal server name
  };

  if (!body.confirm || body.confirm.trim() !== (s.name as string).trim()) {
    res.status(400).json({ error: "Confirmation name did not match. Nuke aborted." });
    return;
  }

  const lines: string[] = [
    `if [ "$(id -u)" = "0" ]; then S=""; else S="sudo -n"; fi`,
    `echo "=============================="`,
    `echo " VPS NUKE STARTED"`,
    `echo "=============================="`,
    `echo "Running as: $(id -un) on $(hostname)"`,
    `echo "Disk before: $(df -h / | awk 'NR==2{print $3\"/\"$2\" used (\"$5\")\"}') "`,
  ];

  if (body.nginxConfigs) {
    lines.push(`echo "--- [1] Nuking nginx site configs ---"`);
    lines.push(
      `if [ -d /etc/nginx/sites-available ]; then` +
      `  $S find /etc/nginx/sites-enabled -maxdepth 1 -type l -delete && echo "OK: sites-enabled symlinks removed" || echo "ERR: sites-enabled removal failed";` +
      `  $S find /etc/nginx/sites-available -maxdepth 1 -type f ! -name 'default' -delete && echo "OK: sites-available configs removed" || echo "ERR: sites-available removal failed";` +
      `else` +
      `  $S find /etc/nginx/conf.d -maxdepth 1 -name '*.conf' ! -name 'default.conf' -delete && echo "OK: conf.d configs removed" || echo "ERR: conf.d removal failed";` +
      `fi`
    );
    lines.push(`$S nginx -t && $S systemctl reload nginx && echo "OK: nginx reloaded" || echo "WARN: nginx reload had issues"`);
  }

  if (body.siteFiles) {
    lines.push(`echo "--- [2] Nuking site files in /var/www ---"`);
    lines.push(`$S find /var/www -mindepth 1 -maxdepth 1 -not -name 'html' -exec rm -rf {} + && echo "OK: /var/www site folders deleted" || echo "ERR: /var/www wipe failed"`);
    lines.push(`echo "Remaining in /var/www: $(ls /var/www 2>/dev/null || echo 'empty')"`);
  }

  if (body.nginxLogs) {
    lines.push(`echo "--- [3] Nuking nginx logs ---"`);
    lines.push(`$S truncate -s 0 /var/log/nginx/access.log && echo "OK: access.log cleared" || echo "ERR: access.log clear failed"`);
    lines.push(`$S truncate -s 0 /var/log/nginx/error.log && echo "OK: error.log cleared" || echo "ERR: error.log clear failed"`);
    lines.push(`$S find /var/log/nginx -name "*.log.*" -delete && echo "OK: rotated logs deleted" || echo "ERR: rotated log delete failed"`);
  }

  if (body.pm2) {
    lines.push(`echo "--- [4] Killing PM2 processes ---"`);
    lines.push(`pm2 delete all 2>/dev/null && echo "OK: PM2 processes killed" || echo "INFO: PM2 not found or no processes"`);
    lines.push(`pm2 save --force 2>/dev/null || true`);
  }

  if (body.journal) {
    lines.push(`echo "--- [5] Vacuuming journal logs ---"`);
    lines.push(`$S journalctl --vacuum-size=10M && echo "OK: journal trimmed to 10MB" || echo "ERR: journal vacuum failed"`);
  }

  if (body.aptCache) {
    lines.push(`echo "--- [6] Clearing apt cache ---"`);
    lines.push(`$S apt-get clean -y && echo "OK: apt cache cleared" || { $S yum clean all && echo "OK: yum cache cleared" || echo "ERR: cache clear failed"; }`);
  }

  lines.push(`echo "=============================="`, `echo " NUKE COMPLETE"`, `echo "=============================="`, `echo "Disk after: $(df -h / | awk 'NR==2{print $3\"/\"$2\" used (\"$5\")\"}')"`, `echo "Freed: compare above numbers"`);

  const cmd = b64script(lines);
  const result = await runSshCommand(sshOpts, cmd, 120000);

  await Activity.create({
    id: await nextId("activity"),
    serverId: s.id,
    type: "nuke",
    status: result.success ? "success" : "failure",
    message: `VPS NUKE on ${s.host as string}`,
    details: result.output,
    createdAt: new Date(),
  });

  res.json(result);
});

// --- Install PM2 log rotation ---
router.post("/servers/:id/setup-pm2-logrotate", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const server = await Server.findOne({ id });
  if (!server) { res.status(404).json({ error: "Server not found" }); return; }
  const s = server.toObject() as Record<string, unknown>;
  const sshOpts = { host: s.host as string, port: s.port as number, username: s.username as string, password: decryptSecret(s.password as string), privateKey: s.privateKey ? decryptSecret(s.privateKey as string) : null };

  const script = [
    `pm2 install pm2-logrotate 2>&1 && echo "OK: pm2-logrotate installed" || echo "ERR: install failed"`,
    `pm2 set pm2-logrotate:max_size 50M && echo "OK: max_size=50M"`,
    `pm2 set pm2-logrotate:retain 3 && echo "OK: retain=3 files"`,
    `pm2 set pm2-logrotate:compress true && echo "OK: compress=true"`,
    `echo "Log rotation configured. Logs will be capped at 50MB, keep last 3."`,
    `echo "Current disk: $(df -h / | awk 'NR==2{print $4\" free (\"$5\" used)\"}')"`,
  ];

  const result = await runSshCommand(sshOpts, b64script(script), 60000);
  res.json(result);
});

export default router;
