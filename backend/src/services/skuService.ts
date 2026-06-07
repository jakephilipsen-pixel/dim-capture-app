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
import { ccClient, CcApiError, CcRateLimitError, type CcProduct } from "./ccClient";

const log = logger.child({ module: "skuService" });

/** CC list page size for the seed pull (spec: pageSize=100). */
const SEED_PAGE_SIZE = 100;

/** One SKU as the list/capture UI sees it. */
export interface SkuSummary {
  id: string;
  barcode: string;
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
  barcode: string;
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
  pendingSync: number;
  percentage: number; // captured/total * 100, one decimal place
}

/** `POST /api/admin/seed` response. */
export interface SeedReport {
  pages: number; // CC pages pulled (with data)
  fetched: number; // products returned by CC
  upserted: number; // products written to the DB (fetched minus malformed)
  ccDimsPresent: number; // of those, how many already had dims in CC
}

/** Required for any CC-touching route. Surfaces as a 500 if unset. */
function warehouseId(): string {
  const id = process.env.CC_WAREHOUSE_ID;
  if (!id) {
    throw new AppError("CC_WAREHOUSE_ID is not configured", 500);
  }
  return id;
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
  const wh = warehouseId();
  let page = 1;
  let pages = 0;
  let fetched = 0;
  let upserted = 0;
  let ccDimsPresent = 0;

  for (;;) {
    const products = await ccClient.listProducts(wh, page, SEED_PAGE_SIZE);
    if (products.length === 0) break;
    pages += 1;
    fetched += products.length;

    for (const p of products) {
      // id is the primary key and barcode is unique+required — a CC row missing
      // either can't be stored, so skip it rather than crash the whole seed.
      if (!p.id || !p.barcode) {
        log.warn({ id: p.id, barcode: p.barcode }, "skipping CC product missing id/barcode");
        continue;
      }
      const ccDims = hasCcDims(p);
      await prisma.sku.upsert({
        where: { id: p.id },
        create: { id: p.id, barcode: p.barcode, name: p.name, ccDimsCaptured: ccDims },
        update: { barcode: p.barcode, name: p.name, ccDimsCaptured: ccDims },
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
      barcode: true,
      name: true,
      dims: { select: { id: true } },
    },
    orderBy: { name: "asc" },
  });

  const skus: SkuSummary[] = rows.map((r) => ({
    id: r.id,
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
      barcode: true,
      name: true,
      ccDimsCaptured: true,
      dims: { select: { id: true } },
    },
  });
  if (local) {
    return {
      id: local.id,
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
  let product: CcProduct | null;
  try {
    product = await ccClient.lookupByBarcode(barcode, warehouseId());
  } catch (err) {
    if (err instanceof CcRateLimitError) {
      log.warn({ barcode }, "CC rate limit hit during barcode fallback");
      throw new AppError("Product lookup unavailable — upstream rate limit", 503);
    }
    if (err instanceof CcApiError) {
      log.error({ barcode, ccStatus: err.statusCode }, "CC API error during barcode fallback");
      throw new AppError("Product lookup failed — upstream error", 502);
    }
    throw err;
  }

  if (!product || !product.id || !product.barcode) {
    throw new AppError(`SKU not found for barcode ${barcode}`, 404);
  }

  const ccDims = hasCcDims(product);
  // Upsert by id (not create) so a barcode miss whose product id already exists
  // can't blow up on the unique-id constraint.
  const saved = await prisma.sku.upsert({
    where: { id: product.id },
    create: {
      id: product.id,
      barcode: product.barcode,
      name: product.name,
      ccDimsCaptured: ccDims,
    },
    update: { barcode: product.barcode, name: product.name, ccDimsCaptured: ccDims },
    select: {
      id: true,
      barcode: true,
      name: true,
      ccDimsCaptured: true,
      dims: { select: { id: true } },
    },
  });

  log.info({ barcode, id: saved.id }, "barcode resolved via CC fallback and upserted");
  return {
    id: saved.id,
    barcode: saved.barcode,
    name: saved.name,
    hasDims: saved.dims !== null,
    ccDimsCaptured: saved.ccDimsCaptured,
    source: "cc",
  };
}

/** Capture-progress summary from live DB counts. */
export async function getProgress(): Promise<ProgressResponse> {
  const [total, captured, syncedToCC] = await Promise.all([
    prisma.sku.count(),
    prisma.dim.count(),
    prisma.dim.count({ where: { syncedToCC: true } }),
  ]);

  const pendingSync = captured - syncedToCC;
  const percentage = total === 0 ? 0 : Math.round((captured / total) * 1000) / 10;

  return { total, captured, syncedToCC, pendingSync, percentage };
}
