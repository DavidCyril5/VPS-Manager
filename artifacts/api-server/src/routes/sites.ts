import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, sitesTable, serversTable, activityTable } from "@workspace/db";
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

function sanitizeSite(s: typeof sitesTable.$inferSelect) {
  return { ...s, repoToken: s.repoToken ? "***" : null };
}

router.get("/sites", async (_req, res): Promise<void> => {
  const sites = await db.select().from(sitesTable).orderBy(desc(sitesTable.createdAt));
  res.json(sites.map(sanitizeSite));
});

router.post("/sites", async (req, res): Promise<void> => {
  const parsed = CreateSiteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const webhookToken = crypto.randomBytes(24).toString("hex");

  const [site] = await db.insert(sitesTable).values({
    ...parsed.data,
    status: "stopped",
    webhookToken,
  }).returning();

  res.status(201).json(sanitizeSite(site));
});

router.get("/sites/:id", async (req, res): Promise<void> => {
  const params = GetSiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [site] = await db.select().from(sitesTable).where(eq(sitesTable.id, params.data.id));
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }

  res.json(sanitizeSite(site));
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

  const [site] = await db.update(sitesTable).set(parsed.data).where(eq(sitesTable.id, params.data.id)).returning();
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }

  res.json(sanitizeSite(site));
});

router.delete("/sites/:id", async (req, res): Promise<void> => {
  const params = DeleteSiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [site] = await db.delete(sitesTable).where(eq(sitesTable.id, params.data.id)).returning();
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

  const [site] = await db.select().from(sitesTable).where(eq(sitesTable.id, params.data.id));
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }

  const [server] = await db.select().from(serversTable).where(eq(serversTable.id, site.serverId));
  if (!server) {
    res.status(404).json({ error: "Server not found for this site" });
    return;
  }

  await db.update(sitesTable).set({ status: "deploying" }).where(eq(sitesTable.id, site.id));

  let deployScript = "";

  if (site.repoUrl) {
    const repoUrl = site.repoToken
      ? site.repoUrl.replace("https://", `https://oauth2:${site.repoToken}@`)
      : site.repoUrl;

    deployScript = `
      mkdir -p ${site.deployPath} && \
      if [ -d "${site.deployPath}/.git" ]; then
        cd ${site.deployPath} && git pull
      else
        git clone ${repoUrl} ${site.deployPath}
      fi
      ${site.buildCommand ? `&& cd ${site.deployPath} && ${site.buildCommand}` : ""}
    `.trim();
  } else {
    deployScript = `mkdir -p ${site.deployPath} && echo "Deploy path created: ${site.deployPath}"`;
  }

  const nginxConfig = `
server {
    listen 80;
    server_name ${site.domain};
    root ${site.deployPath};
    index index.html index.htm;

    location / {
        try_files \\$uri \\$uri/ =404;
    }
}
  `.trim();

  const setupNginx = `
    cat > /etc/nginx/sites-available/${site.domain} << 'NGINX_EOF'
${nginxConfig}
NGINX_EOF
    ln -sf /etc/nginx/sites-available/${site.domain} /etc/nginx/sites-enabled/${site.domain}
    nginx -t && systemctl reload nginx
  `.trim();

  const fullScript = `${deployScript} && ${setupNginx}`;

  const result = await runSshCommand(
    { host: server.host, port: server.port, username: server.username, password: server.password, privateKey: server.privateKey },
    fullScript,
    120000
  );

  const newStatus = result.success ? "active" : "failed";
  await db.update(sitesTable).set({
    status: newStatus,
    lastDeployedAt: result.success ? new Date() : undefined,
  }).where(eq(sitesTable.id, site.id));

  await db.insert(activityTable).values({
    siteId: site.id,
    serverId: server.id,
    type: "deploy",
    status: result.success ? "success" : "failure",
    message: result.success ? `${site.name} deployed successfully to ${site.domain}` : `Deployment of ${site.name} failed`,
    details: result.output,
  });

  res.json(result);
});

router.post("/sites/:id/ssl", async (req, res): Promise<void> => {
  const params = InstallSslParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [site] = await db.select().from(sitesTable).where(eq(sitesTable.id, params.data.id));
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }

  const [server] = await db.select().from(serversTable).where(eq(serversTable.id, site.serverId));
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const sslScript = `certbot --nginx -d ${site.domain} --non-interactive --agree-tos --email admin@${site.domain} --redirect`;

  const result = await runSshCommand(
    { host: server.host, port: server.port, username: server.username, password: server.password, privateKey: server.privateKey },
    sslScript,
    120000
  );

  let sslExpiresAt: Date | undefined;
  if (result.success) {
    // Parse expiry from certbot output: "Expiry Date: 2025-07-12 ..."
    const expiryMatch = result.output.match(/Expiry Date:\s+(\d{4}-\d{2}-\d{2})/);
    if (expiryMatch?.[1]) {
      sslExpiresAt = new Date(expiryMatch[1]);
    } else {
      // Default to 90 days from now (certbot standard)
      sslExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    }
    await db.update(sitesTable).set({ sslInstalled: true, sslExpiresAt }).where(eq(sitesTable.id, site.id));
  }

  await db.insert(activityTable).values({
    siteId: site.id,
    serverId: server.id,
    type: "ssl",
    status: result.success ? "success" : "failure",
    message: result.success ? `SSL certificate installed for ${site.domain}` : `SSL installation failed for ${site.domain}`,
    details: result.output,
  });

  res.json(result);
});

