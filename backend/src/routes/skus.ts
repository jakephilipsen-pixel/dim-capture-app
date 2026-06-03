import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/errors";
import { getSkuByBarcode, listSkus } from "../services/skuService";

const router = Router();

const barcodeParams = z.object({
  barcode: z.string().trim().min(1, "barcode is required"),
});

// GET /api/skus — all SKUs with local dim-capture status + totals.
router.get("/", async (_req, res, next) => {
  try {
    res.json(await listSkus());
  } catch (err) {
    next(err);
  }
});

// GET /api/skus/:barcode — DB-first lookup, CC fallback, 404 if neither.
router.get("/:barcode", async (req, res, next) => {
  try {
    const parsed = barcodeParams.safeParse(req.params);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues[0]?.message ?? "invalid barcode", 400);
    }
    res.json(await getSkuByBarcode(parsed.data.barcode));
  } catch (err) {
    next(err);
  }
});

export default router;
