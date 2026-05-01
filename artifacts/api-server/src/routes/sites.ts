import { Router, type IRouter } from "express";
import { Site, Server, Activity, CloudflareConfig, Settings, nextId, decryptSecret, getSettings } from "../lib/db";
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
import https from "https";
import http from "http";

function getSshOpts(serverData: Record<string, unknown>) {
  return {
    host: serverData.host as string,
    port: serverData.port as number,
    username: serverData.username as string,
    password: decryptSecret(serverData.password as string),
    privateKey: serverData.privateKey ? decryptSecret(serverData.privateKey as string) : null,
  };
}

async function sendAlertWebhook(siteName: string, domain: string, errorSummary: string): Promise<void> {
  try {
    const settings = await getSettings();
    const url = settings.alertWebhookUrl as string | null;
    if (!url) return;
    const payload = JSON.stringify({ event: "deploy_failed", site: siteName, domain, error: errorSummary, timestamp: new Date().toISOString() });
    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? https : http;
    await new Promise<void>((resolve) => {
      const req = mod.request(url, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } }, () => resolve());
      req.on("error", () => resolve());
      req.write(payload);
      req.end();
    });
  } catch (_) {}
}

const router: IRouter = Router();

function sanitizeSite(doc: Record<string, unknown>) {
  return { ...doc, repoToken: doc.repoToken ? "***" : null };
}

async function getCfConfigsForSite(siteData: Record<string, unknown>) {
  const assignedId = siteData.cloudflareConfigId as number | null | undefined;
  if (assignedId) {
    const assigned = await CloudflareConfig.findOne({ id: assignedId });
    if (assigned) return [assigned];
  }
  return CloudflareConfig.find();
}

const ENSURE_NODE = `command -v npm >/dev/null 2>&1 || (curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs)`;

function nodeAutoBuild(deployPath: string): string {
  // Must use semicolons inside if/elif/else — joining with && breaks elif/else syntax
  const hasBuildScript = `node -e "const p=require('./package.json');process.exit(p.scripts&&p.scripts.build?0:1)" 2>/dev/null`;
  const detectPm =
    `if [ -f "pnpm-lock.yaml" ]; then ` +
      `command -v pnpm >/dev/null 2>&1 || sudo npm install -g pnpm; PMCMD="$(dirname $(which npm))/pnpm"; ` +
    `elif [ -f "yarn.lock" ]; then ` +
      `command -v yarn >/dev/null 2>&1 || sudo npm install -g yarn; PMCMD="$(dirname $(which npm))/yarn"; ` +
    `else PMCMD="npm"; fi`;
  return [
    ENSURE_NODE,
    `cd ${deployPath}`,
    detectPm,
    `$PMCMD install`,
    `if ${hasBuildScript}; then $PMCMD run build; fi`,
  ].join(" && ");
}

interface DeployParts {
  deployScript: string;
  pm2Script: string | null;
  setupNginx: string;
}

