import { Router } from "express";
import { syncUnsyncedDims } from "../services/syncService";

const router = Router();

// POST /api/sync/cc — push all unsynced dims to CartonCloud in batches of 10.
// Returns a { synced, failed, pending } report.
router.post("/cc", async (_req, res, next) => {
  try {
    res.json(await syncUnsyncedDims());
  } catch (err) {
    next(err);
  }
});

export default router;
