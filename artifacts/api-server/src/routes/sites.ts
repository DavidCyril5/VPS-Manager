import { Router, type IRouter } from "express";
import { Site, Server, Activity, nextId } from "../lib/db";
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
import { runSshCommand } from "../lib/ssh";
import crypto from "crypto";

const router: IRouter = Router();

function sanitizeSite(doc: Record<string, unknown>) {
  return { ...doc, repoToken: doc.repoToken ? "***" : null };
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
  const buildCommand = siteData.buildCommand as string | null;

  const domain = siteData.domain as string;

  let deployScript = "";
  if (repoUrl) {
    const cloneUrl = repoToken
      ? repoUrl.replace("https://", `https://oauth2:${repoToken}@`)
      : repoUrl;
    deployScript = [
      `if [ -d "${deployPath}/.git" ]; then`,
      `  cd ${deployPath} && git fetch --all && git reset --hard origin/HEAD`,
      `else`,
      `  rm -rf ${deployPath} && git clone ${cloneUrl} ${deployPath}`,
      `fi`,
      buildCommand ? `&& cd ${deployPath} && ${buildCommand}` : "",
    ].filter(Boolean).join("\n");
  } else {
    deployScript = `mkdir -p ${deployPath} && echo "Deploy path ready: ${deployPath}"`;
  }

  const nginxConfig = [
    `server {`,
    `    listen 80;`,
    `    server_name ${domain};`,
    `    root ${deployPath};`,
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
    details: result.output,
    createdAt: new Date(),
  });

  res.json(result);
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
  const buildCommand = siteData.buildCommand as string | null;

  if (!repoUrl) {
    res.status(400).json({ error: "No repo configured for this site" });
    return;
  }

  const cloneUrl = repoToken
    ? repoUrl.replace("https://", `https://oauth2:${repoToken}@`)
    : repoUrl;

  const deployScript = [
    `if [ -d "${deployPath}/.git" ]; then`,
    `  cd ${deployPath} && git fetch --all && git reset --hard origin/HEAD`,
    `else`,
    `  rm -rf ${deployPath} && git clone ${cloneUrl} ${deployPath}`,
    `fi`,
    buildCommand ? `&& cd ${deployPath} && ${buildCommand}` : "",
  ].filter(Boolean).join("\n");

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
