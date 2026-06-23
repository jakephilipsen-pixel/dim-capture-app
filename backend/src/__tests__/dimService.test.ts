import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock `lib/db` — dimService imports both `prisma` and `withAdvisoryLock`.
//
// `saveDim` now runs inside `withAdvisoryLock(prisma, key, cb)`.  We mock
// `withAdvisoryLock` to call the callback with a `tx` stub that is the same
// object as `prisma` (all the same vi.fn()s), so assertions on `sku.findUnique`
// and `dim.upsert` continue to work exactly as before.  Lock contention can be
// simulated per-test by swapping the implementation to `mockResolvedValue(null)`.
vi.mock("../lib/db", () => {
  const sku = { findUnique: vi.fn() };
  const dim = {
    upsert: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  };
  const prisma = { sku, dim };
  // Default: lock acquired — run the callback with the shared prisma surface.
  const withAdvisoryLock = vi.fn(
    async (_p: unknown, _k: unknown, cb: (tx: unknown) => unknown) => cb(prisma),
  );
  return { prisma, withAdvisoryLock };
});

import { AppError } from "../lib/errors";
import { prisma, withAdvisoryLock } from "../lib/db";
import { listDims, saveDim, updateDim } from "../services/dimService";

const sku = vi.mocked(prisma.sku, true);
const dim = vi.mocked(prisma.dim, true);
const lock = vi.mocked(withAdvisoryLock, true);

const validCapture = {
  skuId: "prod-1",
  lengthMm: 300,
  widthMm: 200,
  heightMm: 150,
  weightKg: 2.4,
  measuredBy: "Jake",
};

/** Capture the AppError thrown by an async call. Fails the test if none is thrown. */
async function catchAppError(fn: () => Promise<unknown>): Promise<AppError> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return err as AppError;
  }
  throw new Error("expected an AppError to be thrown, but none was");
}

beforeEach(() => {
  vi.resetAllMocks();
  // Re-establish `withAdvisoryLock` after resetAllMocks wipes its implementation.
  // Default: lock acquired — invoke the callback with the shared prisma/tx stub.
  lock.mockImplementation(
    async (_p, _k, cb: (tx: unknown) => unknown) => cb({ sku, dim }),
  );
});

