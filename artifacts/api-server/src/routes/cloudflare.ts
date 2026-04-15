import { Router, type IRouter } from "express";
import { CloudflareConfig, Activity, nextId } from "../lib/db";
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
  const configs = await CloudflareConfig.find().sort({ createdAt: -1 });
  res.json(
    configs.map((c) => {
      const obj = c.toObject() as Record<string, unknown>;
      const { apiToken: _t, ...safe } = obj;
      return safe;
    })
  );
});

router.post("/cloudflare", async (req, res): Promise<void> => {
  const parsed = CreateCloudflareConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const id = await nextId("cloudflare");
  const config = await CloudflareConfig.create({ id, ...parsed.data, createdAt: new Date(), updatedAt: new Date() });
  const obj = config.toObject() as Record<string, unknown>;
  const { apiToken: _t, ...safe } = obj;
  res.status(201).json(safe);
});

router.delete("/cloudflare/:id", async (req, res): Promise<void> => {
  const params = DeleteCloudflareConfigParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const config = await CloudflareConfig.findOneAndDelete({ id: params.data.id });
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
  const config = await CloudflareConfig.findOne({ id: params.data.id });
  if (!config) {
    res.status(404).json({ error: "Cloudflare config not found" });
    return;
  }

  try {
    const zones = await getCloudflareZones(config.get("apiToken") as string);
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
  const config = await CloudflareConfig.findOne({ id: params.data.id });
  if (!config) {
    res.status(404).json({ error: "Cloudflare config not found" });
    return;
  }

  const result = await createDnsRecord(
    config.get("apiToken") as string,
    parsed.data.zoneId,
    parsed.data.domain,
    parsed.data.ip,
    parsed.data.proxied ?? true
  );

  const actId = await nextId("activity");
  await Activity.create({
    id: actId,
    type: "dns_setup",
    status: result.success ? "success" : "failure",
    message: result.success
      ? `DNS record created for ${parsed.data.domain}`
      : `DNS record creation failed for ${parsed.data.domain}`,
    details: result.output,
    createdAt: new Date(),
  });

  res.json(result);
});

export default router;
