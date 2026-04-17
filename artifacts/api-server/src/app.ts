import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/logger";
import { verifyToken } from "./routes/auth";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", (req: Request, res: Response, next: NextFunction): void => {
  const adminPassword = process.env["ADMIN_PASSWORD"];
  if (!adminPassword) { next(); return; }

  const skipPaths = ["/api/auth/login", "/api/auth/check", "/api/health"];
  if (skipPaths.some((p) => req.path === p || req.path.startsWith(p))) { next(); return; }

  if (req.path.includes("/webhook/")) { next(); return; }

  const auth = req.headers["authorization"] ?? "";
  const token = auth.replace("Bearer ", "");
  if (!verifyToken(token)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});

app.use("/api", router);

// Serve built frontend in production
if (process.env["NODE_ENV"] === "production") {
  const staticDir = path.resolve(__dirname, "../../vps-manager/dist/public");
  app.use(express.static(staticDir));
  app.get("/*", (_req: Request, res: Response) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

export default app;
