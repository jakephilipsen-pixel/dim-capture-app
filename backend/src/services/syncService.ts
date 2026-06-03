/**
 * Sync service — pushes locally-captured dims to CartonCloud (module 04).
 *
 * Triggered synchronously by `POST /api/sync/cc` (the frontend's manual or
 * auto-sync call); there is no background worker at this stage. It queries
 * every unsynced dim, processes them in fixed batches of 10, PATCHes each
 * product in CC, and marks successes. A single CC failure must NEVER crash the
 * run — it's caught per-item, logged, left `syncedToCC = false`, and retried on
 * the next call.
 *
 * CC product id == `Dim.skuId`: `Sku.id` is the CartonCloud product UUID
 * (backend-core schema), so no barcode lookup is needed before PATCHing.
 *
 * Units: stored mm / kg are passed to CC verbatim — cc-client does no
 * conversion, and CC expects mm for L/W/H and kg for weight.
 */
import { prisma } from "../lib/db";
import { logger } from "../middleware/logger";
import { ccClient } from "./ccClient";

const log = logger.child({ module: "syncService" });

/** Dims are pushed to CC in fixed chunks of this size (brief: batches of 10). */
const BATCH_SIZE = 10;

/** Outcome of one `POST /api/sync/cc` run. */
export interface SyncReport {
  /** Dims successfully PATCHed to CC this run. */
  synced: number;
  /** Dims that errored this run (left unsynced, retried next call). */
  failed: number;
  /** Dims still `syncedToCC = false` after the run (live DB count). */
  pending: number;
}

/** Split `items` into consecutive chunks of `size`. */
function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/**
 * Push all unsynced dims to CartonCloud in batches of 10 and report the result.
 * Per-item errors are isolated: one failing PATCH does not stop its batch or any
 * later batch.
 */
export async function syncUnsyncedDims(): Promise<SyncReport> {
  const unsynced = await prisma.dim.findMany({
    where: { syncedToCC: false },
    orderBy: { measuredAt: "asc" },
  });

  const batches = chunk(unsynced, BATCH_SIZE);
  log.info(
    { unsynced: unsynced.length, batches: batches.length },
    "starting CC dim sync",
  );

  let synced = 0;
  let failed = 0;

  for (const batch of batches) {
    for (const dim of batch) {
      try {
        await ccClient.patchProductDims(dim.skuId, {
          length: dim.lengthMm,
          width: dim.widthMm,
          height: dim.heightMm,
          weight: dim.weightKg,
        });
        await prisma.dim.update({
          where: { id: dim.id },
          data: { syncedToCC: true, syncedAt: new Date() },
        });
        synced += 1;
      } catch (err) {
        // Isolate the failure: log it, leave the dim unsynced, keep going.
        failed += 1;
        log.error(
          { err, dimId: dim.id, skuId: dim.skuId },
          "CC dim sync failed for one product — leaving unsynced for retry",
        );
      }
    }
  }

  // `pending` is the live truth after the run, not an inferred count — covers
  // any rows that became unsynced concurrently as well as this run's failures.
  const pending = await prisma.dim.count({ where: { syncedToCC: false } });

  log.info({ synced, failed, pending }, "CC dim sync complete");
  return { synced, failed, pending };
}
