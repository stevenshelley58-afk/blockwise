import { Router } from "express";

const router = Router();

/** GET /health — liveness check. */
router.get("/", (_req, res) => {
  res.json({ status: "ready", service: "frank-template-factory", version: "0.1.0" });
});

export default router;
