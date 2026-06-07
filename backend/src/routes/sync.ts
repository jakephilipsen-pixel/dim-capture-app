import { Router } from "express";
import { requireSyncKey } from "../middleware/requireSyncKey";
import { syncUnsyncedDims } from "../services/syncService";

const router = Router();

// POST /api/sync/cc — push all unsynced dims to CartonCloud in batches of 10.
// Returns a { synced, failed, pending } report.
// requireSyncKey gates this route (module 12 / S6): X-Sync-Key must match
// SYNC_SECRET; missing secret → 503 fail-closed; wrong key → 401.
router.post("/cc", requireSyncKey, async (_req, res, next) => {
  try {
    res.json(await syncUnsyncedDims());
  } catch (err) {
    next(err);
  }
});

export default router;
