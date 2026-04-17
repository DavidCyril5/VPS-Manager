import { Router, type IRouter } from "express";
import healthRouter from "./health";
import serversRouter from "./servers";
import sitesRouter from "./sites";
import cloudflareRouter from "./cloudflare";
import activityRouter from "./activity";
import gitTokensRouter from "./gitTokens";
import settingsRouter from "./settings";
import authRouter from "./auth";

const router: IRouter = Router();

router.use(authRouter);
router.use(healthRouter);
router.use(serversRouter);
router.use(sitesRouter);
router.use(cloudflareRouter);
router.use(activityRouter);
router.use(gitTokensRouter);
router.use(settingsRouter);

export default router;
