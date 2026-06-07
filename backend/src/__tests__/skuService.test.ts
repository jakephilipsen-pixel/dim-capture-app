import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the two singletons skuService depends on. Factories are hoisted by
// vitest, so the service (imported below) binds to these mocks.
vi.mock("../lib/db", () => ({
  prisma: {
    sku: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
    dim: { count: vi.fn() },
  },
}));

vi.mock("../services/ccClient", () => ({
  ccClient: { listProducts: vi.fn(), lookupByBarcode: vi.fn() },
  CcApiError: class CcApiError extends Error {
    constructor(message: string, public readonly statusCode: number) {
      super(message);
      this.name = "CcApiError";
    }
  },
  CcRateLimitError: class CcRateLimitError extends Error {
    constructor(message = "rate limit") {
      super(message);
      this.name = "CcRateLimitError";
    }
  },
}));

import { AppError } from "../lib/errors";
import { prisma } from "../lib/db";
import { ccClient, CcApiError, CcRateLimitError } from "../services/ccClient";
import {
  getProgress,
  getSkuByBarcode,
  listSkus,
  seedSkus,
} from "../services/skuService";

const sku = vi.mocked(prisma.sku, true);
const dim = vi.mocked(prisma.dim, true);
const cc = vi.mocked(ccClient, true);

const WAREHOUSE = "wh-forage";

/** A CC product, dims present or absent. */
function ccProduct(i: number, withDims: boolean) {
  return {
    id: `prod-${i}`,
    barcode: `bc-${i}`,
    name: `Product ${i}`,
    length: withDims ? 100 : null,
    width: withDims ? 50 : null,
    height: withDims ? 25 : null,
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
  process.env.CC_WAREHOUSE_ID = WAREHOUSE;
  // Default: upsert resolves to an empty object (seed ignores the result).
  sku.upsert.mockResolvedValue({} as never);
});

afterEach(() => {
  delete process.env.CC_WAREHOUSE_ID;
});

describe("seedSkus", () => {
  it("paginates until a short page and upserts every product", async () => {
    // 100 (full page) then 30 (short page → stop). Distinct ids across pages.
    cc.listProducts
      .mockResolvedValueOnce(ccPage(100, true))
      .mockResolvedValueOnce(ccPage(30, false, 100));

    const report = await seedSkus();

    expect(cc.listProducts).toHaveBeenNthCalledWith(1, WAREHOUSE, 1, 100);
    expect(cc.listProducts).toHaveBeenNthCalledWith(2, WAREHOUSE, 2, 100);
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

  it("skips malformed CC rows missing id or barcode", async () => {
    cc.listProducts
      .mockResolvedValueOnce([
        ccProduct(1, true),
        { id: "", barcode: "bc-x", name: "no id", length: 1, width: 1, height: 1, weight: 1 },
        { id: "prod-2", barcode: "", name: "no barcode", length: 1, width: 1, height: 1, weight: 1 },
      ])
      .mockResolvedValueOnce([]);

    const report = await seedSkus();

    expect(report.fetched).toBe(3); // all three came back from CC
    expect(report.upserted).toBe(1); // only the valid one written
    expect(sku.upsert).toHaveBeenCalledTimes(1);
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

  it("throws a 500 AppError when CC_WAREHOUSE_ID is unset", async () => {
    delete process.env.CC_WAREHOUSE_ID;

    await expect(seedSkus()).rejects.toMatchObject({
      constructor: AppError,
      statusCode: 500,
    });
    expect(cc.listProducts).not.toHaveBeenCalled();
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
      barcode: "999",
      name: "Zucchini",
      length: 200,
      width: 60,
      height: 60,
      weight: 0.3,
    });
    sku.upsert.mockResolvedValue({
      id: "z",
      barcode: "999",
      name: "Zucchini",
      ccDimsCaptured: true,
      dims: null,
    } as never);

    const result = await getSkuByBarcode("999");

    expect(cc.lookupByBarcode).toHaveBeenCalledWith("999", WAREHOUSE);
    expect(sku.upsert).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      id: "z",
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
