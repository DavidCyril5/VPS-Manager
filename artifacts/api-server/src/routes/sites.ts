import { Router, type IRouter } from "express";
import { Site, Server, Activity, CloudflareConfig, nextId } from "../lib/db";
import { getCloudflareZones, findMatchingZone, upsertDnsRecord, deleteDnsRecordByName } from "../lib/cloudflareApi";
import {
  CreateSiteBody,
  UpdateSiteBody,
  GetSiteParams,
  UpdateSiteParams,
  DeleteSiteParams,
  DeploySiteParams,
  InstallSslParams,
  GetNginxConfigParams,
  UpdateNginxConfigParams,
  UpdateNginxConfigBody,
  GetSslStatusParams,
} from "@workspace/api-zod";
import { runSshCommand, runSshCommandStream, runSshLiveStream } from "../lib/ssh";
import crypto from "crypto";

const router: IRouter = Router();

function sanitizeSite(doc: Record<string, unknown>) {
  return { ...doc, repoToken: doc.repoToken ? "***" : null };
}

function nodeAutoBuild(deployPath: string): string {
  // Must use semicolons inside if/elif/else — joining with && breaks elif/else syntax
  const hasBuildScript = `node -e "const p=require('./package.json');process.exit(p.scripts&&p.scripts.build?0:1)" 2>/dev/null`;
  const detectPm =
    `if [ -f "pnpm-lock.yaml" ]; then ` +
      `command -v pnpm >/dev/null 2>&1 || npm install -g pnpm; PMCMD="$(dirname $(which npm))/pnpm"; ` +
    `elif [ -f "yarn.lock" ]; then ` +
      `command -v yarn >/dev/null 2>&1 || npm install -g yarn; PMCMD="$(dirname $(which npm))/yarn"; ` +
    `else PMCMD="npm"; fi`;
  return [
    `cd ${deployPath}`,
    detectPm,
    `$PMCMD install`,
    `if ${hasBuildScript}; then $PMCMD run build; fi`,
  ].join(" && ");
}

router.get("/sites", async (_req, res): Promise<void> => {
  const sites = await Site.find().sort({ createdAt: -1 });
  res.json(sites.map((s) => sanitizeSite(s.toObject() as Record<string, unknown>)));
});

router.post("/sites", async (req, res): Promise<void> => {
  const parsed = CreateSiteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const webhookToken = crypto.randomBytes(24).toString("hex");
  const id = await nextId("sites");
  const site = await Site.create({ id, ...parsed.data, status: "stopped", webhookToken, createdAt: new Date(), updatedAt: new Date() });
  res.status(201).json(sanitizeSite(site.toObject() as Record<string, unknown>));
});

router.get("/sites/:id", async (req, res): Promise<void> => {
  const params = GetSiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const site = await Site.findOne({ id: params.data.id });
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }
  res.json(sanitizeSite(site.toObject() as Record<string, unknown>));
});

router.patch("/sites/:id", async (req, res): Promise<void> => {
  const params = UpdateSiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateSiteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const site = await Site.findOneAndUpdate(
    { id: params.data.id },
    { ...parsed.data, updatedAt: new Date() },
    { returnDocument: "after" }
  );
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }
  res.json(sanitizeSite(site.toObject() as Record<string, unknown>));
});

