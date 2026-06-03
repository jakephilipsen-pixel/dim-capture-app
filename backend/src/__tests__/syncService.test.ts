import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the two singletons syncService depends on.
//
// syncUnsyncedDims now runs inside `prisma.$transaction(cb, opts)` guarded by a
// transaction-scoped advisory lock (C1 fix). The mock `$transaction` invokes the
// callback with a `tx` stub that mirrors the global `prisma.dim.*` mocks (so the
// existing tests keep asserting against `dim.findMany/update/count`) and adds a
// `$queryRaw` that returns the advisory-lock result. By default the lock is held
// (`[{ locked: true }]`); the "already running" test overrides it to false.
vi.mock("../lib/db", () => {
  const dim = { findMany: vi.fn(), update: vi.fn(), count: vi.fn() };
  const $queryRaw = vi.fn();
  const $transaction = vi.fn(
    async (cb: (tx: unknown) => unknown) => cb({ dim, $queryRaw }),
  );
  return { prisma: { dim, $queryRaw, $transaction } };
});
vi.mock("../services/ccClient", () => ({
  ccClient: { patchProductDims: vi.fn() },
}));

import { prisma } from "../lib/db";
import { ccClient } from "../services/ccClient";
import { syncUnsyncedDims } from "../services/syncService";

const dim = vi.mocked(prisma.dim, true);
const cc = vi.mocked(ccClient, true);
// `$queryRaw` is the advisory-lock probe inside the transaction.
const queryRaw = vi.mocked(
  (prisma as unknown as { $queryRaw: ReturnType<typeof vi.fn> }).$queryRaw,
  true,
);

/** Make the advisory lock report acquired (the run proceeds). */
function lockAcquired() {
  queryRaw.mockResolvedValue([{ locked: true }] as never);
}
/** Make the advisory lock report contended (another run holds it). */
function lockContended() {
  queryRaw.mockResolvedValue([{ locked: false }] as never);
}

/** A pending (unsynced) dim row, one per index. */
function pendingDim(i: number) {
  return {
    id: i,
    skuId: `prod-${i}`,
    lengthMm: 100 + i,
    widthMm: 200 + i,
    heightMm: 300 + i,
    weightKg: 1 + i,
    syncedToCC: false,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  // `resetAllMocks` wipes the `$transaction` implementation set in the factory,
  // so re-establish it: invoke the callback with the same tx stub shape.
  (
    prisma as unknown as { $transaction: ReturnType<typeof vi.fn> }
  ).$transaction.mockImplementation(
    async (cb: (tx: unknown) => unknown) =>
      cb({ dim, $queryRaw: queryRaw }),
  );
  // Default: this run wins the lock. The "already running" test overrides it.
  lockAcquired();
});

