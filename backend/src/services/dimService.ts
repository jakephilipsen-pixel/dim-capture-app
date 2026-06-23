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
 * Units: L/W/H are stored as millimetres (canonical), weight as kilograms.
 * CartonCloud's UoM L/W/H are METRES, so `ccClient.patchProductDims` converts
 * mm→m (÷1000) at the CC write boundary; storage here stays mm.
 */
import { z } from "zod";
import { prisma, withAdvisoryLock } from "../lib/db";
import { AppError } from "../lib/errors";

/**
 * Fixed namespace prefix for per-SKU advisory lock keys (S8 fix).
 *
 * We derive a per-SKU advisory lock key by hashing the skuId string into a
 * 63-bit value (Postgres advisory lock keys are signed `bigint`).  The namespace
 * prefix mixes into the hash so dim-capture keys never collide with other lock
 * key spaces (e.g. the sync C1 key in syncService.ts).
 *
 * The hash is FNV-1a 64-bit reduced to 63 bits (clear the MSB so the value is
 * always positive and fits Postgres's signed `bigint`).  Collision probability
 * is negligible for a small, stable set of CC product UUIDs.
 */
const DIM_CAPTURE_LOCK_NAMESPACE = "dim-capture:capture:";

/**
 * Derive a deterministic Postgres advisory lock key for a given SKU id.
 *
 * Uses FNV-1a 64-bit (offset basis + prime per spec) reduced to a positive
 * signed 63-bit bigint so it fits Postgres's `bigint` type.
 */
function skuLockKey(skuId: string): bigint {
  // FNV-1a 64-bit constants.
  const FNV_PRIME = 1099511628211n;
  const FNV_OFFSET = 14695981039346656037n;
  // Mask to keep values in the unsigned 64-bit range during accumulation.
  const MASK64 = (1n << 64n) - 1n;
  // Final mask to produce a positive signed 63-bit value.
  const MASK63 = (1n << 63n) - 1n;

  const input = DIM_CAPTURE_LOCK_NAMESPACE + skuId;
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash = (hash ^ BigInt(input.charCodeAt(i))) & MASK64;
    hash = (hash * FNV_PRIME) & MASK64;
  }
  return hash & MASK63;
}

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
  productType: string | null;
  photoPath: string | null;
  sku: { name: string; barcode: string | null };
}

/**
 * Carton classes the Floor capture screen offers (the Dry/Ambient/Chilled/Frozen
 * toggle). Stored verbatim; optional, so non-Floor captures omit it.
 */
