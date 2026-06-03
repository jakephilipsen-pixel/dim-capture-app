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

/**
 * Fixed key for the Postgres advisory lock that serialises sync runs (C1 fix).
 *
 * Namespaces the "dim-capture:sync/cc" operation. The exact value is arbitrary
 * but MUST stay stable and positive (it fits Postgres' signed `bigint`): every
 * process taking THIS key contends with every other, so it serialises all
 * `POST /api/sync/cc` runs across the pool/cluster. Documented as a named const
 * so it isn't silently changed (which would break mutual exclusion).
 */
const SYNC_LOCK_KEY = 7_213_544_982_017_336_001n;

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
 *
 * Concurrency (C1 fix): the whole run executes inside a single interactive
 * transaction guarded by a Postgres TRANSACTION-scoped advisory lock
 * (`pg_try_advisory_xact_lock`). Only one run can hold `SYNC_LOCK_KEY` at a time,
 * so two overlapping `POST /api/sync/cc` calls (e.g. the Review-page "Sync Now"
 * racing the 30 s auto-sync) can no longer both read the same unsynced set and
 * double-PATCH the REAL CC / burn its 60/min token bucket. A loser returns early
 * with `{synced:0, failed:0, pending:<live count>}` — correct, because the winner
 * is syncing everything.
 *
 * Why a *transaction-scoped* lock, not a session `pg_advisory_lock` +
 * `pg_advisory_unlock` pair: Prisma pools connections, so a separate lock and
 * unlock call can land on DIFFERENT pooled connections — the unlock then fails
 * and the lock LEAKS forever, permanently wedging all future syncs.
 * `pg_try_advisory_xact_lock` is non-blocking and auto-releases when the
 * transaction commits/rolls back — no manual unlock, no leak.
 *
 * Tradeoff: this holds a DB transaction open across the per-item CC HTTP calls
 * (hence the explicit `timeout`/`maxWait` below — the 5 s interactive-tx default
 * is far too short for batched PATCHes). The per-CC-call duration is bounded once
 * module 10 `cc-resilience` adds a fetch timeout to the CC client; until then the
 * 120 s transaction cap is the backstop. All DB ops MUST use the transaction
 * client `tx` so they share the locked connection; `ccClient` stays external HTTP.
 */
export async function syncUnsyncedDims(): Promise<SyncReport> {
  return prisma.$transaction(
    async (tx) => {
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${SYNC_LOCK_KEY}::bigint) AS locked
      `;

      if (!locked) {
        // Another sync run already holds the lock. Don't double-PATCH — report
        // the live pending count and let the in-flight winner do the work.
        const pending = await tx.dim.count({ where: { syncedToCC: false } });
        log.info(
          { pending },
          "CC dim sync already running — skipping this run (advisory lock held)",
        );
        return { synced: 0, failed: 0, pending };
      }

      const unsynced = await tx.dim.findMany({
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
            await tx.dim.update({
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
      const pending = await tx.dim.count({ where: { syncedToCC: false } });

      log.info({ synced, failed, pending }, "CC dim sync complete");
      return { synced, failed, pending };
    },
    // The interactive-tx default timeout (5 s) is too short for batched CC HTTP
    // calls held inside the transaction; widen it. `maxWait` caps how long we
    // wait for a pooled connection before starting.
    { timeout: 120_000, maxWait: 10_000 },
  );
}