router.get("/sites/:id/nginx-config", async (req, res): Promise<void> => {
  const params = GetNginxConfigParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [site] = await db.select().from(sitesTable).where(eq(sitesTable.id, params.data.id));
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }

  const [server] = await db.select().from(serversTable).where(eq(serversTable.id, site.serverId));
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  const result = await runSshCommand(
    { host: server.host, port: server.port, username: server.username, password: server.password, privateKey: server.privateKey },
    `cat /etc/nginx/sites-available/${site.domain} 2>/dev/null || echo "# Config not found for ${site.domain}"`,
    15000
  );

  res.json({ config: result.output, domain: site.domain });
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

  const [site] = await db.select().from(sitesTable).where(eq(sitesTable.id, params.data.id));
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }

  const [server] = await db.select().from(serversTable).where(eq(serversTable.id, site.serverId));
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  // Escape the config for heredoc
  const escapedConfig = parsed.data.config.replace(/\$/g, "\\$");

  const script = `
cat > /etc/nginx/sites-available/${site.domain} << 'NGINX_EOF'
${parsed.data.config}
NGINX_EOF
nginx -t && systemctl reload nginx
  `.trim();

  const result = await runSshCommand(
    { host: server.host, port: server.port, username: server.username, password: server.password, privateKey: server.privateKey },
    script,
    30000
  );

  // Suppress unused variable warning
  void escapedConfig;

  res.json(result);
});

router.get("/sites/:id/ssl-status", async (req, res): Promise<void> => {
  const params = GetSslStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [site] = await db.select().from(sitesTable).where(eq(sitesTable.id, params.data.id));
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }

  const [server] = await db.select().from(serversTable).where(eq(serversTable.id, site.serverId));
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  if (!site.sslInstalled) {
    res.json({ installed: false, expiresAt: null, daysRemaining: null, domain: site.domain });
    return;
  }

  // Refresh expiry from certbot
  const result = await runSshCommand(
    { host: server.host, port: server.port, username: server.username, password: server.password, privateKey: server.privateKey },
    `certbot certificates -d ${site.domain} 2>/dev/null | grep "Expiry Date" | head -1`,
    20000
  );

  let expiresAt: string | null = site.sslExpiresAt?.toISOString() ?? null;
  let daysRemaining: number | null = null;

  if (result.success && result.output.trim()) {
    const match = result.output.match(/(\d{4}-\d{2}-\d{2})/);
    if (match?.[1]) {
      const expiry = new Date(match[1]);
      expiresAt = expiry.toISOString();
      daysRemaining = Math.ceil((expiry.getTime() - Date.now()) / (86400 * 1000));
      await db.update(sitesTable).set({ sslExpiresAt: expiry }).where(eq(sitesTable.id, site.id));
    }
  } else if (site.sslExpiresAt) {
    daysRemaining = Math.ceil((site.sslExpiresAt.getTime() - Date.now()) / (86400 * 1000));
  }

  res.json({ installed: true, expiresAt, daysRemaining, domain: site.domain });
});

// Public webhook endpoint for auto-deploy
router.post("/webhook/:token", async (req, res): Promise<void> => {
  const { token } = req.params;
  if (!token) {
    res.status(400).json({ error: "Token required" });
    return;
  }

  const [site] = await db.select().from(sitesTable).where(eq(sitesTable.webhookToken, token));
  if (!site) {
    res.status(404).json({ error: "Invalid webhook token" });
    return;
  }

  const [server] = await db.select().from(serversTable).where(eq(serversTable.id, site.serverId));
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  await db.update(sitesTable).set({ status: "deploying" }).where(eq(sitesTable.id, site.id));

  let deployScript = "";
  if (site.repoUrl) {
    const repoUrl = site.repoToken
      ? site.repoUrl.replace("https://", `https://oauth2:${site.repoToken}@`)
      : site.repoUrl;
    deployScript = `
      if [ -d "${site.deployPath}/.git" ]; then
        cd ${site.deployPath} && git pull
      else
        git clone ${repoUrl} ${site.deployPath}
      fi
      ${site.buildCommand ? `&& cd ${site.deployPath} && ${site.buildCommand}` : ""}
    `.trim();
  } else {
    res.status(400).json({ error: "No repo configured for this site" });
    return;
  }

  // Fire and forget deploy
  runSshCommand(
    { host: server.host, port: server.port, username: server.username, password: server.password, privateKey: server.privateKey },
    deployScript,
    120000
  ).then(async (result) => {
    await db.update(sitesTable).set({
      status: result.success ? "active" : "failed",
      lastDeployedAt: result.success ? new Date() : undefined,
    }).where(eq(sitesTable.id, site.id));

    await db.insert(activityTable).values({
      siteId: site.id,
      serverId: server.id,
      type: "deploy",
      status: result.success ? "success" : "failure",
      message: result.success ? `Webhook deploy of ${site.name} succeeded` : `Webhook deploy of ${site.name} failed`,
      details: result.output,
    });
  }).catch(() => {});

  res.json({ success: true, message: `Deploy triggered for ${site.name}` });
});

export default router;
