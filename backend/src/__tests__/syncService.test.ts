import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the two singletons syncService depends on.
vi.mock("../lib/db", () => ({
  prisma: {
    dim: { findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
  },
}));
vi.mock("../services/ccClient", () => ({
  ccClient: { patchProductDims: vi.fn() },
}));

import { prisma } from "../lib/db";
import { ccClient } from "../services/ccClient";
import { syncUnsyncedDims } from "../services/syncService";

const dim = vi.mocked(prisma.dim, true);
const cc = vi.mocked(ccClient, true);

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
});
