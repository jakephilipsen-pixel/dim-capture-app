import { Router, raw } from "express";
import { z } from "zod";
import { AppError } from "../lib/errors";
import { getDim, listDims, saveDim, setDimPhoto, updateDim } from "../services/dimService";
import { findPhoto, savePhoto, MAX_PHOTO_BYTES } from "../services/photoService";

const router = Router();

const idParams = z.object({
  id: z.coerce.number().int().positive("id must be a positive integer"),
});

/** Parse :id from req.params or throw a 400 — shared by the photo routes. */
function parseId(params: unknown): number {
  const parsed = idParams.safeParse(params);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? "invalid id", 400);
  }
  return parsed.data.id;
}

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
    res.json(await updateDim(parseId(req.params), req.body));
  } catch (err) {
    next(err);
  }
});

// POST /api/dims/:id/photo — attach a carton photo (Floor flow). The body is the
// raw JPEG bytes (Content-Type image/jpeg), parsed by a route-local `raw` parser
// so it bypasses the app-wide JSON parser and its small limit. 404 if the dim is
// unknown, 422 if the bytes aren't a JPEG / are empty / exceed the size ceiling.
router.post(
  "/:id/photo",
  raw({ type: "image/jpeg", limit: MAX_PHOTO_BYTES }),
  async (req, res, next) => {
    try {
      const id = parseId(req.params);
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      await getDim(id); // 404 BEFORE writing — no orphan JPEG for an unknown dim id
      const photoPath = await savePhoto(id, bytes);
      res.json(await setDimPhoto(id, photoPath));
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/dims/:id/photo — stream a dim's carton JPEG. 404 if none on disk.
router.get("/:id/photo", async (req, res, next) => {
  try {
    const abs = await findPhoto(parseId(req.params));
    if (!abs) {
      throw new AppError("no photo for this dim", 404);
    }
    res.type("image/jpeg").sendFile(abs);
  } catch (err) {
    next(err);
  }
});

export default router;
