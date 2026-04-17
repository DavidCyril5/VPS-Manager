import { Router, type IRouter } from "express";
import { Activity, Server, Site } from "../lib/db";

const router: IRouter = Router();

router.get("/activity", async (req, res): Promise<void> => {
  const { type, status, siteId, serverId, limit: limitQ } = req.query;
  const filter: Record<string, unknown> = {};
  if (type && type !== "all") filter.type = type;
  if (status && status !== "all") filter.status = status;
  if (siteId) filter.siteId = Number(siteId);
  if (serverId) filter.serverId = Number(serverId);

  const limit = Math.min(Number(limitQ) || 200, 500);
  const entries = await Activity.find(filter).sort({ createdAt: -1 }).limit(limit);

  const [sites, servers] = await Promise.all([
    Site.find({}, { id: 1, name: 1, domain: 1 }),
    Server.find({}, { id: 1, name: 1 }),
  ]);
  const siteMap = Object.fromEntries(sites.map((s) => [s.id, { name: s.name, domain: (s as unknown as Record<string, string>).domain }]));
  const serverMap = Object.fromEntries(servers.map((s) => [s.id, s.name]));

  res.json(entries.map((e) => {
    const obj = e.toObject() as Record<string, unknown>;
    if (obj.siteId) obj.siteName = (siteMap[obj.siteId as number] as { name: string } | undefined)?.name ?? null;
    if (obj.siteId) obj.siteDomain = (siteMap[obj.siteId as number] as { domain: string } | undefined)?.domain ?? null;
    if (obj.serverId) obj.serverName = serverMap[obj.serverId as number] ?? null;
    return obj;
  }));
});

router.delete("/activity", async (_req, res): Promise<void> => {
  await Activity.deleteMany({});
  res.json({ ok: true });
});

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [totalServers, totalSites, activeSites, sslEnabled, recentDeployments] = await Promise.all([
    Server.countDocuments(),
    Site.countDocuments(),
    Site.countDocuments({ status: "active" }),
    Site.countDocuments({ sslInstalled: true }),
    Activity.countDocuments({ createdAt: { $gte: oneDayAgo } }),
  ]);

  res.json({ totalServers, totalSites, activeSites, sslEnabled, recentDeployments });
});

export default router;
