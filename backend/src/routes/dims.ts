import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/errors";
import { listDims, saveDim, updateDim } from "../services/dimService";

const router = Router();

const idParams = z.object({
  id: z.coerce.number().int().positive("id must be a positive integer"),
});

// POST /api/dims — save a capture (upsert: one dim per SKU). 422 on bad dims,
// 404 on unknown skuId. Returns the saved Dim.
router.post("/", async (req, res, next) => {
  try {
    res.json(await saveDim(req.body));
  } catch (err) {
    next(err);
  }
});

// GET /api/dims — all captures, most-recent first, with joined SKU name.
router.get("/", async (_req, res, next) => {
  try {
    res.json(await listDims());
  } catch (err) {
    next(err);
  }
});

// PUT /api/dims/:id — correct a dim; resets sync state. 404 if id unknown.
router.put("/:id", async (req, res, next) => {
  try {
    const parsed = idParams.safeParse(req.params);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues[0]?.message ?? "invalid id", 400);
    }
    res.json(await updateDim(parsed.data.id, req.body));
  } catch (err) {
    next(err);
  }
});

export default router;