describe("saveDim", () => {
  it("saves a valid capture against an existing SKU", async () => {
    sku.findUnique.mockResolvedValue({ id: "prod-1" } as never);
    const saved = { id: 1, ...validCapture, notes: null };
    dim.upsert.mockResolvedValue(saved as never);

    const result = await saveDim(validCapture);

    expect(result).toBe(saved);
    expect(sku.findUnique).toHaveBeenCalledWith({ where: { id: "prod-1" } });
    expect(dim.upsert).toHaveBeenCalledTimes(1);
    expect(dim.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { skuId: "prod-1" },
        create: expect.objectContaining({ skuId: "prod-1", lengthMm: 300, notes: null }),
      }),
    );
  });

  it("upsert overwrite (re-capture) resets sync state and re-stamps measuredAt", async () => {
    sku.findUnique.mockResolvedValue({ id: "prod-1" } as never);
    dim.upsert.mockResolvedValue({ id: 1 } as never);

    await saveDim({ ...validCapture, notes: "second pass" });

    expect(dim.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          syncedToCC: false,
          syncedAt: null,
          // sole re-arm path for a name-blocked SKU: a re-capture MUST clear the reason
          syncBlockedReason: null,
          measuredAt: expect.any(Date),
          notes: "second pass",
        }),
      }),
    );
  });

  it("rejects a zero dimension with 422 and never touches the DB", async () => {
    const err = await catchAppError(() => saveDim({ ...validCapture, heightMm: 0 }));
    expect(err.statusCode).toBe(422);
    expect(sku.findUnique).not.toHaveBeenCalled();
    expect(dim.upsert).not.toHaveBeenCalled();
  });

  it("rejects a negative weight with 422", async () => {
    const err = await catchAppError(() => saveDim({ ...validCapture, weightKg: -1 }));
    expect(err.statusCode).toBe(422);
  });

  it("rejects a blank measuredBy with 422", async () => {
    const err = await catchAppError(() => saveDim({ ...validCapture, measuredBy: "   " }));
    expect(err.statusCode).toBe(422);
  });

  // M5 — upper sanity bound: dims > 100,000 mm or weight > 1,000 kg rejected.
  it("rejects a length above the upper sanity bound (> 100000 mm) with 422 — M5", async () => {
    const err = await catchAppError(() => saveDim({ ...validCapture, lengthMm: 100001 }));
    expect(err.statusCode).toBe(422);
  });

  it("rejects a width above the upper sanity bound with 422 — M5", async () => {
    const err = await catchAppError(() => saveDim({ ...validCapture, widthMm: 1e308 }));
    expect(err.statusCode).toBe(422);
  });

  it("rejects a height above the upper sanity bound with 422 — M5", async () => {
    const err = await catchAppError(() => saveDim({ ...validCapture, heightMm: 100001 }));
    expect(err.statusCode).toBe(422);
  });

  it("rejects a weight above the upper sanity bound (> 1000 kg) with 422 — M5", async () => {
    const err = await catchAppError(() => saveDim({ ...validCapture, weightKg: 1001 }));
    expect(err.statusCode).toBe(422);
  });

  it("accepts dims exactly at the upper bound — M5", async () => {
    sku.findUnique.mockResolvedValue({ id: "prod-1" } as never);
    dim.upsert.mockResolvedValue({ id: 1 } as never);
    // Must NOT throw — exactly at the limit.
    await expect(
      saveDim({ ...validCapture, lengthMm: 100000, widthMm: 100000, heightMm: 100000, weightKg: 1000 }),
    ).resolves.toBeDefined();
  });

  // M6 — non-finite numbers produce a clear error message (not "expected number, received number").
  it("rejects JSON Infinity in a dim field with a clear 'finite' message — M6", async () => {
    const err = await catchAppError(() => saveDim({ ...validCapture, lengthMm: Infinity }));
    expect(err.statusCode).toBe(422);
    expect(err.message.toLowerCase()).toContain("finite");
  });

  it("rejects -Infinity with a finite message — M6", async () => {
    const err = await catchAppError(() => saveDim({ ...validCapture, widthMm: -Infinity }));
    expect(err.statusCode).toBe(422);
    expect(err.message.toLowerCase()).toContain("finite");
  });

  it("rejects NaN with a clear message — M6", async () => {
    const err = await catchAppError(() => saveDim({ ...validCapture, heightMm: NaN }));
    expect(err.statusCode).toBe(422);
    // NaN is not a number in zod's view — just confirm it's a 422.
    expect(err.statusCode).toBe(422);
  });

  it("rejects an unknown skuId with 404", async () => {
    sku.findUnique.mockResolvedValue(null as never);
    const err = await catchAppError(() => saveDim(validCapture));
    expect(err.statusCode).toBe(404);
    expect(dim.upsert).not.toHaveBeenCalled();
  });
});

describe("listDims", () => {
  it("returns dims most-recent first with the joined SKU name + barcode", async () => {
    const rows = [{ id: 2 }, { id: 1 }];
    dim.findMany.mockResolvedValue(rows as never);

    const result = await listDims();

    expect(result).toBe(rows);
    expect(dim.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { measuredAt: "desc" },
        include: { sku: { select: { name: true, barcode: true } } },
      }),
    );
  });
});

describe("updateDim", () => {
  const correction = {
    lengthMm: 310,
    widthMm: 205,
    heightMm: 155,
    weightKg: 2.5,
    measuredBy: "Sam",
  };

  it("updates an existing dim and resets sync state", async () => {
    dim.findUnique.mockResolvedValue({ id: 7 } as never);
    dim.update.mockResolvedValue({ id: 7 } as never);

    await updateDim(7, correction);

    expect(dim.findUnique).toHaveBeenCalledWith({ where: { id: 7 } });
    expect(dim.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7 },
        data: expect.objectContaining({ syncedToCC: false, syncedAt: null, syncBlockedReason: null, lengthMm: 310 }),
      }),
    );
  });

  it("rejects an unknown id with 404", async () => {
    dim.findUnique.mockResolvedValue(null as never);
    const err = await catchAppError(() => updateDim(999, correction));
    expect(err.statusCode).toBe(404);
    expect(dim.update).not.toHaveBeenCalled();
  });

  it("rejects an invalid correction body with 422", async () => {
    const err = await catchAppError(() => updateDim(7, { ...correction, lengthMm: 0 }));
    expect(err.statusCode).toBe(422);
    expect(dim.findUnique).not.toHaveBeenCalled();
  });

  it("rejects an over-bound correction dim with 422 — M5", async () => {
    const err = await catchAppError(() => updateDim(7, { ...correction, lengthMm: 200000 }));
    expect(err.statusCode).toBe(422);
    expect(dim.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a non-finite correction dim with a clear message — M6", async () => {
    const err = await catchAppError(() => updateDim(7, { ...correction, weightKg: Infinity }));
    expect(err.statusCode).toBe(422);
    expect(err.message.toLowerCase()).toContain("finite");
  });
});
