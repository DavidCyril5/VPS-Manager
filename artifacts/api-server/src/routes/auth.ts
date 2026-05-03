import { Router, type IRouter } from "express";
import crypto from "crypto";
import { getSettings } from "../lib/db";

const router: IRouter = Router();

function makeToken(): string {
  const secret = process.env["SESSION_SECRET"] ?? "fallback-secret";
  const payload = `vps-manager-auth:${Date.now()}`;
  return crypto.createHmac("sha256", secret).update(payload).digest("hex") + "." + Buffer.from(payload).toString("base64");
}

export function verifyToken(token: string): boolean {
  const adminPassword = process.env["ADMIN_PASSWORD"];
  if (!adminPassword) return true;
  if (!token) return false;
  const secret = process.env["SESSION_SECRET"] ?? "fallback-secret";
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [sig, payloadB64] = parts;
  const payload = Buffer.from(payloadB64, "base64").toString("utf8");
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return sig === expected;
}

router.post("/auth/login", async (req, res): Promise<void> => {
  const adminPassword = process.env["ADMIN_PASSWORD"];
  if (!adminPassword) {
    res.json({ token: "no-auth-required" });
    return;
  }
  const { password } = req.body as { password?: string };
  if (!password) { res.status(400).json({ error: "Password required" }); return; }

  const settings = await getSettings();
  const storedHash = settings.adminPasswordHash as string | null;

  const inputHash = crypto.createHash("sha256").update(password).digest("hex");
  const envHash = crypto.createHash("sha256").update(adminPassword).digest("hex");

  const valid = storedHash ? inputHash === storedHash : inputHash === envHash;
  if (!valid) { res.status(401).json({ error: "Invalid password" }); return; }

  res.json({ token: makeToken() });
});

router.get("/auth/check", (req, res): void => {
  const adminPassword = process.env["ADMIN_PASSWORD"];
  if (!adminPassword) { res.json({ required: false }); return; }
  const auth = req.headers["authorization"] ?? "";
  const token = auth.replace("Bearer ", "");
  res.json({ required: true, valid: verifyToken(token) });
});

export default router;