router.delete("/sites/:id", async (req, res): Promise<void> => {
  const params = DeleteSiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const site = await Site.findOneAndDelete({ id: params.data.id });
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }
  const siteData = site.toObject() as Record<string, unknown>;
  const domain = siteData.domain as string;
  const deployPath = siteData.deployPath as string;

  const server = await Server.findOne({ id: siteData.serverId });
  if (server) {
    const serverData = server.toObject() as Record<string, unknown>;
    const sshOpts = {
      host: serverData.host as string,
      port: serverData.port as number,
      username: serverData.username as string,
      password: serverData.password as string,
      privateKey: serverData.privateKey as string | null,
    };
    const cleanupScript = [
      `rm -f /etc/nginx/sites-enabled/${domain}`,
      `rm -f /etc/nginx/sites-available/${domain}`,
      `nginx -t && systemctl reload nginx`,
      `rm -rf ${deployPath}`,
    ].join(" && ");
    await runSshCommand(sshOpts, cleanupScript, 30000).catch(() => {});
  }

  try {
    const cfConfigs = await CloudflareConfig.find();
    for (const cfg of cfConfigs) {
      const token = cfg.get("apiToken") as string;
      const zones = await getCloudflareZones(token);
      const zone = findMatchingZone(zones, domain);
      if (zone) {
        await deleteDnsRecordByName(token, zone.id, domain);
        break;
      }
    }
  } catch (_) {}

  const actId = await nextId("activity");
  await Activity.create({
    id: actId,
    siteId: siteData.id,
    serverId: server ? (server.toObject() as Record<string, unknown>).id : null,
    type: "delete",
    status: "success",
    message: `Site ${siteData.name} deleted — Nginx config, DNS record, and files removed`,
    createdAt: new Date(),
  });

  res.sendStatus(204);
});

router.post("/sites/:id/deploy", async (req, res): Promise<void> => {
  const params = DeploySiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const site = await Site.findOne({ id: params.data.id });
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }
  const siteData = site.toObject() as Record<string, unknown>;

  const server = await Server.findOne({ id: siteData.serverId });
  if (!server) {
    res.status(404).json({ error: "Server not found for this site" });
    return;
  }
  const serverData = server.toObject() as Record<string, unknown>;

  await Site.findOneAndUpdate({ id: siteData.id }, { status: "deploying", updatedAt: new Date() });

  const repoUrl = siteData.repoUrl as string | null;
  const repoToken = siteData.repoToken as string | null;
  const deployPath = siteData.deployPath as string;
  const siteType = siteData.siteType as string;
  const domain = siteData.domain as string;

  const buildCommand = (siteData.buildCommand as string | null)
    || (siteType === "nodejs" ? nodeAutoBuild(deployPath)
      : siteType === "python" ? `[ -f requirements.txt ] && pip install -r requirements.txt || true`
      : null);

  let deployScript = "";
  if (repoUrl) {
    const cloneUrl = repoToken
      ? repoUrl.replace("https://", `https://oauth2:${repoToken}@`)
      : repoUrl;
    const gitBlock = [
      `if [ -d "${deployPath}/.git" ]; then`,
      `  cd ${deployPath} && git fetch --all && git reset --hard origin/HEAD`,
      `else`,
      `  rm -rf ${deployPath} && git clone ${cloneUrl} ${deployPath}`,
      `fi`,
    ].join("\n");
    deployScript = buildCommand
      ? `${gitBlock} && cd ${deployPath} && ${buildCommand}`
      : gitBlock;
  } else {
    deployScript = `mkdir -p ${deployPath} && echo "Deploy path ready: ${deployPath}"`;
  }

  const rawWebRoot = siteData.webRoot as string | null;
  const nginxRoot = rawWebRoot
    ? (rawWebRoot.startsWith("/") ? rawWebRoot : `${deployPath}/${rawWebRoot}`)
    : deployPath;

  const nginxConfig = [
    `server {`,
    `    listen 80;`,
    `    server_name ${domain};`,
    `    root ${nginxRoot};`,
    `    index index.html index.htm;`,
    ``,
    `    location / {`,
    `        try_files $uri $uri/ =404;`,
    `    }`,
    `}`,
  ].join("\n");

  const nginxConfigB64 = Buffer.from(nginxConfig).toString("base64");

  const setupNginx = [
    `echo '${nginxConfigB64}' | base64 -d > /etc/nginx/sites-available/${domain}`,
    `rm -f /etc/nginx/sites-enabled/${domain}`,
    `ln -sf /etc/nginx/sites-available/${domain} /etc/nginx/sites-enabled/${domain}`,
    `nginx -t && systemctl reload nginx`,
  ].join(" && ");

  const fullScript = `${deployScript} && ${setupNginx}`;
  const sshOpts = {
    host: serverData.host as string,
    port: serverData.port as number,
    username: serverData.username as string,
    password: serverData.password as string,
    privateKey: serverData.privateKey as string | null,
  };

  const result = await runSshCommand(sshOpts, fullScript, 120000);
  const newStatus = result.success ? "active" : "failed";

  await Site.findOneAndUpdate(
    { id: siteData.id },
    { status: newStatus, ...(result.success ? { lastDeployedAt: new Date() } : {}), updatedAt: new Date() }
  );

  let dnsOutput = "";
  if (result.success) {
    try {
      const cfConfigs = await CloudflareConfig.find();
      for (const cfg of cfConfigs) {
        const token = cfg.get("apiToken") as string;
        const zones = await getCloudflareZones(token);
        const zone = findMatchingZone(zones, domain);
        if (zone) {
          const serverIp = serverData.host as string;
          const dnsResult = await upsertDnsRecord(token, zone.id, domain, serverIp, false);
          dnsOutput = `\nDNS: ${dnsResult.output}`;
          const dnsActId = await nextId("activity");
          await Activity.create({
            id: dnsActId,
            siteId: siteData.id,
            serverId: serverData.id,
            type: "dns_setup",
            status: dnsResult.success ? "success" : "failure",
            message: dnsResult.success
              ? `DNS A record set: ${domain} → ${serverIp}`
              : `DNS auto-setup failed for ${domain}`,
            details: dnsResult.output,
            createdAt: new Date(),
          });
          break;
        }
      }
    } catch (e: unknown) {
      dnsOutput = `\nDNS auto-setup skipped: ${(e as Error).message}`;
    }
  }

  const actId = await nextId("activity");
  await Activity.create({
    id: actId,
    siteId: siteData.id,
    serverId: serverData.id,
    type: "deploy",
    status: result.success ? "success" : "failure",
    message: result.success
      ? `${siteData.name} deployed successfully to ${domain}`
      : `Deployment of ${siteData.name} failed`,
    details: result.output + dnsOutput,
    createdAt: new Date(),
  });

  res.json({ ...result, output: result.output + dnsOutput });
});

