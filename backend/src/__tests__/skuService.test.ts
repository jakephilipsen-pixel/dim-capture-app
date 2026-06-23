import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the two singletons skuService depends on. Factories are hoisted by
// vitest, so the service (imported below) binds to these mocks.
//
// M1 fix: `getProgress` now calls `prisma.$transaction([...])` (batch form).
// We add `$transaction` to the prisma mock — it executes all promises in the
// received array via `Promise.all`, so the existing `sku.count` / `dim.count`
// mocked return values feed through unchanged.
vi.mock("../lib/db", () => ({
  prisma: {
    sku: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
    dim: { count: vi.fn() },
    $transaction: vi.fn(async (arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
      // Should never be called in interactive form from skuService.
      throw new Error("unexpected interactive $transaction in skuService");
    }),
  },
}));

vi.mock("../services/ccClient", () => {
  class CcApiError extends Error {
    constructor(message: string, public readonly statusCode: number) {
      super(message);
      this.name = "CcApiError";
      Object.setPrototypeOf(this, CcApiError.prototype);
    }
  }
  class CcTimeoutError extends CcApiError {
    constructor(message = "timeout") {
      super(message, 504);
      this.name = "CcTimeoutError";
      Object.setPrototypeOf(this, CcTimeoutError.prototype);
    }
  }
  class CcRateLimitError extends Error {
    constructor(message = "rate limit") {
      super(message);
      this.name = "CcRateLimitError";
      Object.setPrototypeOf(this, CcRateLimitError.prototype);
    }
  }
  return {
    ccClient: { listProducts: vi.fn(), lookupByBarcode: vi.fn() },
    CcApiError,
    CcTimeoutError,
    CcRateLimitError,
  };
});

import { AppError } from "../lib/errors";
import { prisma } from "../lib/db";
import { ccClient, CcApiError, CcRateLimitError, CcTimeoutError } from "../services/ccClient";
import {
  getProgress,
  getSkuByBarcode,
  listSkus,
  seedSkus,
} from "../services/skuService";

const sku = vi.mocked(prisma.sku, true);
const dim = vi.mocked(prisma.dim, true);
const cc = vi.mocked(ccClient, true);

/** A CC product (warehouse-product summary), dims present or absent. */
function ccProduct(i: number, withDims: boolean) {
  return {
    id: `prod-${i}`,
    code: `code-${i}`,
    barcode: `bc-${i}`,
    name: `Product ${i}`,
    length: withDims ? 0.1 : null,
    width: withDims ? 0.05 : null,
    height: withDims ? 0.025 : null,
    weight: withDims ? 1.2 : null,
  };
}

/** A page of `n` CC products with ids offset by `base`. */
function ccPage(n: number, withDims: boolean, base = 0) {
  return Array.from({ length: n }, (_, i) => ccProduct(base + i, withDims));
}

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) so queued mockResolvedValueOnce pages
  // don't leak between tests — clearAllMocks leaves the "once" queue intact.
  vi.resetAllMocks();
  // Default: upsert resolves to an empty object (seed ignores the result).
  sku.upsert.mockResolvedValue({} as never);
  // Re-establish the $transaction implementation wiped by resetAllMocks.
  // M1: getProgress uses the array form — execute all promises via Promise.all.
  (
    prisma as unknown as { $transaction: ReturnType<typeof vi.fn> }
  ).$transaction.mockImplementation(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    throw new Error("unexpected interactive $transaction in skuService");
  });
});