export const PRODUCT_TYPES = ["Dry", "Ambient", "Chilled", "Frozen"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

/**
 * Sensible upper bounds for dimension values.
 *
 * M5 — "only > 0" accepted absurd values like 1e308. A 100 m (100,000 mm)
 * cap covers any realistic carton in a 3PL cold-store; 1,000 kg covers any
 * pallet a refrigerated truck can legally carry in Australia.
 *
 * M6 — `.finite()` produces a clear "Number must be finite" message when
 * JSON `Infinity`/`-Infinity` reaches the schema (previously zod yielded the
 * unhelpful "Expected number, received number" because Infinity is typeof number).
 */
const DIM_MM_MAX = 100_000; // 100 m — no single carton in this environment exceeds this
const WEIGHT_KG_MAX = 1_000; // 1,000 kg — maximum pallet weight on an Australian B-double

/**
 * Build a finite-and-bounded number field for a named dimension.
 *
 * In zod v4 `.finite()` is a no-op (the check runs at the type level and
 * emits the opaque "expected number, received number" message for Infinity).
 * We override that via the `error` callback so non-finite inputs produce a
 * clear "must be a finite number" message (M6), and then chain `.positive()`
 * and `.max()` for the positivity + upper-bound checks (M5).
 */
const dimMmField = (name: string) =>
  z
    .number({
      error: (issue) => {
        // Zod v4 surfaces Infinity/-Infinity as invalid_type before any
        // refinements; detect them here so the user gets a useful message.
        if (!Number.isFinite(issue.input as number) && typeof issue.input === "number") {
          return `${name} must be a finite number`;
        }
        return `${name} must be a number`;
      },
    })
    .positive(`${name} must be greater than 0`)
    .max(DIM_MM_MAX, `${name} must be at most ${DIM_MM_MAX} mm`);

/** Shared finite-and-bounded validator for a weight in kilograms. */
const weightKgField = z
  .number({
    error: (issue) => {
      if (!Number.isFinite(issue.input as number) && typeof issue.input === "number") {
        return "weightKg must be a finite number";
      }
      return "weightKg must be a number";
    },
  })
  .positive("weightKg must be greater than 0")
  .max(WEIGHT_KG_MAX, `weightKg must be at most ${WEIGHT_KG_MAX} kg`);

/**
 * `POST /api/dims` body. All four measurements must be strictly positive and
 * within sanity bounds (rejected → 422), `skuId`/`measuredBy` non-blank,
 * `notes` optional.
 */
export const captureSchema = z.object({
  skuId: z.string().trim().min(1, "skuId is required"),
  lengthMm: dimMmField("lengthMm"),
  widthMm: dimMmField("widthMm"),
  heightMm: dimMmField("heightMm"),
  weightKg: weightKgField,
  measuredBy: z.string().trim().min(1, "measuredBy is required"),
  notes: z.string().trim().optional(),
  // Floor: optional carton class. Constrained to the toggle's four values so a
  // typo can't reach the DB; omitted by the non-Floor capture page (still valid).
  productType: z.enum(PRODUCT_TYPES, { error: "productType must be Dry, Ambient, Chilled or Frozen" }).optional(),
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
 *
 * Concurrency (S8 fix — blocking advisory lock): the SKU-lookup + dim-upsert
 * sequence runs inside an advisory-locked interactive transaction keyed by the
 * SKU id (`skuLockKey`).  The lock is BLOCKING (`pg_advisory_xact_lock`) so
 * concurrent first-captures of the same SKU serialise rather than the loser
 * silently dropping its capture.  The loser waits for the winner's transaction
 * to commit, then proceeds with its own upsert (which hits the DO UPDATE path)
 * and returns a real row.  This prevents the previous 200-null data-loss path
 * (`pg_try_advisory_xact_lock` returning null → route sending HTTP 200 with
 * body `null` → frontend showing "Saved!" and removing the queue entry).
 *
 * Always returns the saved Dim on success.  Can only throw, never return null:
 *   - 422 if validation fails (thrown before the lock is acquired).
 *   - 404 if the SKU doesn't exist (thrown from inside the callback).
 */
export async function saveDim(raw: unknown): Promise<import("@prisma/client").Dim> {
  const input = validate(captureSchema, raw);

  const measurements = {
    lengthMm: input.lengthMm,
    widthMm: input.widthMm,
    heightMm: input.heightMm,
    weightKg: input.weightKg,
    measuredBy: input.measuredBy,
    notes: input.notes ?? null,
    productType: input.productType ?? null,
  };

  // blocking: true — use pg_advisory_xact_lock (BLOCKING variant).
  // The helper's return type is Promise<T | null>, but with blocking: true it
  // will never return null (contention makes callers wait, not bail).  Cast to
  // strip the null from the inferred type so callers have the correct contract.
  const result = await withAdvisoryLock(
    prisma,
    skuLockKey(input.skuId),
    async (tx) => {
      const sku = await tx.sku.findUnique({ where: { id: input.skuId } });
      if (!sku) {
        throw new AppError(`Unknown skuId: ${input.skuId}`, 404);
      }

      return tx.dim.upsert({
        where: { skuId: input.skuId },
        create: { skuId: input.skuId, ...measurements },
        // Re-capture: overwrite measurements and force a re-sync. Clearing
        // syncBlockedReason re-arms a previously name-poisoned dim for retry.
        update: {
          ...measurements,
          measuredAt: new Date(),
          syncedToCC: false,
          syncedAt: null,
          syncBlockedReason: null,
        },
      });
    },
    { blocking: true },
  );

  // TypeScript sees Promise<Dim | null> from withAdvisoryLock's signature, but
  // blocking mode NEVER returns null — the non-null assertion is safe by design.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return result!;
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
      productType: input.productType ?? null,
      measuredAt: new Date(),
      syncedToCC: false,
      syncedAt: null,
      syncBlockedReason: null,
    },
  });
}

/** Fetch one dim by id, or throw a 404. Lets the photo route confirm the dim
 * exists BEFORE writing a file to disk (no orphan JPEG for an unknown id). */
export async function getDim(id: number): Promise<import("@prisma/client").Dim> {
  const dim = await prisma.dim.findUnique({ where: { id } });
  if (!dim) {
    throw new AppError(`Dim ${id} not found`, 404);
  }
  return dim;
}

/**
 * Attach (or replace) the carton photo path on a dim. Called by the photo route
 * after the JPEG bytes have been written to disk. 404 if the dim id is unknown.
 * Does NOT touch the CC sync state — a photo is metadata that rides along with
 * the dims, not a re-measurement, so it must not trigger a re-sync on its own.
 */
export async function setDimPhoto(id: number, photoPath: string) {
  const existing = await prisma.dim.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(`Dim ${id} not found`, 404);
  }
  return prisma.dim.update({ where: { id }, data: { photoPath } });
}
