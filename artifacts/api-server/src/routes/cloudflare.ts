import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, cloudflareConfigsTable, activityTable } from "@workspace/db";
import {
  CreateCloudflareConfigBody,
  DeleteCloudflareConfigParams,
  GetCloudflareZonesParams,
  CreateDnsRecordParams,
  CreateDnsRecordBody,
} from "@workspace/api-zod";
import { getCloudflareZones, createDnsRecord } from "../lib/cloudflareApi";

const router: IRouter = Router();

router.get("/cloudflare", async (_req, res): Promise<void> => {
  const configs = await db.select().from(cloudflareConfigsTable);
  res.json(configs.map(c => ({ id: c.id, label: c.label, email: c.email, zoneId: c.zoneId, createdAt: c.createdAt.toISOString() })));
});

router.post("/cloudflare", async (req, res): Promise<void> => {
  const parsed = CreateCloudflareConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [config] = await db.insert(cloudflareConfigsTable).values(parsed.data).returning();
  res.status(201).json({ id: config.id, label: config.label, email: config.email, zoneId: config.zoneId, createdAt: config.createdAt.toISOString() });
});

router.delete("/cloudflare/:id", async (req, res): Promise<void> => {
  const params = DeleteCloudflareConfigParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [config] = await db.delete(cloudflareConfigsTable).where(eq(cloudflareConfigsTable.id, params.data.id)).returning();
  if (!config) {
    res.status(404).json({ error: "Cloudflare config not found" });
    return;
  }

  res.sendStatus(204);
});

router.get("/cloudflare/:id/zones", async (req, res): Promise<void> => {
  const params = GetCloudflareZonesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [config] = await db.select().from(cloudflareConfigsTable).where(eq(cloudflareConfigsTable.id, params.data.id));
  if (!config) {
    res.status(404).json({ error: "Cloudflare config not found" });
    return;
  }

  try {
    const zones = await getCloudflareZones(config.apiToken);
    res.json(zones);
  } catch (e: unknown) {
    res.status(502).json({ error: (e as Error).message });
  }
});

router.post("/cloudflare/:id/create-dns", async (req, res): Promise<void> => {
  const params = CreateDnsRecordParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = CreateDnsRecordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [config] = await db.select().from(cloudflareConfigsTable).where(eq(cloudflareConfigsTable.id, params.data.id));
  if (!config) {
    res.status(404).json({ error: "Cloudflare config not found" });
    return;
  }

  const result = await createDnsRecord(
    config.apiToken,
    parsed.data.zoneId,
    parsed.data.domain,
    parsed.data.ip,
    parsed.data.proxied ?? true
  );

  await db.insert(activityTable).values({
    type: "dns_setup",
    status: result.success ? "success" : "failure",
    message: result.success ? `DNS record created for ${parsed.data.domain}` : `DNS record creation failed for ${parsed.data.domain}`,
    details: result.output,
  });

  res.json(result);
});

export default router;
