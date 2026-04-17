import { Router, type IRouter } from "express";
import { Settings, getSettings } from "../lib/db";

const router: IRouter = Router();

router.get("/settings", async (_req, res): Promise<void> => {
  const s = await getSettings();
  res.json({ alertWebhookUrl: s.alertWebhookUrl ?? null });
});

router.patch("/settings", async (req, res): Promise<void> => {
  const { alertWebhookUrl } = req.body as { alertWebhookUrl?: string | null };
  const update: Record<string, unknown> = {};
  if (alertWebhookUrl !== undefined) update.alertWebhookUrl = alertWebhookUrl || null;
  await Settings.findOneAndUpdate({ _key: "global" }, update, { upsert: true });
  const s = await getSettings();
  res.json({ alertWebhookUrl: s.alertWebhookUrl ?? null });
});

export default router;
