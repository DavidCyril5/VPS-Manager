import https from "https";
import http from "http";
import { Site, Server, Activity, nextId, getSettings } from "./db";
import { runSshCommand } from "./ssh";
import { logger } from "./logger";

const MONITOR_INTERVAL_MS = 5 * 60 * 1000;

const RESERVED_PORTS = new Set([
  3306, 5432, 5433, 6379, 6000, 6001, 8080, 8443, 8888,
  9090, 9200, 9300, 27017, 27018, 11211, 2181, 2375, 2376,
]);

interface SshOpts {
  host: string;
  port: number;
  username: string;
  password: string;
  privateKey: string | null;
}

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

async function findNextFreePort(sshOpts: SshOpts, serverId: number, currentPort: number): Promise<number | null> {
  const serverPorts = new Set<number>();
  const ssResult = await runSshCommand(
    sshOpts,
    "ss -tlnp 2>/dev/null | awk 'NR>1 {print $4}' | grep -oE '[0-9]+$' | sort -un",
    10000
  ).catch(() => null);
  if (ssResult?.success) {
    for (const line of ssResult.output.split("\n")) {
      const p = parseInt(line.trim(), 10);
      if (!isNaN(p) && p > 0) serverPorts.add(p);
    }
  }

  const dbPorts = new Set<number>();
  const allSites = await Site.find({ serverId, port: { $ne: null } });
  for (const s of allSites) {
    const p = (s.toObject() as Record<string, unknown>).port as number | null;
    if (p && p !== currentPort) dbPorts.add(p);
  }

  let port = 3001;
  while (port <= 9999) {
    if (!serverPorts.has(port) && !dbPorts.has(port) && !RESERVED_PORTS.has(port)) return port;
    port++;
  }
  return null;
}

async function isPortConflicted(sshOpts: SshOpts, port: number, pm2Name: string): Promise<boolean> {
  const result = await runSshCommand(
    sshOpts,
    `ss -tlnp 2>/dev/null | grep ':${port} ' || true`,
    10000
  ).catch(() => null);
  if (!result?.success) return false;
  const output = result.output.trim();
  if (!output) return false;
  const escapedName = pm2Name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const belongsToProcess = new RegExp(escapedName).test(output);
  return !belongsToProcess;
}

async function reassignPort(
  sshOpts: SshOpts,
  domain: string,
  pm2Name: string,
  deployPath: string,
  siteType: string,
  startCommand: string | null,
  newPort: number,
): Promise<{ success: boolean; output: string }> {
  const defaultStart = siteType === "python"
    ? `gunicorn app:app --bind 0.0.0.0:${newPort} --daemon`
    : "npm run start";
  const resolvedStart = startCommand || defaultStart;

  const pm2ConfigPath = `/tmp/pm2-${pm2Name}.json`;
  const pm2Config = JSON.stringify({
    name: pm2Name,
    script: siteType === "python" ? resolvedStart : "npm",
    args: siteType === "python" ? undefined : "run start",
    cwd: deployPath,
    env: { PORT: String(newPort), NODE_ENV: "production" },
  });

  const script = [
    `pm2 delete "${pm2Name}" 2>/dev/null || true`,
    `echo '${pm2Config.replace(/'/g, "\\'")}' > ${pm2ConfigPath}`,
    `pm2 start ${pm2ConfigPath}`,
    `pm2 save`,
    `sed -i 's|proxy_pass http://localhost:[0-9]*;|proxy_pass http://localhost:${newPort};|g' /etc/nginx/sites-available/${domain} 2>/dev/null || true`,
    `nginx -t && systemctl reload nginx`,
  ].join(" && ");

  return runSshCommand(sshOpts, script, 60000);
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
      const appPort = (d.port as number | null) || 3000;
      const deployPath = d.deployPath as string;
      const startCommand = (d.startCommand as string | null) || null;

      try {
        const { up, statusCode } = await pingDomain(domain, ssl);
        if (up) continue;

        logger.warn({ domain, statusCode }, "Auto-heal: site is down");

        if (siteType !== "nodejs" && siteType !== "python") {
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
          continue;
        }

        const server = await Server.findOne({ id: serverId });
        if (!server) continue;

        const s = server.toObject() as Record<string, unknown>;
        const sshOpts: SshOpts = {
          host: s.host as string,
          port: s.port as number,
          username: s.username as string,
          password: s.password as string,
          privateKey: s.privateKey ? (s.privateKey as string) : null,
        };

        const pm2Name = domain.replace(/[^a-zA-Z0-9]/g, "-");

        const conflicted = await isPortConflicted(sshOpts, appPort, pm2Name);

        let message: string;
        let success: boolean;
        let details: string;

        if (conflicted) {
          logger.warn({ domain, appPort }, "Auto-heal: port conflict detected — reassigning port");

          const newPort = await findNextFreePort(sshOpts, serverId, appPort);
          if (!newPort) {
            message = `Auto-heal failed: ${domain} port ${appPort} is conflicted and no free port found`;
            success = false;
            details = "Port exhaustion — all ports 3001–9999 are in use";
          } else {
            const result = await reassignPort(sshOpts, domain, pm2Name, deployPath, siteType, startCommand, newPort);
            if (result.success) {
              await Site.findOneAndUpdate({ id: siteId }, { port: newPort, updatedAt: new Date() });
              message = `Auto-healed: ${domain} port conflict on ${appPort} — reassigned to port ${newPort} and Nginx updated`;
            } else {
              message = `Auto-heal failed: ${domain} port conflict on ${appPort}, attempted reassign to ${newPort} but failed`;
            }
            success = result.success;
            details = result.output;
          }
        } else {
          const cmd = `pm2 restart "${pm2Name}" 2>&1 || pm2 startOrRestart /tmp/pm2-${pm2Name}.json 2>&1`;
          const result = await runSshCommand(sshOpts, cmd, 30000);
          success = result.success;
          details = result.output ?? "";
          message = result.success
            ? `Auto-healed: ${domain} was down (HTTP ${statusCode || "error"}), PM2 restarted successfully`
            : `Auto-heal failed: ${domain} was down, PM2 restart unsuccessful`;
        }

        await Activity.create({
          id: await nextId("activity"),
          siteId,
          serverId,
          type: "auto_heal",
          status: success ? "success" : "failure",
          message,
          details: details ?? null,
          createdAt: new Date(),
        });

        await sendHealWebhook(siteName, domain, message);
        logger.info({ domain, success, conflicted }, "Auto-heal: action completed");

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
