import { Router, type IRouter } from "express";
import { Settings, getSettings } from "../lib/db";

const router: IRouter = Router();

router.get("/settings", async (_req, res): Promise<void> => {
  const s = await getSettings();
  res.json({
    alertWebhookUrl: s.alertWebhookUrl ?? null,
    diskAlertThreshold: (s.diskAlertThreshold as number | null) ?? 85,
    ramAlertThreshold: (s.ramAlertThreshold as number | null) ?? 90,
  });
});

router.patch("/settings", async (req, res): Promise<void> => {
  const { alertWebhookUrl, diskAlertThreshold, ramAlertThreshold } = req.body as {
    alertWebhookUrl?: string | null;
    diskAlertThreshold?: number;
    ramAlertThreshold?: number;
  };
  const update: Record<string, unknown> = {};
  if (alertWebhookUrl !== undefined) update.alertWebhookUrl = alertWebhookUrl || null;
  if (diskAlertThreshold !== undefined) update.diskAlertThreshold = Number(diskAlertThreshold);
  if (ramAlertThreshold !== undefined) update.ramAlertThreshold = Number(ramAlertThreshold);
  await Settings.findOneAndUpdate({ _key: "global" }, update, { upsert: true });
  const s = await getSettings();
  res.json({
    alertWebhookUrl: s.alertWebhookUrl ?? null,
    diskAlertThreshold: (s.diskAlertThreshold as number | null) ?? 85,
    ramAlertThreshold: (s.ramAlertThreshold as number | null) ?? 90,
  });
});

export default router;
