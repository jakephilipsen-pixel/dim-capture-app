import { Router } from "express";
import { requireSyncKey } from "../middleware/requireSyncKey";
import { seedSkus } from "../services/skuService";

const router = Router();

// POST /api/admin/seed — pull all Forage products from CC into the SKU table.
// Idempotent (upsert by CC product id); safe to re-run.
// requireSyncKey gates this route (module 12 / S6): X-Sync-Key must match
// SYNC_SECRET; missing secret → 503 fail-closed; wrong key → 401.
router.post("/seed", requireSyncKey, async (_req, res, next) => {
  try {
    res.json(await seedSkus());
  } catch (err) {
    next(err);
  }
});

export default router;