describe("seedSkus", () => {
  it("paginates until a short page and upserts every product", async () => {
    // 100 (full page) then 30 (short page → stop). Distinct ids across pages.
    cc.listProducts
      .mockResolvedValueOnce(ccPage(100, true))
      .mockResolvedValueOnce(ccPage(30, false, 100));

    const report = await seedSkus();

    expect(cc.listProducts).toHaveBeenNthCalledWith(1, 1, 100);
    expect(cc.listProducts).toHaveBeenNthCalledWith(2, 2, 100);
    expect(cc.listProducts).toHaveBeenCalledTimes(2);
    expect(sku.upsert).toHaveBeenCalledTimes(130);
    expect(report).toEqual({
      pages: 2,
      fetched: 130,
      upserted: 130,
      ccDimsPresent: 100, // only the first page had dims in CC
    });
  });

  it("is idempotent — upserts by id (never a bare insert)", async () => {
    cc.listProducts.mockResolvedValueOnce(ccPage(2, true)).mockResolvedValueOnce([]);

    await seedSkus();

    expect(sku.upsert).toHaveBeenCalledTimes(2);
    const firstCall = sku.upsert.mock.calls[0][0];
    expect(firstCall).toMatchObject({
      where: { id: "prod-0" },
      create: { id: "prod-0", barcode: "bc-0", name: "Product 0", ccDimsCaptured: true },
      update: { barcode: "bc-0", name: "Product 0", ccDimsCaptured: true },
    });
  });

  it("marks ccDimsCaptured=false when CC has no dims", async () => {
    cc.listProducts.mockResolvedValueOnce(ccPage(1, false)).mockResolvedValueOnce([]);

    const report = await seedSkus();

    expect(report.ccDimsPresent).toBe(0);
    expect(sku.upsert.mock.calls[0][0]).toMatchObject({
      create: { ccDimsCaptured: false },
      update: { ccDimsCaptured: false },
    });
  });

  it("skips rows missing id, but stores barcode-less rows (barcode is nullable)", async () => {
    cc.listProducts
      .mockResolvedValueOnce([
        ccProduct(1, true),
        { id: "", code: "x", barcode: "bc-x", name: "no id", length: null, width: null, height: null, weight: null },
        { id: "prod-2", code: "y", barcode: null, name: "no barcode", length: null, width: null, height: null, weight: null },
      ])
      .mockResolvedValueOnce([]);

    const report = await seedSkus();

    expect(report.fetched).toBe(3); // all three came back from CC
    expect(report.upserted).toBe(2); // the valid one + the barcode-less one; only the no-id row skipped
    expect(sku.upsert).toHaveBeenCalledTimes(2);
  });

  it("returns an all-zero report when CC has no products", async () => {
    cc.listProducts.mockResolvedValueOnce([]);

    const report = await seedSkus();

    expect(report).toEqual({ pages: 0, fetched: 0, upserted: 0, ccDimsPresent: 0 });
    expect(sku.upsert).not.toHaveBeenCalled();
  });

  it("stops after one page when it is already short", async () => {
    cc.listProducts.mockResolvedValueOnce(ccPage(5, true));

    const report = await seedSkus();

    expect(cc.listProducts).toHaveBeenCalledTimes(1); // no second page requested
    expect(report.pages).toBe(1);
    expect(report.fetched).toBe(5);
  });

  // M2a — bucket exhausted during seed must surface as 429, not 500.
  it("maps a CcRateLimitError from listProducts to a 429 AppError — M2a", async () => {
    cc.listProducts.mockRejectedValue(new CcRateLimitError());

    const err = await seedSkus().catch((e) => e as AppError);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(429);
    // Should not leak internal rate-limit detail.
    expect(err.message).not.toContain("60 req/min");
  });

  it("maps a CcTimeoutError from listProducts to a 504 AppError — M2a / S4", async () => {
    cc.listProducts.mockRejectedValue(new CcTimeoutError());

    const err = await seedSkus().catch((e) => e as AppError);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(504);
  });

  it("maps a CcApiError from listProducts to a 502 AppError — M2a", async () => {
    cc.listProducts.mockRejectedValue(new CcApiError("upstream 503", 503));

    const err = await seedSkus().catch((e) => e as AppError);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(502);
    expect(err.message).not.toContain("upstream 503");
  });
});

describe("listSkus", () => {
  it("returns total, captured and per-SKU hasDims", async () => {
    sku.findMany.mockResolvedValue([
      { id: "a", barcode: "1", name: "Apple", dims: { id: 1 } },
      { id: "b", barcode: "2", name: "Banana", dims: null },
      { id: "c", barcode: "3", name: "Cherry", dims: { id: 2 } },
    ] as never);

    const result = await listSkus();

    expect(result.total).toBe(3);
    expect(result.captured).toBe(2);
    expect(result.skus).toEqual([
      { id: "a", barcode: "1", name: "Apple", hasDims: true },
      { id: "b", barcode: "2", name: "Banana", hasDims: false },
      { id: "c", barcode: "3", name: "Cherry", hasDims: true },
    ]);
  });

  it("handles an empty table", async () => {
    sku.findMany.mockResolvedValue([] as never);
    const result = await listSkus();
    expect(result).toEqual({ total: 0, captured: 0, skus: [] });
  });
});

