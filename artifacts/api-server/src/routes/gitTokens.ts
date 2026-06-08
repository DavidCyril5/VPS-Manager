import { Router, type IRouter } from "express";
import { GitToken, nextId } from "../lib/db";

const router: IRouter = Router();

function safeToken(doc: Record<string, unknown>) {
  return { ...doc, token: "***" };
}

router.get("/git-tokens", async (_req, res): Promise<void> => {
  const tokens = await GitToken.find().sort({ createdAt: -1 });
  res.json(tokens.map((t) => safeToken(t.toObject() as Record<string, unknown>)));
});

router.post("/git-tokens", async (req, res): Promise<void> => {
  const { label, host, token } = req.body as { label?: string; host?: string; token?: string };
  if (!label || !token) {
    res.status(400).json({ error: "label and token are required" });
    return;
  }
  const id = await nextId("gitTokens");
  const saved = await GitToken.create({
    id,
    label,
    host: host ?? "github.com",
    token,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  res.status(201).json(safeToken(saved.toObject() as Record<string, unknown>));
});

router.delete("/git-tokens/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const token = await GitToken.findOneAndDelete({ id });
  if (!token) { res.status(404).json({ error: "Token not found" }); return; }
  res.sendStatus(204);
});

router.get("/git-tokens/:id/resolve", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const token = await GitToken.findOne({ id });
  if (!token) { res.status(404).json({ error: "Token not found" }); return; }
  res.json({ token: token.get("token") as string });
});

export default router;
