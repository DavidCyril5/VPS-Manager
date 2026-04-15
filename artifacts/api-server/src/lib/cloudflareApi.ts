import { logger } from "./logger";

export interface CloudflareDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
}

export interface CloudflareZone {
  id: string;
  name: string;
  status: string;
}

export async function getCloudflareZones(apiToken: string): Promise<CloudflareZone[]> {
  const res = await fetch("https://api.cloudflare.com/client/v4/zones", {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    logger.warn({ status: res.status, body }, "Cloudflare zones fetch failed");
    throw new Error(`Cloudflare API error: ${res.status}`);
  }

  const data = (await res.json()) as { success: boolean; result: CloudflareZone[] };
  if (!data.success) {
    throw new Error("Cloudflare API returned success: false");
  }

  return data.result;
}

export async function listDnsRecords(
  apiToken: string,
  zoneId: string,
  name: string
): Promise<CloudflareDnsRecord[]> {
  const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?type=A&name=${encodeURIComponent(name)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
  });
  const data = (await res.json()) as { success: boolean; result: CloudflareDnsRecord[] };
  return data.success ? data.result : [];
}

export async function updateDnsRecord(
  apiToken: string,
  zoneId: string,
  recordId: string,
  name: string,
  ip: string,
  proxied: boolean
): Promise<{ success: boolean; output: string }> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${recordId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "A", name, content: ip, ttl: 1, proxied }),
  });
  const data = (await res.json()) as { success: boolean; errors: { message: string }[] };
  if (!data.success) {
    const errors = data.errors?.map((e) => e.message).join(", ") ?? "Unknown error";
    return { success: false, output: `DNS record update failed: ${errors}` };
  }
  return { success: true, output: `DNS A record updated: ${name} → ${ip}` };
}

export async function upsertDnsRecord(
  apiToken: string,
  zoneId: string,
  domain: string,
  ip: string,
  proxied = false
): Promise<{ success: boolean; output: string }> {
  const existing = await listDnsRecords(apiToken, zoneId, domain);
  if (existing.length > 0) {
    return updateDnsRecord(apiToken, zoneId, existing[0].id, domain, ip, proxied);
  }
  return createDnsRecord(apiToken, zoneId, domain, ip, proxied);
}

export function findMatchingZone(zones: CloudflareZone[], domain: string): CloudflareZone | null {
  const parts = domain.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join(".");
    const match = zones.find((z) => z.name === candidate);
    if (match) return match;
  }
  return null;
}

export async function createDnsRecord(
  apiToken: string,
  zoneId: string,
  domain: string,
  ip: string,
  proxied = true
): Promise<{ success: boolean; output: string }> {
  const name = domain.replace(/\.$/, "");
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "A",
      name,
      content: ip,
      ttl: 1,
      proxied,
    }),
  });

  const data = (await res.json()) as { success: boolean; errors: { message: string }[]; result?: { id: string } };

  if (!data.success) {
    const errors = data.errors?.map((e) => e.message).join(", ") ?? "Unknown error";
    return { success: false, output: `DNS record creation failed: ${errors}` };
  }

  return {
    success: true,
    output: `DNS A record created: ${name} → ${ip}${proxied ? " (proxied through Cloudflare)" : ""}`,
  };
}
