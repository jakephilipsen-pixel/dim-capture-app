/**
 * Module 13 — write-concurrency tests.
 *
 * Two fixes verified here:
 *
 * S8 — saveDim advisory lock.  Concurrent first-captures of the same SKU are
 *   serialised by a Postgres advisory lock keyed by the numeric hash of `skuId`.
 *   The implementation wraps the read-SKU + upsert-dim path in a
 *   `withAdvisoryLock` call, which issues `pg_try_advisory_xact_lock` as the
 *   first statement of an interactive transaction.  We assert:
 *     - the normal path acquires the lock and upserts the dim.
 *     - a lock-contended call (loser) returns `null` immediately without
 *       touching `sku.findUnique` or `dim.upsert`.
 *
 * M1 — getProgress consistent read.  The three `count()` queries are wrapped in
 *   a single `prisma.$transaction([...])` so they share one snapshot and cannot
 *   produce a torn read.  We assert that `$transaction` is called with an array
 *   of exactly three promises and that the result is computed from those values.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Prisma mock — mirrors the syncService.test.ts factory style.
// We need:
//   prisma.sku.findUnique           — SKU existence check in saveDim
//   prisma.dim.upsert               — the capture write in saveDim
//   prisma.sku.count / dim.count    — the three counts in getProgress
//   prisma.$transaction             — used by both saveDim (interactive) and
//                                     getProgress (batch array form)
//   tx.$queryRaw                    — advisory-lock probe inside the tx
// ---------------------------------------------------------------------------
vi.mock("../lib/db", () => {
  const sku = { findUnique: vi.fn(), count: vi.fn() };
  const dim = { upsert: vi.fn(), count: vi.fn() };
  const $queryRaw = vi.fn();

  // `withAdvisoryLock` mock — default: lock acquired (run the callback).
  // `lockContended()` overrides this per-test via mockResolvedValue(null).
  const withAdvisoryLock = vi.fn(
    async (_p: unknown, _k: unknown, cb: (tx: unknown) => unknown) =>
      cb({ sku, dim, $queryRaw }),
  );

  // $transaction for M1 (array form) and fallback.
  const $transaction = vi.fn(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    return (arg as (tx: unknown) => unknown)({ sku, dim, $queryRaw });
  });

  return { prisma: { sku, dim, $queryRaw, $transaction }, withAdvisoryLock };
});

import { prisma, withAdvisoryLock } from "../lib/db";
import { saveDim } from "../services/dimService";
import { getProgress } from "../services/skuService";

// ---------------------------------------------------------------------------
// Typed handles on the mocked surface.
// ---------------------------------------------------------------------------
const sku = vi.mocked(prisma.sku, true);
const dim = vi.mocked(prisma.dim, true);
const $transaction = vi.mocked(
  (prisma as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction,
  true,
);
const queryRaw = vi.mocked(
  (prisma as unknown as { $queryRaw: ReturnType<typeof vi.fn> }).$queryRaw,
  true,
);
const advisoryLock = vi.mocked(withAdvisoryLock, true);

/** Make the advisory lock report acquired (run callback). */
function lockAcquired(): void {
  advisoryLock.mockImplementation(
    async (_p: unknown, _k: unknown, cb: (tx: unknown) => unknown) =>
      cb({ sku, dim, $queryRaw: queryRaw }),
  );
}

/** Make the advisory lock report contended (another capture is in flight). */
function lockContended(): void {
  advisoryLock.mockResolvedValue(null as never);
}

const validCapture = {
  skuId: "prod-42",
  lengthMm: 300,
  widthMm: 200,
  heightMm: 150,
  weightKg: 2.4,
  measuredBy: "Jake",
};

beforeEach(() => {
  vi.resetAllMocks();
  // Re-establish implementations wiped by resetAllMocks.

  // $transaction (used by getProgress in array form, and as fallback).
  $transaction.mockImplementation(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    return (arg as (tx: unknown) => unknown)({ sku, dim, $queryRaw: queryRaw });
  });

  // withAdvisoryLock: re-establish the lock-acquired default.
  // Individual tests that want contention call `lockContended()` after beforeEach.
  lockAcquired();
});

// ===========================================================================
// S8 — saveDim routes through withAdvisoryLock for per-SKU serialisation
// ===========================================================================

