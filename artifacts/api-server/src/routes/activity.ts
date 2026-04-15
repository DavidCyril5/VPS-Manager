import { Router, type IRouter } from "express";
import { Activity, Server, Site } from "../lib/db";

const router: IRouter = Router();

router.get("/activity", async (_req, res): Promise<void> => {
  const entries = await Activity.find().sort({ createdAt: -1 }).limit(100);
  res.json(entries.map((e) => e.toObject()));
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
