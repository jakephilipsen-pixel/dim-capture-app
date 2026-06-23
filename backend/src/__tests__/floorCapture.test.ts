import { beforeEach, describe, expect, it, vi } from "vitest";

// Same lib/db mock shape as dimService.test.ts: prisma surface + a withAdvisoryLock
// that runs the callback against the shared prisma stub.
vi.mock("../lib/db", () => {
  const sku = { findUnique: vi.fn() };
  const dim = {
    upsert: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  };
  const prisma = { sku, dim };
  const withAdvisoryLock = vi.fn(
    async (_p: unknown, _k: unknown, cb: (tx: unknown) => unknown) => cb(prisma),
  );
  return { prisma, withAdvisoryLock };
});

import { AppError } from "../lib/errors";
import { prisma, withAdvisoryLock } from "../lib/db";
import { getDim, saveDim, setDimPhoto } from "../services/dimService";

const sku = vi.mocked(prisma.sku, true);
const dim = vi.mocked(prisma.dim, true);
const lock = vi.mocked(withAdvisoryLock, true);

const base = {
  skuId: "prod-1",
  lengthMm: 300,
  widthMm: 200,
  heightMm: 150,
  weightKg: 2.4,
  measuredBy: "Jake",
};

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
  // resetAllMocks wipes implementations too — re-establish the lock so it runs
  // the callback against the shared prisma stub (matches dimService.test.ts).
  lock.mockImplementation(
    async (_p: unknown, _k: unknown, cb: (tx: unknown) => unknown) => cb(prisma),
  );
});

describe("productType on capture", () => {
  it("persists a valid carton class", async () => {
    sku.findUnique.mockResolvedValue({ id: "prod-1" });
    dim.upsert.mockResolvedValue({ id: 1 });

    await saveDim({ ...base, productType: "Chilled" });

    const arg = dim.upsert.mock.calls[0][0];
    expect(arg.create.productType).toBe("Chilled");
    expect(arg.update.productType).toBe("Chilled");
  });

  it("defaults to null when omitted (non-Floor capture stays valid)", async () => {
    sku.findUnique.mockResolvedValue({ id: "prod-1" });
    dim.upsert.mockResolvedValue({ id: 1 });

    await saveDim(base);

    expect(dim.upsert.mock.calls[0][0].create.productType).toBeNull();
  });

  it("rejects an unknown carton class with 422", async () => {
    const err = await catchAppError(() => saveDim({ ...base, productType: "Tepid" }));
    expect(err.statusCode).toBe(422);
    expect(dim.upsert).not.toHaveBeenCalled();
  });
});

describe("setDimPhoto", () => {
  it("writes the photo path without touching sync state", async () => {
    dim.findUnique.mockResolvedValue({ id: 5 });
    dim.update.mockResolvedValue({ id: 5, photoPath: "photos/5.jpg" });

    await setDimPhoto(5, "photos/5.jpg");

    const arg = dim.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 5 });
    expect(arg.data).toEqual({ photoPath: "photos/5.jpg" });
    // a photo must NOT reset CC sync state — it's metadata, not a re-measurement.
    expect(arg.data).not.toHaveProperty("syncedToCC");
  });

  it("404s when the dim id is unknown", async () => {
    dim.findUnique.mockResolvedValue(null);
    const err = await catchAppError(() => setDimPhoto(99, "photos/99.jpg"));
    expect(err.statusCode).toBe(404);
    expect(dim.update).not.toHaveBeenCalled();
  });
});

describe("getDim", () => {
  it("returns the dim when it exists", async () => {
    dim.findUnique.mockResolvedValue({ id: 3 });
    expect(await getDim(3)).toEqual({ id: 3 });
  });

  it("404s when the dim id is unknown", async () => {
    dim.findUnique.mockResolvedValue(null);
    const err = await catchAppError(() => getDim(404));
    expect(err.statusCode).toBe(404);
  });
});