describe("saveDim — S8 advisory lock (concurrent first-capture serialisation)", () => {
  it("calls withAdvisoryLock and upserts the dim when the lock is acquired", async () => {
    sku.findUnique.mockResolvedValue({ id: "prod-42" } as never);
    dim.upsert.mockResolvedValue({ id: 1, ...validCapture, notes: null } as never);

    await saveDim(validCapture);

    // saveDim must have gone through withAdvisoryLock.
    expect(advisoryLock).toHaveBeenCalledTimes(1);
    // The SKU check and upsert must have run inside the locked callback.
    expect(sku.findUnique).toHaveBeenCalledWith({ where: { id: "prod-42" } });
    expect(dim.upsert).toHaveBeenCalledTimes(1);
  });

  it("returns null immediately when the advisory lock is contended — no upsert, no SKU lookup", async () => {
    // Simulate a concurrent capture of the same SKU already holding the lock.
    lockContended();

    const result = await saveDim(validCapture);

    // The loser must bail out: no DB reads or writes.
    expect(result).toBeNull();
    expect(advisoryLock).toHaveBeenCalledTimes(1); // lock was attempted
    expect(sku.findUnique).not.toHaveBeenCalled();
    expect(dim.upsert).not.toHaveBeenCalled();
  });

  it("validates the body before entering the lock (invalid input never reaches withAdvisoryLock)", async () => {
    // Validation happens before withAdvisoryLock — a bad body bails at zod.
    await expect(saveDim({ ...validCapture, heightMm: 0 })).rejects.toMatchObject({
      statusCode: 422,
    });
    // withAdvisoryLock must not have been called for an invalid body.
    expect(advisoryLock).not.toHaveBeenCalled();
    expect(dim.upsert).not.toHaveBeenCalled();
  });

  it("upsert payload is correct when the lock is held", async () => {
    sku.findUnique.mockResolvedValue({ id: "prod-42" } as never);
    dim.upsert.mockResolvedValue({ id: 1 } as never);

    await saveDim({ ...validCapture, notes: "test pass" });

    expect(dim.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { skuId: "prod-42" },
        create: expect.objectContaining({
          skuId: "prod-42",
          lengthMm: 300,
          notes: "test pass",
        }),
        update: expect.objectContaining({
          syncedToCC: false,
          syncedAt: null,
          measuredAt: expect.any(Date),
        }),
      }),
    );
  });

  it("throws 404 inside the lock when the SKU does not exist", async () => {
    sku.findUnique.mockResolvedValue(null as never);

    await expect(saveDim(validCapture)).rejects.toMatchObject({ statusCode: 404 });
    // Lock was attempted and acquired; upsert never ran.
    expect(advisoryLock).toHaveBeenCalledTimes(1);
    expect(dim.upsert).not.toHaveBeenCalled();
  });

  it("lock is keyed by skuId — advisory lock is called with the prisma client and a bigint key", async () => {
    sku.findUnique.mockResolvedValue({ id: "prod-42" } as never);
    dim.upsert.mockResolvedValue({ id: 1 } as never);

    await saveDim(validCapture);

    // First arg: prisma; second arg: bigint key derived from skuId.
    const [, keyArg] = advisoryLock.mock.calls[0]!;
    expect(typeof keyArg).toBe("bigint");
    // Capture the same SKU again — same lock key.
    advisoryLock.mockClear();
    sku.findUnique.mockResolvedValue({ id: "prod-42" } as never);
    dim.upsert.mockResolvedValue({ id: 1 } as never);
    await saveDim(validCapture);
    const [, keyArg2] = advisoryLock.mock.calls[0]!;
    expect(keyArg2).toBe(keyArg);
  });
});

// ===========================================================================
// M1 — getProgress wraps its three counts in a single $transaction
// ===========================================================================

describe("getProgress — M1 consistent-read transaction", () => {
  it("issues all three count queries inside a single $transaction call", async () => {
    // We need to intercept the array-form $transaction call and resolve the
    // individual count promises.  Override $transaction to capture the array
    // and run it through Promise.all, then spy on what was passed.
    let capturedArray: unknown;
    $transaction.mockImplementation(async (arg: unknown) => {
      if (Array.isArray(arg)) {
        capturedArray = arg;
        return Promise.all(arg as Promise<unknown>[]);
      }
      // Should not hit interactive form for getProgress.
      return (arg as (tx: unknown) => unknown)({ sku, dim, $queryRaw: queryRaw });
    });

    // The three counts must resolve to consistent values.
    sku.count.mockResolvedValue(460 as never);
    dim.count
      .mockResolvedValueOnce(47 as never)  // captured (all dims)
      .mockResolvedValueOnce(43 as never); // syncedToCC=true

    const result = await getProgress();

    // $transaction must have been called exactly once.
    expect($transaction).toHaveBeenCalledTimes(1);
    // The captured argument must be an array of three promises.
    expect(Array.isArray(capturedArray)).toBe(true);
    expect((capturedArray as unknown[]).length).toBe(3);
    // Results are computed from those values.
    expect(result).toEqual({
      total: 460,
      captured: 47,
      syncedToCC: 43,
      pendingSync: 4,
      percentage: 10.2,
    });
  });

  it("still produces zero percentage when there are no SKUs (no divide-by-zero)", async () => {
    $transaction.mockImplementation(async (arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
      return (arg as (tx: unknown) => unknown)({ sku, dim, $queryRaw: queryRaw });
    });

    sku.count.mockResolvedValue(0 as never);
    dim.count.mockResolvedValue(0 as never);

    const result = await getProgress();

    expect(result).toEqual({
      total: 0,
      captured: 0,
      syncedToCC: 0,
      pendingSync: 0,
      percentage: 0,
    });
    expect($transaction).toHaveBeenCalledTimes(1);
  });
});
