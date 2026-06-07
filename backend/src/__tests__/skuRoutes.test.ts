import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the service layer so the routes are exercised in isolation — this proves
// the routing, validation, and AppError→HTTP mapping (via backend-core's
// errorHandler) without a DB or CC.
vi.mock("../services/skuService", () => ({
  listSkus: vi.fn(),
  getSkuByBarcode: vi.fn(),
  seedSkus: vi.fn(),
  getProgress: vi.fn(),
}));

import request from "supertest";
import { app } from "../app";
import { AppError } from "../lib/errors";
import * as svc from "../services/skuService";

const listSkus = vi.mocked(svc.listSkus);
const getSkuByBarcode = vi.mocked(svc.getSkuByBarcode);
const seedSkus = vi.mocked(svc.seedSkus);
const getProgress = vi.mocked(svc.getProgress);

beforeEach(() => vi.clearAllMocks());

describe("GET /api/skus", () => {
  it("200s with the SKU list", async () => {
    listSkus.mockResolvedValue({
      total: 1,
      captured: 0,
      skus: [{ id: "a", barcode: "1", name: "Apple", hasDims: false }],
    });

    const res = await request(app).get("/api/skus");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.skus[0].barcode).toBe("1");
  });
});

describe("GET /api/skus/:barcode", () => {
  it("200s with the SKU detail", async () => {
    getSkuByBarcode.mockResolvedValue({
      id: "a",
      barcode: "111",
      name: "Apple",
      hasDims: true,
      ccDimsCaptured: false,
      source: "db",
    });

    const res = await request(app).get("/api/skus/111");

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("db");
    expect(getSkuByBarcode).toHaveBeenCalledWith("111");
  });

  it("404s when the service raises a 404 AppError", async () => {
    getSkuByBarcode.mockRejectedValue(new AppError("SKU not found for barcode zzz", 404));

    const res = await request(app).get("/api/skus/zzz");

    expect(res.status).toBe(404);
  });

  it("400s on a blank barcode without calling the service", async () => {
    const res = await request(app).get("/api/skus/%20"); // a single space → trims empty

    expect(res.status).toBe(400);
    expect(getSkuByBarcode).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/seed", () => {
  // The route is gated by requireSyncKey (module 12 / S6). These tests
  // exercise handler/service behaviour, so they supply the key.
  const TEST_SECRET = "test-seed-secret";
  beforeEach(() => {
    process.env.SYNC_SECRET = TEST_SECRET;
  });
  afterEach(() => {
    delete process.env.SYNC_SECRET;
  });

  it("200s with the seed report (auth gate satisfied)", async () => {
    seedSkus.mockResolvedValue({ pages: 2, fetched: 130, upserted: 130, ccDimsPresent: 100 });

    const res = await request(app)
      .post("/api/admin/seed")
      .set("X-Sync-Key", TEST_SECRET);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pages: 2, fetched: 130, upserted: 130, ccDimsPresent: 100 });
  });

  it("500s when the service throws a config AppError (auth gate satisfied)", async () => {
    seedSkus.mockRejectedValue(new AppError("CC_WAREHOUSE_ID is not configured", 500));

    const res = await request(app)
      .post("/api/admin/seed")
      .set("X-Sync-Key", TEST_SECRET);

    expect(res.status).toBe(500);
  });
});

describe("GET /api/progress", () => {
  it("200s with the progress summary at the top-level path", async () => {
    getProgress.mockResolvedValue({
      total: 460,
      captured: 47,
      syncedToCC: 43,
      pendingSync: 4,
      percentage: 10.2,
    });

    const res = await request(app).get("/api/progress");

    expect(res.status).toBe(200);
    expect(res.body.percentage).toBe(10.2);
  });
});