router.get("/sites/:id/deploy/stream", async (req, res): Promise<void> => {
  const params = DeploySiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const site = await Site.findOne({ id: params.data.id });
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }
  const siteData = site.toObject() as Record<string, unknown>;
  const server = await Server.findOne({ id: siteData.serverId });
  if (!server) {
    res.status(404).json({ error: "Server not found for this site" });
    return;
  }
  const serverData = server.toObject() as Record<string, unknown>;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  function sendEvent(payload: Record<string, unknown>) {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  await Site.findOneAndUpdate({ id: siteData.id }, { status: "deploying", updatedAt: new Date() });
  sendEvent({ type: "status", text: "Connecting to server..." });

  const repoUrl = siteData.repoUrl as string | null;
  const repoToken = siteData.repoToken as string | null;
  const deployPath = siteData.deployPath as string;
  const siteType = siteData.siteType as string;
  const domain = siteData.domain as string;

  const buildCommand = (siteData.buildCommand as string | null)
    || (siteType === "nodejs" ? nodeAutoBuild(deployPath)
      : siteType === "python" ? `[ -f requirements.txt ] && pip install -r requirements.txt || true`
      : null);

  let deployScript = "";
  if (repoUrl) {
    const cloneUrl = repoToken
      ? repoUrl.replace("https://", `https://oauth2:${repoToken}@`)
      : repoUrl;
    const gitBlock = [
      `if [ -d "${deployPath}/.git" ]; then`,
      `  cd ${deployPath} && git fetch --all && git reset --hard origin/HEAD`,
      `else`,
      `  rm -rf ${deployPath} && git clone ${cloneUrl} ${deployPath}`,
      `fi`,
    ].join("\n");
    deployScript = buildCommand
      ? `${gitBlock} && cd ${deployPath} && ${buildCommand}`
      : gitBlock;
  } else {
    deployScript = `mkdir -p ${deployPath} && echo "Deploy path ready: ${deployPath}"`;
  }

  const rawWebRoot = siteData.webRoot as string | null;
  const nginxRoot = rawWebRoot
    ? (rawWebRoot.startsWith("/") ? rawWebRoot : `${deployPath}/${rawWebRoot}`)
    : deployPath;

  const nginxConfig = [
    `server {`,
    `    listen 80;`,
    `    server_name ${domain};`,
    `    root ${nginxRoot};`,
    `    index index.html index.htm;`,
    ``,
    `    location / {`,
    `        try_files $uri $uri/ =404;`,
    `    }`,
    `}`,
  ].join("\n");

  const nginxConfigB64 = Buffer.from(nginxConfig).toString("base64");
  const setupNginx = [
    `echo '${nginxConfigB64}' | base64 -d > /etc/nginx/sites-available/${domain}`,
    `rm -f /etc/nginx/sites-enabled/${domain}`,
    `ln -sf /etc/nginx/sites-available/${domain} /etc/nginx/sites-enabled/${domain}`,
    `nginx -t && systemctl reload nginx`,
  ].join(" && ");

  const fullScript = `${deployScript} && ${setupNginx}`;
  const sshOpts = {
    host: serverData.host as string,
    port: serverData.port as number,
    username: serverData.username as string,
    password: serverData.password as string,
    privateKey: serverData.privateKey as string | null,
  };

  const result = await runSshCommandStream(sshOpts, fullScript, (chunk) => {
    sendEvent({ type: "log", text: chunk });
  }, 120000);

  const newStatus = result.success ? "active" : "failed";
  await Site.findOneAndUpdate(
    { id: siteData.id },
    { status: newStatus, ...(result.success ? { lastDeployedAt: new Date() } : {}), updatedAt: new Date() }
  );

  let dnsOutput = "";
  if (result.success) {
    try {
      const cfConfigs = await CloudflareConfig.find();
      for (const cfg of cfConfigs) {
        const token = cfg.get("apiToken") as string;
        const zones = await getCloudflareZones(token);
        const zone = findMatchingZone(zones, domain);
        if (zone) {
          const serverIp = serverData.host as string;
          sendEvent({ type: "status", text: `Setting up DNS for ${domain}...` });
          const dnsResult = await upsertDnsRecord(token, zone.id, domain, serverIp, false);
          dnsOutput = `\nDNS: ${dnsResult.output}`;
          sendEvent({ type: "log", text: dnsOutput });
          const dnsActId = await nextId("activity");
          await Activity.create({
            id: dnsActId,
            siteId: siteData.id,
            serverId: serverData.id,
            type: "dns_setup",
            status: dnsResult.success ? "success" : "failure",
            message: dnsResult.success
              ? `DNS A record set: ${domain} → ${serverIp}`
              : `DNS auto-setup failed for ${domain}`,
            details: dnsResult.output,
            createdAt: new Date(),
          });
          break;
        }
      }
    } catch (e: unknown) {
      dnsOutput = `\nDNS auto-setup skipped: ${(e as Error).message}`;
    }
  }

  const actId = await nextId("activity");
  await Activity.create({
    id: actId,
    siteId: siteData.id,
    serverId: serverData.id,
    type: "deploy",
    status: result.success ? "success" : "failure",
    message: result.success
      ? `${siteData.name} deployed successfully to ${domain}`
      : `Deployment of ${siteData.name} failed`,
    details: result.output + dnsOutput,
    createdAt: new Date(),
  });

  sendEvent({ type: "done", success: result.success });
  res.end();
});

