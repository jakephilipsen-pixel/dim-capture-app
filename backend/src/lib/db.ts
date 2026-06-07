import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

/**
 * Interactive-transaction callback shape — the arg Prisma passes to the
 * callback is a typed Prisma client, but we only need a small subset here.
 */
type TxClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/**
 * Options forwarded to `prisma.$transaction` and the advisory lock behaviour.
 *
 * `timeout` is the maximum wall-clock ms the transaction may be open.
 * `maxWait` is how long to wait for a free connection from the pool.
 *
 * Defaults match the Prisma interactive-transaction defaults (5 s / 2 s),
 * but callers that hold the transaction open across external I/O (e.g.
 * syncService holding it across CC HTTP calls) must set a longer timeout.
 *
 * `blocking` selects which Postgres advisory lock function is used:
 *   - `false` (default) — `pg_try_advisory_xact_lock`: non-blocking.  Returns
 *     immediately.  If the lock is already held, `fn` is NOT called and `null`
 *     is returned to the caller.
 *   - `true` — `pg_advisory_xact_lock`: BLOCKING.  Waits (inside the
 *     transaction) until the lock is available, then always acquires it and
 *     runs `fn`.  Never returns `null` due to contention.  Concurrent callers
 *     serialise: the loser waits for the winner's transaction to commit
 *     (which releases the xact-scoped lock), then proceeds with its own callback.
 */
export interface AdvisoryLockOptions {
  timeout?: number;
  maxWait?: number;
  blocking?: boolean;
}

/**
 * Run `fn(tx)` inside a Postgres transaction, gated on a TRANSACTION-scoped
 * advisory lock keyed by `lockKey`.
 *
 * **Non-blocking mode** (`blocking: false`, the default — uses
 * `pg_try_advisory_xact_lock`):
 *   If this call wins the lock, `fn(tx)` runs and its result is returned.
 *   If the lock is already held by another transaction, `fn` is NOT called and
 *   `null` is returned immediately — the caller should treat `null` as "another
 *   call is already running; nothing to do".
 *
 * **Blocking mode** (`blocking: true` — uses `pg_advisory_xact_lock`):
 *   Waits for the lock unconditionally.  Always acquires it, always calls
 *   `fn(tx)`, and always returns the result.  Never returns `null` due to
 *   contention.  Use this when every caller MUST complete (e.g. dim capture —
 *   silently dropping a capture via a null-return would be data loss).
 *
 * **Why a transaction-scoped advisory lock, not session-level?**
 * Prisma pools connections.  A session `pg_advisory_lock` + `pg_advisory_unlock`
 * pair can land on DIFFERENT pooled connections — the unlock then no-ops and the
 * lock leaks forever, permanently wedging callers.  Transaction-scoped advisory
 * locks auto-release when the transaction commits or rolls back, with no manual
 * unlock and no leak risk.
 *
 * **Key uniqueness:** callers are responsible for choosing keys that don't
 * collide.  Document each key as a named constant in the calling module and list
 * it in DECISIONS.md.
 */
export async function withAdvisoryLock<T>(
  prismaClient: PrismaClient,
  lockKey: bigint,
  fn: (tx: TxClient) => Promise<T>,
  opts: AdvisoryLockOptions = {},
): Promise<T | null> {
  const blocking = opts.blocking ?? false;

  return prismaClient.$transaction(
    async (tx) => {
      if (blocking) {
        // pg_advisory_xact_lock returns void — it ALWAYS acquires the lock,
        // blocking until the current holder's transaction commits/rolls back.
        // No "did we get it?" check needed.
        await tx.$queryRaw`
          SELECT pg_advisory_xact_lock(${lockKey}::bigint)
        `;
        return fn(tx);
      } else {
        // pg_try_advisory_xact_lock returns boolean — acquire-or-bail.
        const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(${lockKey}::bigint) AS locked
        `;

        if (!locked) {
          return null;
        }

        return fn(tx);
      }
    },
    { timeout: opts.timeout ?? 5_000, maxWait: opts.maxWait ?? 2_000 },
  );
}
