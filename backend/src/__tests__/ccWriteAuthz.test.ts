/**
 * cc-write-authz — module 12 (S6)
 *
 * Gate tests: X-Sync-Key header required on POST /api/sync/cc and
 * POST /api/admin/seed. Read routes and POST /api/dims must NOT be gated.
 *
 * The middleware reads SYNC_SECRET at request time, so we set/unset the env
 * var directly inside tests and restore it with afterEach. This is safe
 * because vitest runs each test file in its own worker.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock all service dependencies so these tests exercise only the auth gate,
// routing, and the real app + errorHandler — no DB or CC involved.
vi.mock("../services/syncService", () => ({
  syncUnsyncedDims: vi.fn(),
}));
vi.mock("../services/skuService", () => ({
  listSkus: vi.fn(),
  getSkuByBarcode: vi.fn(),
  seedSkus: vi.fn(),
  getProgress: vi.fn(),
}));
vi.mock("../services/dimService", () => ({
  saveDim: vi.fn(),
  listDims: vi.fn(),
  updateDim: vi.fn(),
}));
vi.mock("../lib/db", () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
    $transaction: vi.fn(),
  },
  withAdvisoryLock: vi.fn(),
}));

import request from "supertest";
import { app } from "../app";
import * as skuSvc from "../services/skuService";
import * as syncSvc from "../services/syncService";
import * as dimSvc from "../services/dimService";

const mockSyncUnsyncedDims = vi.mocked(syncSvc.syncUnsyncedDims);
const mockSeedSkus = vi.mocked(skuSvc.seedSkus);
const mockListSkus = vi.mocked(skuSvc.listSkus);
const mockGetProgress = vi.mocked(skuSvc.getProgress);
const mockSaveDim = vi.mocked(dimSvc.saveDim);

const VALID_SECRET = "test-secret-abc123";
const CANNED_SYNC = { synced: 3, failed: 0, pending: 0 };
const CANNED_SEED = { pages: 1, fetched: 10, upserted: 10, ccDimsPresent: 5 };

/** Save and restore SYNC_SECRET around each test. */
const originalSyncSecret = process.env.SYNC_SECRET;
beforeEach(() => {
  vi.resetAllMocks();
  // Default: secret is configured.
  process.env.SYNC_SECRET = VALID_SECRET;
  // Default service stubs so passing-the-gate tests see a 200.
  mockSyncUnsyncedDims.mockResolvedValue(CANNED_SYNC);
  mockSeedSkus.mockResolvedValue(CANNED_SEED);
  mockListSkus.mockResolvedValue({ total: 0, captured: 0, skus: [] });
  mockGetProgress.mockResolvedValue({
    total: 460,
    captured: 10,
    syncedToCC: 8,
    pendingSync: 2,
    percentage: 2.2,
  });
  mockSaveDim.mockResolvedValue({ id: 1, skuId: "prod-1" } as never);
});
afterEach(() => {
  if (originalSyncSecret === undefined) {
    delete process.env.SYNC_SECRET;
  } else {
    process.env.SYNC_SECRET = originalSyncSecret;
  }
});

// ---------------------------------------------------------------------------
// POST /api/sync/cc
// ---------------------------------------------------------------------------