function buildDeployParts(siteData: Record<string, unknown>): DeployParts {
  const repoUrl = siteData.repoUrl as string | null;
  const repoToken = siteData.repoToken as string | null;
  const deployPath = siteData.deployPath as string;
  const siteType = siteData.siteType as string;
  const domain = siteData.domain as string;
  const appPort = (siteData.port as number | null) || 3000;
  const rawWebRoot = siteData.webRoot as string | null;
  const isServer = siteType === "nodejs" || siteType === "python";

  // --- Build command ---
  const buildCommand = (siteData.buildCommand as string | null)
    || (siteType === "nodejs" ? nodeAutoBuild(deployPath)
      : siteType === "python" ? `cd ${deployPath} && pip install -r requirements.txt`
      : null);

  // --- Git/clone script ---
  let deployScript = "";
  if (repoUrl) {
    const cloneUrl = repoToken
      ? repoUrl.replace("https://", `https://oauth2:${repoToken}@`)
      : repoUrl;
    const gitBlock = [
      `sudo mkdir -p ${deployPath}`,
      `sudo chown $(whoami):$(whoami) ${deployPath}`,
      `if [ -d "${deployPath}/.git" ]; then`,
      `  cd ${deployPath} && git fetch --all && git reset --hard origin/HEAD`,
      `else`,
      `  sudo rm -rf ${deployPath} && sudo mkdir -p ${deployPath} && sudo chown $(whoami):$(whoami) ${deployPath} && git clone ${cloneUrl} ${deployPath}`,
      `fi`,
    ].join("\n");
    deployScript = buildCommand
      ? `${gitBlock} && cd ${deployPath} && ${buildCommand}`
      : gitBlock;
  } else {
    deployScript = `sudo mkdir -p ${deployPath} && sudo chown $(whoami):$(whoami) ${deployPath} && echo "Deploy path ready: ${deployPath}"`;
  }

  // --- pm2 process management (nodejs / python) ---
  let pm2Script: string | null = null;
  if (isServer) {
    const defaultStart = siteType === "python"
      ? `gunicorn app:app --bind 0.0.0.0:${appPort} --daemon`
      : `npm run start`;
    const startCommand = (siteData.startCommand as string | null) || defaultStart;
    const pm2Name = domain.replace(/[^a-zA-Z0-9]/g, "-");
    const pm2ConfigPath = `/tmp/pm2-${pm2Name}.json`;
    // Use a JSON config file so pm2 always receives the correct PORT env var,
    // even when running as a daemon that doesn't inherit the shell's environment.
    const pm2Config = JSON.stringify({
      name: pm2Name,
      script: siteType === "python" ? startCommand : "npm",
      args: siteType === "python" ? undefined : "run start",
      cwd: deployPath,
      env: { PORT: String(appPort), NODE_ENV: "production" },
    });
    pm2Script = [
      ENSURE_NODE,
      `command -v pm2 >/dev/null 2>&1 || sudo npm install -g pm2`,
      `cd ${deployPath}`,
      `echo '${pm2Config.replace(/'/g, "\\'")}' > ${pm2ConfigPath}`,
      `pm2 startOrRestart ${pm2ConfigPath}`,
      `pm2 save`,
    ].join(" && ");
  }

  // --- Nginx config ---
  let nginxConfig: string;
  if (isServer) {
    nginxConfig = [
      `server {`,
      `    listen 80;`,
      `    server_name ${domain};`,
      ``,
      `    location / {`,
      `        proxy_pass http://localhost:${appPort};`,
      `        proxy_http_version 1.1;`,
      `        proxy_set_header Upgrade $http_upgrade;`,
      `        proxy_set_header Connection 'upgrade';`,
      `        proxy_set_header Host $host;`,
      `        proxy_set_header X-Real-IP $remote_addr;`,
      `        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`,
      `        proxy_set_header X-Forwarded-Proto $scheme;`,
      `        proxy_cache_bypass $http_upgrade;`,
      `    }`,
      `}`,
    ].join("\n");
  } else {
    const nginxRoot = rawWebRoot
      ? (rawWebRoot.startsWith("/") ? rawWebRoot : `${deployPath}/${rawWebRoot}`)
      : deployPath;
    nginxConfig = [
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
  }

  const nginxConfigB64 = Buffer.from(nginxConfig).toString("base64");
  const setupNginx = [
    `echo '${nginxConfigB64}' | base64 -d | sudo tee /etc/nginx/sites-available/${domain} > /dev/null`,
    `sudo rm -f /etc/nginx/sites-enabled/${domain}`,
    `sudo ln -sf /etc/nginx/sites-available/${domain} /etc/nginx/sites-enabled/${domain}`,
    `sudo nginx -t && sudo systemctl reload nginx`,
  ].join(" && ");

  return { deployScript, pm2Script, setupNginx };
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
  const siteType = siteData.siteType as string;

  const server = await Server.findOne({ id: siteData.serverId });
  if (server) {
    const serverData = server.toObject() as Record<string, unknown>;
    const sshOpts = getSshOpts(serverData);
    const pm2Name = domain.replace(/[^a-zA-Z0-9]/g, "-");
    const pm2Cleanup = (siteType === "nodejs" || siteType === "python")
      ? `pm2 delete "${pm2Name}" 2>/dev/null || true && pm2 save && `
      : "";
    const cleanupScript = [
      `${pm2Cleanup}sudo rm -f /etc/nginx/sites-enabled/${domain}`,
      `sudo rm -f /etc/nginx/sites-available/${domain}`,
      `sudo nginx -t && sudo systemctl reload nginx`,
      `sudo rm -rf ${deployPath}`,
    ].join(" && ");
    await runSshCommand(sshOpts, cleanupScript, 30000).catch(() => {});
  }

  try {
    const cfConfigs = await getCfConfigsForSite(siteData);
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

  const domain = siteData.domain as string;
  const { deployScript, pm2Script, setupNginx } = buildDeployParts(siteData);
  const parts = [deployScript];
  if (pm2Script) parts.push(pm2Script);
  parts.push(setupNginx);
  const fullScript = parts.join(" && ");

  const sshOpts = getSshOpts(serverData);

  const result = await runSshCommand(sshOpts, fullScript, 180000);
  const newStatus = result.success ? "active" : "failed";

  await Site.findOneAndUpdate(
    { id: siteData.id },
    { status: newStatus, ...(result.success ? { lastDeployedAt: new Date() } : {}), updatedAt: new Date() }
  );

  let dnsOutput = "";
  if (result.success) {
    try {
      const cfConfigs = await getCfConfigsForSite(siteData);
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

  if (!result.success) {
    sendAlertWebhook(siteData.name as string, domain, result.output.slice(-500)).catch(() => {});
  }

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

  const domain = siteData.domain as string;
  const siteType = siteData.siteType as string;
  const { deployScript, pm2Script, setupNginx } = buildDeployParts(siteData);
  const parts = [deployScript];
  if (pm2Script) parts.push(pm2Script);
  parts.push(setupNginx);
  const fullScript = parts.join(" && ");

  if (pm2Script) sendEvent({ type: "status", text: `Starting ${siteType} app with pm2...` });

  const sshOpts = getSshOpts(serverData);

  const result = await runSshCommandStream(sshOpts, fullScript, (chunk) => {
    sendEvent({ type: "log", text: chunk });
  }, 180000);

  const newStatus = result.success ? "active" : "failed";
  await Site.findOneAndUpdate(
    { id: siteData.id },
    { status: newStatus, ...(result.success ? { lastDeployedAt: new Date() } : {}), updatedAt: new Date() }
  );

  let dnsOutput = "";
  if (result.success) {
    try {
      const cfConfigs = await getCfConfigsForSite(siteData);
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

  if (!result.success) {
    sendAlertWebhook(siteData.name as string, domain, result.output.slice(-500)).catch(() => {});
  }

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

  const sshOpts = getSshOpts(serverData);

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
  const sslScript = `sudo certbot --nginx -d ${domain} --non-interactive --agree-tos --email admin@${domain} --redirect`;
  const sshOpts = getSshOpts(serverData);

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
    getSshOpts(serverData),
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
  const configB64 = Buffer.from(parsed.data.config).toString("base64");
  const script = `echo '${configB64}' | base64 -d | sudo tee /etc/nginx/sites-available/${domain} > /dev/null && sudo nginx -t && sudo systemctl reload nginx`;

  const result = await runSshCommand(
    getSshOpts(serverData),
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
    getSshOpts(serverData),
    `sudo certbot certificates -d ${domain} 2>/dev/null | grep "Expiry Date" | head -1`,
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
    `sudo mkdir -p ${deployPath}`,
    `sudo chown $(whoami):$(whoami) ${deployPath}`,
    `if [ -d "${deployPath}/.git" ]; then`,
    `  cd ${deployPath} && git fetch --all && git reset --hard origin/HEAD`,
    `else`,
    `  sudo rm -rf ${deployPath} && sudo mkdir -p ${deployPath} && sudo chown $(whoami):$(whoami) ${deployPath} && git clone ${cloneUrl} ${deployPath}`,
    `fi`,
  ].join("\n");
  const deployScript = buildCommand
    ? `${gitBlock} && cd ${deployPath} && ${buildCommand}`
    : gitBlock;

  await Site.findOneAndUpdate({ id: siteData.id }, { status: "deploying", updatedAt: new Date() });

  const sshOpts = getSshOpts(serverData);

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

// --- PM2 controls ---
router.post("/sites/:id/pm2/:action", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const action = req.params.action as string;
  if (!["restart", "stop", "start", "logs", "status"].includes(action)) {
    res.status(400).json({ error: "Invalid PM2 action" }); return;
  }
  const site = await Site.findOne({ id });
  if (!site) { res.status(404).json({ error: "Site not found" }); return; }
  const siteData = site.toObject() as Record<string, unknown>;
  const server = await Server.findOne({ id: siteData.serverId });
  if (!server) { res.status(404).json({ error: "Server not found" }); return; }
  const serverData = server.toObject() as Record<string, unknown>;
  const pm2Name = (siteData.domain as string).replace(/[^a-zA-Z0-9]/g, "-");
  let cmd = "";
  if (action === "restart") cmd = `pm2 restart "${pm2Name}" 2>&1 || pm2 startOrRestart /tmp/pm2-${pm2Name}.json 2>&1`;
  else if (action === "stop") cmd = `pm2 stop "${pm2Name}" 2>&1`;
  else if (action === "start") cmd = `pm2 startOrRestart /tmp/pm2-${pm2Name}.json 2>&1`;
  else if (action === "logs") cmd = `pm2 logs "${pm2Name}" --nostream --lines 80 2>&1`;
  else if (action === "status") cmd = `pm2 show "${pm2Name}" 2>&1`;
  const result = await runSshCommand(getSshOpts(serverData), cmd, 30000);
  res.json(result);
});

// --- Live uptime check ---
router.get("/sites/:id/uptime", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const site = await Site.findOne({ id });
  if (!site) { res.status(404).json({ error: "Site not found" }); return; }
  const siteData = site.toObject() as Record<string, unknown>;
  const domain = siteData.domain as string;
  const ssl = siteData.sslInstalled as boolean;
  const url = ssl ? `https://${domain}` : `http://${domain}`;
  const start = Date.now();
  try {
    const mod = ssl ? https : http;
    const statusCode = await new Promise<number>((resolve, reject) => {
      const r = mod.get(url, { headers: { "User-Agent": "VPS-Manager/1.0" }, timeout: 10000 }, (resp) => {
        resp.resume();
        resolve(resp.statusCode ?? 0);
      });
      r.on("error", reject);
      r.on("timeout", () => { r.destroy(); reject(new Error("timeout")); });
    });
    const ms = Date.now() - start;
    const up = statusCode >= 200 && statusCode < 400;
    res.json({ up, statusCode, ms, url });
  } catch (e: unknown) {
    res.json({ up: false, statusCode: 0, ms: Date.now() - start, url, error: (e as Error).message });
  }
});

// --- Git commit history (for rollback) ---
router.get("/sites/:id/commits", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const site = await Site.findOne({ id });
  if (!site) { res.status(404).json({ error: "Site not found" }); return; }
  const siteData = site.toObject() as Record<string, unknown>;
  const server = await Server.findOne({ id: siteData.serverId });
  if (!server) { res.status(404).json({ error: "Server not found" }); return; }
  const serverData = server.toObject() as Record<string, unknown>;
  const deployPath = siteData.deployPath as string;
  const cmd = `cd "${deployPath}" && git log --oneline -10 --format="%H|||%s|||%cr" 2>&1`;
  const result = await runSshCommand(getSshOpts(serverData), cmd, 15000);
  if (!result.success) { res.json({ commits: [], error: result.output }); return; }
  const commits = result.output.trim().split("\n").filter(Boolean).map((line) => {
    const [sha, subject, date] = line.split("|||");
    return { sha: (sha ?? "").trim(), subject: (subject ?? "").trim(), date: (date ?? "").trim() };
  });
  res.json({ commits });
});

// --- Deployment rollback ---
router.post("/sites/:id/rollback", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { sha } = req.body as { sha?: string };
  if (!sha) { res.status(400).json({ error: "sha is required" }); return; }
  const site = await Site.findOne({ id });
  if (!site) { res.status(404).json({ error: "Site not found" }); return; }
  const siteData = site.toObject() as Record<string, unknown>;
  const server = await Server.findOne({ id: siteData.serverId });
  if (!server) { res.status(404).json({ error: "Server not found" }); return; }
  const serverData = server.toObject() as Record<string, unknown>;
  const deployPath = siteData.deployPath as string;
  const domain = siteData.domain as string;
  const { deployScript, pm2Script, setupNginx } = buildDeployParts(siteData);
  const resetCmd = `cd "${deployPath}" && git reset --hard "${sha.replace(/[^a-f0-9]/g, "")}" 2>&1`;
  const buildCmd = siteData.buildCommand ? `cd "${deployPath}" && ${siteData.buildCommand} 2>&1` : null;
  const parts = [resetCmd];
  if (buildCmd) parts.push(buildCmd);
  if (pm2Script) parts.push(pm2Script);
  const fullScript = parts.join(" && ");
  await Site.findOneAndUpdate({ id }, { status: "deploying", updatedAt: new Date() });
  const result = await runSshCommand(getSshOpts(serverData), fullScript, 180000);
  await Site.findOneAndUpdate({ id }, { status: result.success ? "active" : "failed", updatedAt: new Date() });
  const actId = await nextId("activity");
  await Activity.create({
    id: actId,
    siteId: id,
    serverId: serverData.id,
    type: "deploy",
    status: result.success ? "success" : "failure",
    message: result.success ? `Rolled back ${siteData.name} to ${sha.slice(0, 8)}` : `Rollback of ${siteData.name} failed`,
    details: result.output,
    createdAt: new Date(),
  });
  if (!result.success) {
    sendAlertWebhook(siteData.name as string, domain, result.output.slice(-500)).catch(() => {});
  }
  res.json(result);
});

// --- SSL auto-renewal setup ---
router.post("/sites/:id/setup-ssl-renewal", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const site = await Site.findOne({ id });
  if (!site) { res.status(404).json({ error: "Site not found" }); return; }
  const siteData = site.toObject() as Record<string, unknown>;
  const server = await Server.findOne({ id: siteData.serverId });
  if (!server) { res.status(404).json({ error: "Server not found" }); return; }
  const serverData = server.toObject() as Record<string, unknown>;
  const cronLine = "0 3 * * * sudo /usr/bin/certbot renew --quiet --post-hook 'sudo systemctl reload nginx' >> /var/log/certbot-renew.log 2>&1";
  const cmd = `(crontab -l 2>/dev/null | grep -v 'certbot renew'; echo '${cronLine}') | crontab - && echo "SSL auto-renewal cron configured" 2>&1`;
  const result = await runSshCommand(getSshOpts(serverData), cmd, 15000);
  res.json(result);
});

export default router;
