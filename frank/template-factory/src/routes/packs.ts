import { Router } from "express";
import { internalAuth } from "../auth.js";

const router = Router();
router.use(internalAuth);

// ---------------------------------------------------------------------------
// Stub routes — full implementation in Phase 4
// ---------------------------------------------------------------------------

/** POST /packs — create a new template pack (stub). */
router.post("/", (_req, res) => {
  res.status(501).json({ error: "not implemented", phase: 4 });
});

/** GET /packs — list template packs (stub). */
router.get("/", (_req, res) => {
  res.status(501).json({ error: "not implemented", phase: 4 });
});

/** GET /packs/:packId — get a specific pack (stub). */
router.get("/:packId", (_req, res) => {
  res.status(501).json({ error: "not implemented", phase: 4 });
});

/** POST /packs/:packId/sign — sign a completed pack (stub). */
router.post("/:packId/sign", (_req, res) => {
  res.status(501).json({ error: "not implemented", phase: 4 });
});

export default router;