router.get("/sites/:id/logs/stream", async (req, res): Promise<void> => {
  const params = DeploySiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const site = await Site.findOne({ id: params.data.id });
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }
  const siteData = site.toObject() as Record<string, unknown>;
  const server = await Server.findOne({ id: siteData.serverId });
  if (!server) {
    res.status(404).json({ error: "Server not found for this site" });
    return;
  }
  const serverData = server.toObject() as Record<string, unknown>;
  const domain = siteData.domain as string;
  const logType = (req.query.type as string) || "access";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const sshOpts = {
    host: serverData.host as string,
    port: serverData.port as number,
    username: serverData.username as string,
    password: serverData.password as string,
    privateKey: serverData.privateKey as string | null,
  };

  const logFile = logType === "error"
    ? `/var/log/nginx/error.log`
    : `/var/log/nginx/access.log`;

  const tailCmd = `tail -n 80 -F ${logFile} 2>/dev/null | grep --line-buffered -i "${domain}" || tail -n 80 -F ${logFile} 2>/dev/null`;

  const cancel = runSshLiveStream(
    sshOpts,
    tailCmd,
    (chunk) => {
      res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
    },
    () => {
      try { res.end(); } catch (_) {}
    }
  );

  req.on("close", () => { cancel(); });
});

router.post("/sites/:id/ssl", async (req, res): Promise<void> => {
  const params = InstallSslParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const site = await Site.findOne({ id: params.data.id });
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }
  const siteData = site.toObject() as Record<string, unknown>;

  const server = await Server.findOne({ id: siteData.serverId });
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  const serverData = server.toObject() as Record<string, unknown>;

  const domain = siteData.domain as string;
  const sslScript = `certbot --nginx -d ${domain} --non-interactive --agree-tos --email admin@${domain} --redirect`;
  const sshOpts = {
    host: serverData.host as string,
    port: serverData.port as number,
    username: serverData.username as string,
    password: serverData.password as string,
    privateKey: serverData.privateKey as string | null,
  };

  const result = await runSshCommand(sshOpts, sslScript, 120000);

  if (result.success) {
    const expiryMatch = result.output.match(/Expiry Date:\s+(\d{4}-\d{2}-\d{2})/);
    const sslExpiresAt = expiryMatch?.[1]
      ? new Date(expiryMatch[1])
      : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    await Site.findOneAndUpdate(
      { id: siteData.id },
      { sslInstalled: true, sslExpiresAt, updatedAt: new Date() }
    );
  }

  const actId = await nextId("activity");
  await Activity.create({
    id: actId,
    siteId: siteData.id,
    serverId: serverData.id,
    type: "ssl",
    status: result.success ? "success" : "failure",
    message: result.success
      ? `SSL certificate installed for ${domain}`
      : `SSL installation failed for ${domain}`,
    details: result.output,
    createdAt: new Date(),
  });

  res.json(result);
});

