/**
 * SKU service — the business logic behind the sku-seed routes (module 03).
 *
 * Routes (`routes/skus.ts`, `routes/admin.ts`, `routes/progress.ts`) are thin
 * wrappers; everything testable lives here. Depends on the `prisma` singleton
 * (backend-core) and the `ccClient` singleton (cc-client). Unit tests mock both.
 *
 * Units are not the concern of this module — it only stores/reads SKU identity
 * and capture status. Dim values + CC dim sync live in dim-api (module 04).
 */
import { prisma } from "../lib/db";
import { AppError } from "../lib/errors";
import { logger } from "../middleware/logger";
import { ccClient, CcApiError, CcRateLimitError, CcTimeoutError, type CcProduct } from "./ccClient";

const log = logger.child({ module: "skuService" });

/** CC list page size for the seed pull (spec: pageSize=100). */
const SEED_PAGE_SIZE = 100;

/** One SKU as the list/capture UI sees it. */
export interface SkuSummary {
  id: string;
  code: string | null; // SKU code (references.code), for code-based search
  barcode: string | null; // from the default/first UoM; null if none
  name: string;
  hasDims: boolean; // a local Dim row exists for this SKU
}

/** `GET /api/skus` response. */
export interface SkuListResponse {
  total: number;
  captured: number; // SKUs with a local Dim
  skus: SkuSummary[];
}

/** `GET /api/skus/:barcode` response. `source` records where the hit came from. */
export interface SkuDetail {
  id: string;
  code: string | null;
  barcode: string | null;
  name: string;
  hasDims: boolean;
  ccDimsCaptured: boolean;
  source: "db" | "cc";
}

/** `GET /api/progress` response. */
export interface ProgressResponse {
  total: number;
  captured: number;
  syncedToCC: number;
  pendingSync: number; // captured, not yet synced, NOT name-blocked (i.e. retryable)
  blocked: number; // captured dims CC refuses (name-poison) — terminal until re-capture
  percentage: number; // captured/total * 100, one decimal place
}

/** `POST /api/admin/seed` response. */
export interface SeedReport {
  pages: number; // CC pages pulled (with data)
  fetched: number; // products returned by CC
  upserted: number; // products written to the DB (fetched minus malformed)
  ccDimsPresent: number; // of those, how many already had dims in CC
}

/** A product "has dims in CC" when L/W/H are all present (weight is optional). */
function hasCcDims(p: CcProduct): boolean {
  return p.length !== null && p.width !== null && p.height !== null;
}

/**
 * Pull every Forage product from CartonCloud into the local Sku table.
 * Idempotent: upserts by CC product id, so re-running never duplicates rows.
 * Paginates until CC returns a short (or empty) page.
 */
export async function seedSkus(): Promise<SeedReport> {
  let page = 1;
  let pages = 0;
  let fetched = 0;
  let upserted = 0;
  let ccDimsPresent = 0;

  for (;;) {
    // M2a: CcRateLimitError from the seed bucket → 429 (our limiter rejected it,
    // not CC). CcTimeoutError/CcApiError → 502/504 (upstream problem). These are
    // not per-item failures — they abort the whole seed run so the caller knows
    // to retry later.
    let products;
    try {
      products = await ccClient.listProducts(page, SEED_PAGE_SIZE);
    } catch (err) {
      if (err instanceof CcRateLimitError) {
        log.warn({ page }, "seed rate limit hit — seed bucket exhausted");
        throw new AppError("Seed unavailable — rate limit exceeded. Try again shortly.", 429);
      }
      if (err instanceof CcTimeoutError) {
        log.error({ page }, "CC request timed out during seed");
        throw new AppError("Seed failed — CartonCloud request timed out", 504);
      }
      if (err instanceof CcApiError) {
        log.error({ page, ccStatus: err.statusCode }, "CC API error during seed");
        throw new AppError("Seed failed — upstream CartonCloud error", 502);
      }
      throw err;
    }
    if (products.length === 0) break;
    pages += 1;
    fetched += products.length;

    for (const p of products) {
      // id is the primary key — a CC row missing it can't be stored, so skip it
      // rather than crash the whole seed. barcode is now nullable (it lives on the
      // UoM and not every product has one); a barcode-less SKU is still stored
      // (findable by code) but isn't scannable.
      if (!p.id) {
        log.warn({ code: p.code }, "skipping CC product missing id");
        continue;
      }
      const ccDims = hasCcDims(p);
      await prisma.sku.upsert({
        where: { id: p.id },
        create: { id: p.id, code: p.code, barcode: p.barcode, name: p.name, ccDimsCaptured: ccDims },
        update: { code: p.code, barcode: p.barcode, name: p.name, ccDimsCaptured: ccDims },
      });
      upserted += 1;
      if (ccDims) ccDimsPresent += 1;
    }

    if (products.length < SEED_PAGE_SIZE) break;
    page += 1;
  }

  log.info({ pages, fetched, upserted, ccDimsPresent }, "seed complete");
  return { pages, fetched, upserted, ccDimsPresent };
}