describe("POST /api/sync/cc — auth gate", () => {
  it("401 when no X-Sync-Key header is sent (SYNC_SECRET configured)", async () => {
    const res = await request(app).post("/api/sync/cc");

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
    // Handler must NOT have been called.
    expect(mockSyncUnsyncedDims).not.toHaveBeenCalled();
  });

  it("401 when X-Sync-Key is wrong (SYNC_SECRET configured)", async () => {
    const res = await request(app)
      .post("/api/sync/cc")
      .set("X-Sync-Key", "wrong-key");

    expect(res.status).toBe(401);
    expect(mockSyncUnsyncedDims).not.toHaveBeenCalled();
  });

  it("401 when X-Sync-Key is empty string (SYNC_SECRET configured)", async () => {
    const res = await request(app)
      .post("/api/sync/cc")
      .set("X-Sync-Key", "");

    expect(res.status).toBe(401);
    expect(mockSyncUnsyncedDims).not.toHaveBeenCalled();
  });

  it("200 with sync report when X-Sync-Key matches SYNC_SECRET", async () => {
    const res = await request(app)
      .post("/api/sync/cc")
      .set("X-Sync-Key", VALID_SECRET);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(CANNED_SYNC);
    expect(mockSyncUnsyncedDims).toHaveBeenCalledOnce();
  });

  it("503 (fail-closed) when SYNC_SECRET is unset — even with a correct-looking key", async () => {
    delete process.env.SYNC_SECRET;

    const res = await request(app)
      .post("/api/sync/cc")
      .set("X-Sync-Key", VALID_SECRET);

    expect(res.status).toBe(503);
    expect(mockSyncUnsyncedDims).not.toHaveBeenCalled();
  });

  it("503 (fail-closed) when SYNC_SECRET is empty string — even with a key present", async () => {
    process.env.SYNC_SECRET = "";

    const res = await request(app)
      .post("/api/sync/cc")
      .set("X-Sync-Key", "anything");

    expect(res.status).toBe(503);
    expect(mockSyncUnsyncedDims).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/seed
// ---------------------------------------------------------------------------

describe("POST /api/admin/seed — auth gate", () => {
  it("401 when no X-Sync-Key header is sent (SYNC_SECRET configured)", async () => {
    const res = await request(app).post("/api/admin/seed");

    expect(res.status).toBe(401);
    expect(mockSeedSkus).not.toHaveBeenCalled();
  });

  it("401 when X-Sync-Key is wrong (SYNC_SECRET configured)", async () => {
    const res = await request(app)
      .post("/api/admin/seed")
      .set("X-Sync-Key", "wrong-key");

    expect(res.status).toBe(401);
    expect(mockSeedSkus).not.toHaveBeenCalled();
  });

  it("200 with seed report when X-Sync-Key matches SYNC_SECRET", async () => {
    const res = await request(app)
      .post("/api/admin/seed")
      .set("X-Sync-Key", VALID_SECRET);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(CANNED_SEED);
    expect(mockSeedSkus).toHaveBeenCalledOnce();
  });

  it("503 (fail-closed) when SYNC_SECRET is unset — even with a key present", async () => {
    delete process.env.SYNC_SECRET;

    const res = await request(app)
      .post("/api/admin/seed")
      .set("X-Sync-Key", VALID_SECRET);

    expect(res.status).toBe(503);
    expect(mockSeedSkus).not.toHaveBeenCalled();
  });

  it("503 (fail-closed) when SYNC_SECRET is empty string", async () => {
    process.env.SYNC_SECRET = "";

    const res = await request(app)
      .post("/api/admin/seed")
      .set("X-Sync-Key", "anything");

    expect(res.status).toBe(503);
    expect(mockSeedSkus).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Un-gated routes — must NOT require X-Sync-Key
// ---------------------------------------------------------------------------

describe("Un-gated routes — no X-Sync-Key required", () => {
  it("GET /api/skus responds 200 without X-Sync-Key", async () => {
    const res = await request(app).get("/api/skus");
    expect(res.status).toBe(200);
  });

  it("GET /api/progress responds 200 without X-Sync-Key", async () => {
    const res = await request(app).get("/api/progress");
    expect(res.status).toBe(200);
  });

  it("POST /api/dims responds 200 without X-Sync-Key", async () => {
    const res = await request(app)
      .post("/api/dims")
      .send({ skuId: "prod-1", lengthMm: 100, widthMm: 200, heightMm: 300 });
    expect(res.status).toBe(200);
  });

  it("PUT /api/dims/:id responds 200 without X-Sync-Key", async () => {
    const mockUpdateDim = vi.mocked(dimSvc.updateDim);
    mockUpdateDim.mockResolvedValue({ id: 7 } as never);

    const res = await request(app).put("/api/dims/7").send({ lengthMm: 310 });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Timing-safe comparison edge cases
// ---------------------------------------------------------------------------

describe("requireSyncKey — timing-safe compare edge cases", () => {
  it("does not throw on a length-mismatched key (longer than secret)", async () => {
    const longKey = VALID_SECRET + "-extra-padding-to-make-it-longer";

    const res = await request(app)
      .post("/api/sync/cc")
      .set("X-Sync-Key", longKey);

    // Must return 401, not 500 (i.e. timingSafeEqual length guard didn't throw).
    expect(res.status).toBe(401);
    expect(mockSyncUnsyncedDims).not.toHaveBeenCalled();
  });

  it("does not throw on a length-mismatched key (shorter than secret)", async () => {
    const shortKey = VALID_SECRET.slice(0, 4);

    const res = await request(app)
      .post("/api/sync/cc")
      .set("X-Sync-Key", shortKey);

    expect(res.status).toBe(401);
    expect(mockSyncUnsyncedDims).not.toHaveBeenCalled();
  });

  it("does not throw on an empty key when SYNC_SECRET is set", async () => {
    const res = await request(app)
      .post("/api/sync/cc")
      .set("X-Sync-Key", "");

    expect(res.status).toBe(401);
    expect(mockSyncUnsyncedDims).not.toHaveBeenCalled();
  });
});