describe("getSkuByBarcode", () => {
  it("returns the SKU from the local DB without touching CC", async () => {
    sku.findUnique.mockResolvedValue({
      id: "a",
      barcode: "111",
      name: "Apple",
      ccDimsCaptured: true,
      dims: { id: 9 },
    } as never);

    const result = await getSkuByBarcode("111");

    expect(result).toEqual({
      id: "a",
      barcode: "111",
      name: "Apple",
      hasDims: true,
      ccDimsCaptured: true,
      source: "db",
    });
    expect(cc.lookupByBarcode).not.toHaveBeenCalled();
  });

  it("falls back to CC and upserts locally on a DB miss", async () => {
    sku.findUnique.mockResolvedValue(null as never);
    cc.lookupByBarcode.mockResolvedValue({
      id: "z",
      code: "ZUC",
      barcode: "999",
      name: "Zucchini",
      length: 0.2,
      width: 0.06,
      height: 0.06,
      weight: 0.3,
    });
    sku.upsert.mockResolvedValue({
      id: "z",
      code: "ZUC",
      barcode: "999",
      name: "Zucchini",
      ccDimsCaptured: true,
      dims: null,
    } as never);

    const result = await getSkuByBarcode("999");

    expect(cc.lookupByBarcode).toHaveBeenCalledWith("999");
    expect(sku.upsert).toHaveBeenCalledTimes(1);
    // The scanned barcode is stored (so the next scan is a DB hit).
    expect(sku.upsert.mock.calls[0][0]).toMatchObject({ update: { barcode: "999" } });
    expect(result).toEqual({
      id: "z",
      code: "ZUC",
      barcode: "999",
      name: "Zucchini",
      hasDims: false,
      ccDimsCaptured: true,
      source: "cc",
    });
  });

  it("throws 404 when neither DB nor CC knows the barcode", async () => {
    sku.findUnique.mockResolvedValue(null as never);
    cc.lookupByBarcode.mockResolvedValue(null);

    await expect(getSkuByBarcode("nope")).rejects.toMatchObject({
      constructor: AppError,
      statusCode: 404,
    });
    expect(sku.upsert).not.toHaveBeenCalled();
  });

  it("throws 404 when CC returns a product with no id", async () => {
    sku.findUnique.mockResolvedValue(null as never);
    cc.lookupByBarcode.mockResolvedValue({
      id: "",
      barcode: "999",
      name: "broken",
      length: null,
      width: null,
      height: null,
      weight: null,
    });

    await expect(getSkuByBarcode("999")).rejects.toMatchObject({ statusCode: 404 });
  });

  // S3a — CcApiError/CcRateLimitError on the CC fallback path must map to
  // safe AppErrors (no CC message echoed; not a 500).
  it("maps a CcApiError on CC fallback to a 502 AppError — S3a", async () => {
    sku.findUnique.mockResolvedValue(null as never);
    cc.lookupByBarcode.mockRejectedValue(
      new CcApiError("CC returned 503 <!DOCTYPE html>...", 503),
    );

    const err = await getSkuByBarcode("xxx").catch((e) => e as AppError);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(502);
    // CC message must not be forwarded to the caller.
    expect(err.message).not.toContain("<!DOCTYPE");
    expect(err.message).not.toContain("CC returned");
  });

  it("maps a CcRateLimitError on CC fallback to a 503 AppError — S3a", async () => {
    sku.findUnique.mockResolvedValue(null as never);
    cc.lookupByBarcode.mockRejectedValue(
      new CcRateLimitError("CartonCloud rate limit exceeded (60 req/min)"),
    );

    const err = await getSkuByBarcode("xxx").catch((e) => e as AppError);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(503);
    expect(err.message).not.toContain("CartonCloud rate limit exceeded");
  });

  it("maps a CcTimeoutError on CC fallback to a 504 AppError — S4 / module 10", async () => {
    sku.findUnique.mockResolvedValue(null as never);
    cc.lookupByBarcode.mockRejectedValue(new CcTimeoutError());

    const err = await getSkuByBarcode("xxx").catch((e) => e as AppError);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(504);
    expect(err.message).not.toContain("timed out"); // no internal detail
  });
});

describe("getProgress", () => {
  it("computes counts and a one-decimal percentage", async () => {
    sku.count.mockResolvedValue(460 as never);
    dim.count
      .mockResolvedValueOnce(47 as never) // captured (all dims)
      .mockResolvedValueOnce(43 as never); // syncedToCC

    const result = await getProgress();

    expect(result).toEqual({
      total: 460,
      captured: 47,
      syncedToCC: 43,
      pendingSync: 4,
      percentage: 10.2,
    });
  });

  it("returns percentage 0 (no divide-by-zero) when there are no SKUs", async () => {
    sku.count.mockResolvedValue(0 as never);
    dim.count.mockResolvedValueOnce(0 as never).mockResolvedValueOnce(0 as never);

    const result = await getProgress();

    expect(result).toEqual({
      total: 0,
      captured: 0,
      syncedToCC: 0,
      pendingSync: 0,
      percentage: 0,
    });
  });
});