/** All SKUs with local dim-capture status, plus total/captured counts. */
export async function listSkus(): Promise<SkuListResponse> {
  const rows = await prisma.sku.findMany({
    select: {
      id: true,
      code: true,
      barcode: true,
      name: true,
      dims: { select: { id: true } },
    },
    orderBy: { name: "asc" },
  });

  const skus: SkuSummary[] = rows.map((r) => ({
    id: r.id,
    code: r.code,
    barcode: r.barcode,
    name: r.name,
    hasDims: r.dims !== null,
  }));
  const captured = skus.reduce((n, s) => n + (s.hasDims ? 1 : 0), 0);

  return { total: skus.length, captured, skus };
}

/**
 * Look up a SKU by barcode. Local DB first; on a miss, fall back to a CC API
 * lookup and upsert the result locally so the next call is a DB hit. Throws a
 * 404 `AppError` when neither the DB nor CC knows the barcode.
 */
export async function getSkuByBarcode(barcode: string): Promise<SkuDetail> {
  const local = await prisma.sku.findUnique({
    where: { barcode },
    select: {
      id: true,
      code: true,
      barcode: true,
      name: true,
      ccDimsCaptured: true,
      dims: { select: { id: true } },
    },
  });
  if (local) {
    return {
      id: local.id,
      code: local.code,
      barcode: local.barcode,
      name: local.name,
      hasDims: local.dims !== null,
      ccDimsCaptured: local.ccDimsCaptured,
      source: "db",
    };
  }

  // S3a — CcApiError/CcRateLimitError must not propagate as non-AppError: they
  // would reach errorHandler as unknown errors and (a) leak CC error strings and
  // (b) return 500. Map them to safe AppErrors before they leave this service.
  // CcTimeoutError (module 10): checked before the generic CcApiError branch since
  // it extends CcApiError but warrants a more precise 504 status.
  let product: CcProduct | null;
  try {
    product = await ccClient.lookupByBarcode(barcode);
  } catch (err) {
    if (err instanceof CcRateLimitError) {
      log.warn({ barcode }, "CC rate limit hit during barcode fallback");
      throw new AppError("Product lookup unavailable — upstream rate limit", 503);
    }
    if (err instanceof CcTimeoutError) {
      log.warn({ barcode }, "CC request timed out during barcode fallback");
      throw new AppError("Product lookup failed — upstream timeout", 504);
    }
    if (err instanceof CcApiError) {
      log.error({ barcode, ccStatus: err.statusCode }, "CC API error during barcode fallback");
      throw new AppError("Product lookup failed — upstream error", 502);
    }
    throw err;
  }

  if (!product || !product.id) {
    throw new AppError(`SKU not found for barcode ${barcode}`, 404);
  }

  const ccDims = hasCcDims(product);
  // Upsert by id (not create) so a barcode miss whose product id already exists
  // can't blow up on the unique-id constraint. Store the SCANNED barcode so the
  // next scan of it is a DB hit (it matched one of the product's UoM barcodes).
  const saved = await prisma.sku.upsert({
    where: { id: product.id },
    create: {
      id: product.id,
      code: product.code,
      barcode,
      name: product.name,
      ccDimsCaptured: ccDims,
    },
    update: { code: product.code, barcode, name: product.name, ccDimsCaptured: ccDims },
    select: {
      id: true,
      code: true,
      barcode: true,
      name: true,
      ccDimsCaptured: true,
      dims: { select: { id: true } },
    },
  });

  log.info({ barcode, id: saved.id }, "barcode resolved via CC fallback and upserted");
  return {
    id: saved.id,
    code: saved.code,
    barcode: saved.barcode,
    name: saved.name,
    hasDims: saved.dims !== null,
    ccDimsCaptured: saved.ccDimsCaptured,
    source: "cc",
  };
}

/**
 * Capture-progress summary from live DB counts.
 *
 * M1 fix: the counts are issued inside a single `prisma.$transaction([...])`
 * (batch / read-only form) so they share one consistent DB snapshot.  Without this,
 * a concurrent write between any two of the `count()` calls can produce an
 * incoherent result (e.g. `captured > total`, or `syncedToCC > captured`).
 *
 * Module 16: `pendingSync` counts only RETRYABLE unsynced dims
 * (`syncedToCC:false, syncBlockedReason:null`), matching syncService's retry
 * predicate — so name-blocked dims don't keep the dashboard / auto-sync pinned
 * forever. `blocked` is reported separately.
 */
export async function getProgress(): Promise<ProgressResponse> {
  const [total, captured, syncedToCC, pendingSync, blocked] = await prisma.$transaction([
    prisma.sku.count(),
    prisma.dim.count(),
    prisma.dim.count({ where: { syncedToCC: true } }),
    prisma.dim.count({ where: { syncedToCC: false, syncBlockedReason: null } }),
    prisma.dim.count({ where: { syncBlockedReason: { not: null } } }),
  ]);

  const percentage = total === 0 ? 0 : Math.round((captured / total) * 1000) / 10;

  return { total, captured, syncedToCC, pendingSync, blocked, percentage };
}
