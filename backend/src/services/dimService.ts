/**
 * Dim service — the business logic behind the dim-api routes (module 04).
 *
 * Routes (`routes/dims.ts`) are thin wrappers; everything testable lives here.
 * Depends only on the `prisma` singleton (backend-core). Unit tests mock it.
 *
 * Schema invariant (backend-core): `Dim.skuId @unique` — exactly ONE dim row
 * per SKU. A `POST /api/dims` for a SKU that already has a dim is therefore an
 * UPSERT (overwrite), not a second insert — and an overwrite is a re-capture,
 * so it resets the CC sync state just like a `PUT` correction does.
 * (DECISIONS.md 2026-06-03.)
 *
 * Units: L/W/H are millimetres, weight is kilograms — stored verbatim, exactly
 * as CC expects them (cc-client passes them through with no conversion).
 */
import { z } from "zod";
import { prisma } from "../lib/db";
import { AppError } from "../lib/errors";

/** A captured dim joined to its SKU's identity — the shape `GET /api/dims` returns. */
export interface DimWithSku {
  id: number;
  skuId: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightKg: number;
  measuredBy: string;
  measuredAt: Date;
  syncedToCC: boolean;
  syncedAt: Date | null;
  notes: string | null;
  sku: { name: string; barcode: string };
}

/**
 * `POST /api/dims` body. All four measurements must be strictly positive
 * (rejected → 422), `skuId`/`measuredBy` non-blank, `notes` optional.
 */
export const captureSchema = z.object({
  skuId: z.string().trim().min(1, "skuId is required"),
  lengthMm: z.number().positive("lengthMm must be greater than 0"),
  widthMm: z.number().positive("widthMm must be greater than 0"),
  heightMm: z.number().positive("heightMm must be greater than 0"),
  weightKg: z.number().positive("weightKg must be greater than 0"),
  measuredBy: z.string().trim().min(1, "measuredBy is required"),
  notes: z.string().trim().optional(),
});
export type CaptureInput = z.infer<typeof captureSchema>;

/**
 * `PUT /api/dims/:id` body — a correction. Same measurements as a capture but
 * the SKU can't be reassigned, so `skuId` is dropped.
 */
export const correctionSchema = captureSchema.omit({ skuId: true });
export type CorrectionInput = z.infer<typeof correctionSchema>;

/** Validate `raw` against `schema`, surfacing the first issue as a 422. */
function validate<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? "invalid request body", 422);
  }
  return parsed.data;
}

/**
 * Save a capture. Validates the body, confirms the SKU exists (404 if not),
 * then upserts the SKU's single dim row. An overwrite (re-capture) resets
 * `syncedToCC`/`syncedAt` and re-stamps `measuredAt` so the new dims re-sync.
 */
export async function saveDim(raw: unknown) {
  const input = validate(captureSchema, raw);

  const sku = await prisma.sku.findUnique({ where: { id: input.skuId } });
  if (!sku) {
    throw new AppError(`Unknown skuId: ${input.skuId}`, 404);
  }

  const measurements = {
    lengthMm: input.lengthMm,
    widthMm: input.widthMm,
    heightMm: input.heightMm,
    weightKg: input.weightKg,
    measuredBy: input.measuredBy,
    notes: input.notes ?? null,
  };

  return prisma.dim.upsert({
    where: { skuId: input.skuId },
    create: { skuId: input.skuId, ...measurements },
    // Re-capture: overwrite measurements and force a re-sync.
    update: { ...measurements, measuredAt: new Date(), syncedToCC: false, syncedAt: null },
  });
}

/** All captured dims, most-recent first, joined to their SKU name + barcode. */
export async function listDims(): Promise<DimWithSku[]> {
  return prisma.dim.findMany({
    orderBy: { measuredAt: "desc" },
    include: { sku: { select: { name: true, barcode: true } } },
  });
}

/**
 * Correct an existing dim by id. Validates the body, confirms the row exists
 * (404 if not), overwrites the measurements, and unconditionally resets the CC
 * sync state (`syncedToCC = false`, `syncedAt = null`) so the correction
 * re-syncs on the next `POST /api/sync/cc`.
 */
export async function updateDim(id: number, raw: unknown) {
  const input = validate(correctionSchema, raw);

  const existing = await prisma.dim.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(`Dim ${id} not found`, 404);
  }

  return prisma.dim.update({
    where: { id },
    data: {
      lengthMm: input.lengthMm,
      widthMm: input.widthMm,
      heightMm: input.heightMm,
      weightKg: input.weightKg,
      measuredBy: input.measuredBy,
      notes: input.notes ?? null,
      measuredAt: new Date(),
      syncedToCC: false,
      syncedAt: null,
    },
  });
}
