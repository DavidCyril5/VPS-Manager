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
} from "@workspace/api-zod";
import { runSshCommand } from "../lib/ssh";

const router: IRouter = Router();

router.get("/sites", async (_req, res): Promise<void> => {
  const sites = await db.select().from(sitesTable).orderBy(desc(sitesTable.createdAt));
  res.json(sites.map(s => ({ ...s, repoToken: s.repoToken ? "***" : null })));
});

router.post("/sites", async (req, res): Promise<void> => {
  const parsed = CreateSiteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [site] = await db.insert(sitesTable).values({
    ...parsed.data,
    status: "stopped",
  }).returning();

  res.status(201).json({ ...site, repoToken: site.repoToken ? "***" : null });
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

  res.json({ ...site, repoToken: site.repoToken ? "***" : null });
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

  res.json({ ...site, repoToken: site.repoToken ? "***" : null });
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

  if (result.success) {
    await db.update(sitesTable).set({ sslInstalled: true }).where(eq(sitesTable.id, site.id));
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

export default router;
