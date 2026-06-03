import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

// Mock the services so these tests cover routing, param validation, and
// AppError → HTTP status mapping through the REAL app + errorHandler — not the
// service logic (that's covered by dimService/syncService unit tests).
vi.mock("../services/dimService", () => ({
  saveDim: vi.fn(),
  listDims: vi.fn(),
  updateDim: vi.fn(),
}));
vi.mock("../services/syncService", () => ({
  syncUnsyncedDims: vi.fn(),
}));

import { app } from "../app";
import { AppError } from "../lib/errors";
import { listDims, saveDim, updateDim } from "../services/dimService";
import { syncUnsyncedDims } from "../services/syncService";

const mockSave = vi.mocked(saveDim);
const mockList = vi.mocked(listDims);
const mockUpdate = vi.mocked(updateDim);
const mockSync = vi.mocked(syncUnsyncedDims);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/dims", () => {
  it("returns the saved dim as JSON", async () => {
    mockSave.mockResolvedValue({ id: 1, skuId: "prod-1" } as never);
    const res = await request(app).post("/api/dims").send({ skuId: "prod-1" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 1, skuId: "prod-1" });
    expect(mockSave).toHaveBeenCalledWith({ skuId: "prod-1" });
  });

  it("maps a 422 AppError to HTTP 422", async () => {
    mockSave.mockRejectedValue(new AppError("lengthMm must be greater than 0", 422));
    const res = await request(app).post("/api/dims").send({ skuId: "prod-1", lengthMm: 0 });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: "lengthMm must be greater than 0" });
  });

  it("maps a 404 AppError (unknown skuId) to HTTP 404", async () => {
    mockSave.mockRejectedValue(new AppError("Unknown skuId: nope", 404));
    const res = await request(app).post("/api/dims").send({ skuId: "nope" });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/dims", () => {
  it("returns the list from the service", async () => {
    mockList.mockResolvedValue([{ id: 2 }, { id: 1 }] as never);
    const res = await request(app).get("/api/dims");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 2 }, { id: 1 }]);
  });
});

describe("PUT /api/dims/:id", () => {
  it("updates and returns the dim", async () => {
    mockUpdate.mockResolvedValue({ id: 7 } as never);
    const res = await request(app).put("/api/dims/7").send({ lengthMm: 310 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 7 });
    expect(mockUpdate).toHaveBeenCalledWith(7, { lengthMm: 310 });
  });

  it("rejects a non-numeric id with 400 and never calls the service", async () => {
    const res = await request(app).put("/api/dims/abc").send({ lengthMm: 310 });
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("maps a 404 AppError to HTTP 404", async () => {
    mockUpdate.mockRejectedValue(new AppError("Dim 999 not found", 404));
    const res = await request(app).put("/api/dims/999").send({ lengthMm: 310 });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/sync/cc", () => {
  it("returns the sync report", async () => {
    mockSync.mockResolvedValue({ synced: 2, failed: 1, pending: 1 });
    const res = await request(app).post("/api/sync/cc");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ synced: 2, failed: 1, pending: 1 });
  });
});
