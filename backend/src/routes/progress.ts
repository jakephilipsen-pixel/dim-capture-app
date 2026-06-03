import { Router } from "express";
import { getProgress } from "../services/skuService";

const router = Router();

// GET /api/progress — capture-progress summary from live DB counts.
// Top-level per dim-capture-app-spec.md (not under /api/admin); see DECISIONS.md.
router.get("/", async (_req, res, next) => {
  try {
    res.json(await getProgress());
  } catch (err) {
    next(err);
  }
});

export default router;