router.get("/sites/:id/nginx-config", async (req, res): Promise<void> => {
  const params = GetNginxConfigParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const site = await Site.findOne({ id: params.data.id });
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }
  const siteData = site.toObject() as Record<string, unknown>;

  const server = await Server.findOne({ id: siteData.serverId });
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  const serverData = server.toObject() as Record<string, unknown>;

  const domain = siteData.domain as string;
  const result = await runSshCommand(
    { host: serverData.host as string, port: serverData.port as number, username: serverData.username as string, password: serverData.password as string, privateKey: serverData.privateKey as string | null },
    `cat /etc/nginx/sites-available/${domain} 2>/dev/null || echo "# Config not found for ${domain}"`,
    15000
  );

  res.json({ config: result.output, domain });
});

router.put("/sites/:id/nginx-config", async (req, res): Promise<void> => {
  const params = UpdateNginxConfigParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateNginxConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const site = await Site.findOne({ id: params.data.id });
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }
  const siteData = site.toObject() as Record<string, unknown>;

  const server = await Server.findOne({ id: siteData.serverId });
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  const serverData = server.toObject() as Record<string, unknown>;

  const domain = siteData.domain as string;
  const script = `
cat > /etc/nginx/sites-available/${domain} << 'NGINX_EOF'
${parsed.data.config}
NGINX_EOF
nginx -t && systemctl reload nginx
  `.trim();

  const result = await runSshCommand(
    { host: serverData.host as string, port: serverData.port as number, username: serverData.username as string, password: serverData.password as string, privateKey: serverData.privateKey as string | null },
    script,
    30000
  );

  res.json(result);
});

