import https from "https";
import http from "http";
import { Site, Server, Activity, nextId, getSettings } from "./db";
import { runSshCommand } from "./ssh";
import { logger } from "./logger";

const MONITOR_INTERVAL_MS = 5 * 60 * 1000;

async function pingDomain(domain: string, ssl: boolean): Promise<{ up: boolean; statusCode: number }> {
  const url = ssl ? `https://${domain}` : `http://${domain}`;
  try {
    const mod = ssl ? https : http;
    const statusCode = await new Promise<number>((resolve, reject) => {
      const r = mod.get(
        url,
        { headers: { "User-Agent": "VPS-Manager-Monitor/1.0" }, timeout: 12000 },
        (resp) => { resp.resume(); resolve(resp.statusCode ?? 0); }
      );
      r.on("error", reject);
      r.on("timeout", () => { r.destroy(); reject(new Error("timeout")); });
    });
    return { up: statusCode >= 200 && statusCode < 400, statusCode };
  } catch {
    return { up: false, statusCode: 0 };
  }
}

async function sendHealWebhook(siteName: string, domain: string, message: string): Promise<void> {
  try {
    const settings = await getSettings();
    const url = settings.alertWebhookUrl as string | null;
    if (!url) return;
    const payload = JSON.stringify({
      event: "auto_heal",
      site: siteName,
      domain,
      message,
      timestamp: new Date().toISOString(),
    });
    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? https : http;
    await new Promise<void>((resolve) => {
      const req = mod.request(
        url,
        { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } },
        () => resolve()
      );
      req.on("error", () => resolve());
      req.write(payload);
      req.end();
    });
  } catch (_) {}
}

export async function runAutoHealCheck(): Promise<void> {
  try {
    const sites = await Site.find({});
    if (!sites.length) return;

    for (const site of sites) {
      const d = site.toObject() as Record<string, unknown>;
      const domain = d.domain as string;
      const ssl = d.sslInstalled as boolean;
      const siteType = d.siteType as string;
      const siteId = d.id as number;
      const serverId = d.serverId as number;
      const siteName = d.name as string;

      try {
        const { up, statusCode } = await pingDomain(domain, ssl);
        if (up) continue;

        logger.warn({ domain, statusCode }, "Auto-heal: site is down");

        if (siteType === "nodejs" || siteType === "python") {
          const server = await Server.findOne({ id: serverId });
          if (!server) continue;

          const s = server.toObject() as Record<string, unknown>;
          const sshOpts = {
            host: s.host as string,
            port: s.port as number,
            username: s.username as string,
            password: s.password as string,
            privateKey: s.privateKey ? (s.privateKey as string) : null,
          };

          const pm2Name = domain.replace(/[^a-zA-Z0-9]/g, "-");
          const cmd = `pm2 restart "${pm2Name}" 2>&1 || pm2 startOrRestart /tmp/pm2-${pm2Name}.json 2>&1`;
          const result = await runSshCommand(sshOpts, cmd, 30000);

          const message = result.success
            ? `Auto-healed: ${domain} was down (HTTP ${statusCode || "error"}), PM2 restarted successfully`
            : `Auto-heal failed: ${domain} was down, PM2 restart unsuccessful`;

          await Activity.create({
            id: await nextId("activity"),
            siteId,
            serverId,
            type: "auto_heal",
            status: result.success ? "success" : "failure",
            message,
            details: result.output ?? null,
            createdAt: new Date(),
          });

          await sendHealWebhook(siteName, domain, message);
          logger.info({ domain, success: result.success }, "Auto-heal: PM2 restart attempted");
        } else {
          const message = `Monitor alert: ${domain} is down (HTTP ${statusCode || "error"}). Static site — manual intervention needed.`;
          await Activity.create({
            id: await nextId("activity"),
            siteId,
            serverId,
            type: "auto_heal",
            status: "failure",
            message,
            details: null,
            createdAt: new Date(),
          });
          await sendHealWebhook(siteName, domain, message);
        }
      } catch (err) {
        logger.error({ domain, err }, "Auto-heal: error checking site");
      }
    }
  } catch (err) {
    logger.error({ err }, "Auto-heal job failed");
  }
}

export function startAutoHealMonitor(): void {
  setTimeout(() => { void runAutoHealCheck(); }, 30 * 1000);
  setInterval(() => { void runAutoHealCheck(); }, MONITOR_INTERVAL_MS);
  logger.info({ intervalMs: MONITOR_INTERVAL_MS }, "Auto-heal monitor started (checks every 5 min)");
}
