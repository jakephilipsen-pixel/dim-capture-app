import { Router } from "express";
import { seedSkus } from "../services/skuService";

const router = Router();

// POST /api/admin/seed — pull all Forage products from CC into the SKU table.
// Idempotent (upsert by CC product id); safe to re-run.
router.post("/seed", async (_req, res, next) => {
  try {
    res.json(await seedSkus());
  } catch (err) {
    next(err);
  }
});

export default router;
