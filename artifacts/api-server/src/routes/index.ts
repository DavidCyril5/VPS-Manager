import { Router, type IRouter } from "express";
import healthRouter from "./health";
import serversRouter from "./servers";
import sitesRouter from "./sites";
import cloudflareRouter from "./cloudflare";
import activityRouter from "./activity";

const router: IRouter = Router();

router.use(healthRouter);
router.use(serversRouter);
router.use(sitesRouter);
router.use(cloudflareRouter);
router.use(activityRouter);

export default router;