router.get("/sites/:id/ssl-status", async (req, res): Promise<void> => {
  const params = GetSslStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const site = await Site.findOne({ id: params.data.id });
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }
  const siteData = site.toObject() as Record<string, unknown>;

  if (!siteData.sslInstalled) {
    res.json({ installed: false, expiresAt: null, daysRemaining: null, domain: siteData.domain });
    return;
  }

  const server = await Server.findOne({ id: siteData.serverId });
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  const serverData = server.toObject() as Record<string, unknown>;
  const domain = siteData.domain as string;

  const result = await runSshCommand(
    { host: serverData.host as string, port: serverData.port as number, username: serverData.username as string, password: serverData.password as string, privateKey: serverData.privateKey as string | null },
    `certbot certificates -d ${domain} 2>/dev/null | grep "Expiry Date" | head -1`,
    20000
  );

  const sslExpiresAt = siteData.sslExpiresAt as Date | null;
  let expiresAt: string | null = sslExpiresAt ? new Date(sslExpiresAt).toISOString() : null;
  let daysRemaining: number | null = null;

  if (result.success && result.output.trim()) {
    const match = result.output.match(/(\d{4}-\d{2}-\d{2})/);
    if (match?.[1]) {
      const expiry = new Date(match[1]);
      expiresAt = expiry.toISOString();
      daysRemaining = Math.ceil((expiry.getTime() - Date.now()) / (86400 * 1000));
      await Site.findOneAndUpdate({ id: siteData.id }, { sslExpiresAt: expiry, updatedAt: new Date() });
    }
  } else if (sslExpiresAt) {
    daysRemaining = Math.ceil((new Date(sslExpiresAt).getTime() - Date.now()) / (86400 * 1000));
  }

  res.json({ installed: true, expiresAt, daysRemaining, domain });
});

router.post("/webhook/:token", async (req, res): Promise<void> => {
  const { token } = req.params;
  if (!token) {
    res.status(400).json({ error: "Token required" });
    return;
  }

  const site = await Site.findOne({ webhookToken: token });
  if (!site) {
    res.status(404).json({ error: "Invalid webhook token" });
    return;
  }
  const siteData = site.toObject() as Record<string, unknown>;

  const server = await Server.findOne({ id: siteData.serverId });
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  const serverData = server.toObject() as Record<string, unknown>;

  const repoUrl = siteData.repoUrl as string | null;
  const repoToken = siteData.repoToken as string | null;
  const deployPath = siteData.deployPath as string;
  const siteTypeW = siteData.siteType as string;
  const buildCommand = (siteData.buildCommand as string | null)
    || (siteTypeW === "nodejs" ? nodeAutoBuild(deployPath)
      : siteTypeW === "python" ? `[ -f requirements.txt ] && pip install -r requirements.txt || true`
      : null);

  if (!repoUrl) {
    res.status(400).json({ error: "No repo configured for this site" });
    return;
  }

  const cloneUrl = repoToken
    ? repoUrl.replace("https://", `https://oauth2:${repoToken}@`)
    : repoUrl;

  const gitBlock = [
    `if [ -d "${deployPath}/.git" ]; then`,
    `  cd ${deployPath} && git fetch --all && git reset --hard origin/HEAD`,
    `else`,
    `  rm -rf ${deployPath} && git clone ${cloneUrl} ${deployPath}`,
    `fi`,
  ].join("\n");
  const deployScript = buildCommand
    ? `${gitBlock} && cd ${deployPath} && ${buildCommand}`
    : gitBlock;

  await Site.findOneAndUpdate({ id: siteData.id }, { status: "deploying", updatedAt: new Date() });

  const sshOpts = {
    host: serverData.host as string,
    port: serverData.port as number,
    username: serverData.username as string,
    password: serverData.password as string,
    privateKey: serverData.privateKey as string | null,
  };

  runSshCommand(sshOpts, deployScript, 120000).then(async (result) => {
    await Site.findOneAndUpdate(
      { id: siteData.id },
      { status: result.success ? "active" : "failed", ...(result.success ? { lastDeployedAt: new Date() } : {}), updatedAt: new Date() }
    );
    const actId = await nextId("activity");
    await Activity.create({
      id: actId,
      siteId: siteData.id,
      serverId: serverData.id,
      type: "deploy",
      status: result.success ? "success" : "failure",
      message: result.success
        ? `Webhook deploy of ${siteData.name} succeeded`
        : `Webhook deploy of ${siteData.name} failed`,
      details: result.output,
      createdAt: new Date(),
    });
  }).catch(() => {});

  res.json({ success: true, message: `Deploy triggered for ${siteData.name}` });
});

export default router;
