import { Router, type IRouter } from "express";
import crypto from "crypto";
import { Settings, getSettings } from "../lib/db";

const router: IRouter = Router();

router.get("/settings", async (_req, res): Promise<void> => {
  const s = await getSettings();
  res.json({ alertWebhookUrl: s.alertWebhookUrl ?? null, hasAdminPassword: !!s.adminPasswordHash });
});

router.patch("/settings", async (req, res): Promise<void> => {
  const { alertWebhookUrl, adminPassword } = req.body as { alertWebhookUrl?: string | null; adminPassword?: string };
  const update: Record<string, unknown> = {};
  if (alertWebhookUrl !== undefined) update.alertWebhookUrl = alertWebhookUrl || null;
  if (adminPassword) {
    update.adminPasswordHash = crypto.createHash("sha256").update(adminPassword).digest("hex");
  }
  await Settings.findOneAndUpdate({ _key: "global" }, update, { upsert: true });
  const s = await getSettings();
  res.json({ alertWebhookUrl: s.alertWebhookUrl ?? null, hasAdminPassword: !!s.adminPasswordHash });
});

export default router;
