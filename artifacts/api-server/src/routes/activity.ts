import { Router, type IRouter } from "express";
import { desc, count, eq, gte } from "drizzle-orm";
import { db, activityTable, serversTable, sitesTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/activity", async (_req, res): Promise<void> => {
  const entries = await db.select().from(activityTable).orderBy(desc(activityTable.createdAt)).limit(100);
  res.json(entries.map(e => ({
    ...e,
    createdAt: e.createdAt.toISOString(),
  })));
});

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const [serverCount] = await db.select({ value: count() }).from(serversTable);
  const [siteCount] = await db.select({ value: count() }).from(sitesTable);
  const [activeSiteCount] = await db.select({ value: count() }).from(sitesTable).where(eq(sitesTable.status, "active"));
  const [sslCount] = await db.select({ value: count() }).from(sitesTable).where(eq(sitesTable.sslInstalled, true));

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [recentDeploys] = await db.select({ value: count() }).from(activityTable)
    .where(gte(activityTable.createdAt, oneDayAgo));

  res.json({
    totalServers: serverCount?.value ?? 0,
    totalSites: siteCount?.value ?? 0,
    activeSites: activeSiteCount?.value ?? 0,
    sslEnabled: sslCount?.value ?? 0,
    recentDeployments: recentDeploys?.value ?? 0,
  });
});

export default router;
