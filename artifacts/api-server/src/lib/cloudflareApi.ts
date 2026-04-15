import { logger } from "./logger";

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