describe("syncUnsyncedDims", () => {
  it("does nothing and reports zeroes when there is nothing to sync", async () => {
    dim.findMany.mockResolvedValue([] as never);
    dim.count.mockResolvedValue(0 as never);

    const report = await syncUnsyncedDims();

    expect(report).toEqual({ synced: 0, failed: 0, pending: 0 });
    expect(cc.patchProductDims).not.toHaveBeenCalled();
    expect(dim.update).not.toHaveBeenCalled();
  });

  it("PATCHes each dim with mm/kg verbatim and marks it synced", async () => {
    dim.findMany.mockResolvedValue([pendingDim(1)] as never);
    cc.patchProductDims.mockResolvedValue(undefined as never);
    dim.update.mockResolvedValue({} as never);
    dim.count.mockResolvedValue(0 as never);

    const report = await syncUnsyncedDims();

    expect(report).toEqual({ synced: 1, failed: 0, pending: 0 });
    // CC product id is the dim's skuId; payload is the stored mm/kg unchanged.
    expect(cc.patchProductDims).toHaveBeenCalledWith("prod-1", {
      length: 101,
      width: 201,
      height: 301,
      weight: 2,
    });
    expect(dim.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({ syncedToCC: true, syncedAt: expect.any(Date) }),
      }),
    );
  });

  it("processes every dim across multiple batches of 10", async () => {
    const dims = Array.from({ length: 23 }, (_, i) => pendingDim(i + 1));
    dim.findMany.mockResolvedValue(dims as never);
    cc.patchProductDims.mockResolvedValue(undefined as never);
    dim.update.mockResolvedValue({} as never);
    dim.count.mockResolvedValue(0 as never);

    const report = await syncUnsyncedDims();

    expect(report).toEqual({ synced: 23, failed: 0, pending: 0 });
    expect(cc.patchProductDims).toHaveBeenCalledTimes(23);
    expect(dim.update).toHaveBeenCalledTimes(23);
  });

  it("isolates a single CC failure: continues, leaves it unsynced, counts it", async () => {
    const dims = [pendingDim(1), pendingDim(2), pendingDim(3)];
    dim.findMany.mockResolvedValue(dims as never);
    // Middle dim fails; the other two succeed.
    cc.patchProductDims
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(new Error("CC 500") as never)
      .mockResolvedValueOnce(undefined as never);
    dim.update.mockResolvedValue({} as never);
    dim.count.mockResolvedValue(1 as never); // the failed dim is still pending

    const report = await syncUnsyncedDims();

    expect(report).toEqual({ synced: 2, failed: 1, pending: 1 });
    expect(cc.patchProductDims).toHaveBeenCalledTimes(3);
    // Only the two successes were marked synced — never the failed dim (id 2).
    expect(dim.update).toHaveBeenCalledTimes(2);
    const updatedIds = dim.update.mock.calls.map(
      (c) => (c[0] as { where: { id: number } }).where.id,
    );
    expect(updatedIds).toEqual([1, 3]);
  });

  it("does not throw when CC fails for every dim", async () => {
    dim.findMany.mockResolvedValue([pendingDim(1), pendingDim(2)] as never);
    cc.patchProductDims.mockRejectedValue(new Error("CC down") as never);
    dim.count.mockResolvedValue(2 as never);

    const report = await syncUnsyncedDims();

    expect(report).toEqual({ synced: 0, failed: 2, pending: 2 });
    expect(dim.update).not.toHaveBeenCalled();
  });

  it("skips the run when the advisory lock is already held (concurrent sync)", async () => {
    // C1 fix: a second overlapping POST /api/sync/cc must NOT double-PATCH.
    lockContended();
    dim.count.mockResolvedValue(4 as never); // 4 pending; the winner will sync them

    const report = await syncUnsyncedDims();

    expect(report).toEqual({ synced: 0, failed: 0, pending: 4 });
    // The guard fired before any work: no read of the unsynced set, no PATCH,
    // no marks. The in-flight winner owns the sync.
    expect(cc.patchProductDims).not.toHaveBeenCalled();
    expect(dim.findMany).not.toHaveBeenCalled();
    expect(dim.update).not.toHaveBeenCalled();
  });

  it("PATCHes each unsynced dim exactly once while holding the lock", async () => {
    // Lock acquired (beforeEach default). Verify no double-PATCH under the lock.
    const dims = [pendingDim(1), pendingDim(2), pendingDim(3)];
    dim.findMany.mockResolvedValue(dims as never);
    cc.patchProductDims.mockResolvedValue(undefined as never);
    dim.update.mockResolvedValue({} as never);
    dim.count.mockResolvedValue(0 as never);

    const report = await syncUnsyncedDims();

    expect(report).toEqual({ synced: 3, failed: 0, pending: 0 });
    expect(cc.patchProductDims).toHaveBeenCalledTimes(3);
    expect(dim.update).toHaveBeenCalledTimes(3);
    const patchedIds = cc.patchProductDims.mock.calls.map((c) => c[0]);
    expect(patchedIds).toEqual(["prod-1", "prod-2", "prod-3"]); // each once
  });

  it("keeps per-item failure isolation under the lock", async () => {
    const dims = [pendingDim(1), pendingDim(2), pendingDim(3)];
    dim.findMany.mockResolvedValue(dims as never);
    cc.patchProductDims
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(new Error("CC 500") as never)
      .mockResolvedValueOnce(undefined as never);
    dim.update.mockResolvedValue({} as never);
    dim.count.mockResolvedValue(1 as never);

    const report = await syncUnsyncedDims();

    expect(report).toEqual({ synced: 2, failed: 1, pending: 1 });
    expect(cc.patchProductDims).toHaveBeenCalledTimes(3); // loop continued
    expect(dim.update).toHaveBeenCalledTimes(2); // only the two successes marked
    const updatedIds = dim.update.mock.calls.map(
      (c) => (c[0] as { where: { id: number } }).where.id,
    );
    expect(updatedIds).toEqual([1, 3]);
  });
});
