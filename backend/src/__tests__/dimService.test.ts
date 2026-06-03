import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the prisma singleton dimService depends on. Factory is hoisted by
// vitest, so the service (imported below) binds to this mock.
vi.mock("../lib/db", () => ({
  prisma: {
    sku: { findUnique: vi.fn() },
    dim: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { AppError } from "../lib/errors";
import { prisma } from "../lib/db";
import { listDims, saveDim, updateDim } from "../services/dimService";

const sku = vi.mocked(prisma.sku, true);
const dim = vi.mocked(prisma.dim, true);

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
        data: expect.objectContaining({ syncedToCC: false, syncedAt: null, lengthMm: 310 }),
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
});
