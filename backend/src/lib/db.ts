import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

/**
 * Interactive-transaction callback shape — the arg Prisma passes to the
 * callback is a typed Prisma client, but we only need a small subset here.
 */
type TxClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/**
 * Options forwarded to `prisma.$transaction`.
 *
 * `timeout` is the maximum wall-clock ms the transaction may be open.
 * `maxWait` is how long to wait for a free connection from the pool.
 *
 * Defaults match the Prisma interactive-transaction defaults (5 s / 2 s),
 * but callers that hold the transaction open across external I/O (e.g.
 * syncService holding it across CC HTTP calls) must set a longer timeout.
 */
export interface AdvisoryLockOptions {
  timeout?: number;
  maxWait?: number;
}

/**
 * Run `fn(tx)` inside a Postgres transaction, gated on a TRANSACTION-scoped
 * advisory lock keyed by `lockKey` (`pg_try_advisory_xact_lock`).
 *
 * If this call wins the lock, `fn(tx)` runs and its result is returned.
 * If the lock is already held by another transaction, `fn` is NOT called and
 * `null` is returned immediately — the caller should treat `null` as "another
 * call is already running; nothing to do".
 *
 * **Why a transaction-scoped advisory lock, not session-level?**
 * Prisma pools connections.  A session `pg_advisory_lock` + `pg_advisory_unlock`
 * pair can land on DIFFERENT pooled connections — the unlock then no-ops and the
 * lock leaks forever, permanently wedging callers.  `pg_try_advisory_xact_lock`
 * is non-blocking and auto-releases when the transaction commits or rolls back,
 * with no manual unlock and no leak risk.
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
  return prismaClient.$transaction(
    async (tx) => {
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${lockKey}::bigint) AS locked
      `;

      if (!locked) {
        return null;
      }

      return fn(tx);
    },
    { timeout: opts.timeout ?? 5_000, maxWait: opts.maxWait ?? 2_000 },
  );
}
