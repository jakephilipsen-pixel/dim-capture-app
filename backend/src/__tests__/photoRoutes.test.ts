import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

// Mock the services so these tests cover routing + raw-body parsing + AppError →
// HTTP mapping through the REAL app, not the service/disk logic (covered by
// photoService/floorCapture unit tests). MAX_PHOTO_BYTES must be a real number —
// the route passes it to express.raw({ limit }).
vi.mock("../services/dimService", () => ({
  saveDim: vi.fn(),
  listDims: vi.fn(),
  updateDim: vi.fn(),
  getDim: vi.fn(),
  setDimPhoto: vi.fn(),
}));
vi.mock("../services/photoService", () => ({
  savePhoto: vi.fn(),
  findPhoto: vi.fn(),
  MAX_PHOTO_BYTES: 12 * 1024 * 1024,
}));

import { app } from "../app";
import { AppError } from "../lib/errors";
import { getDim, setDimPhoto } from "../services/dimService";
import { findPhoto, savePhoto } from "../services/photoService";

const mockGetDim = vi.mocked(getDim);
const mockSetPhoto = vi.mocked(setDimPhoto);
const mockSave = vi.mocked(savePhoto);
const mockFind = vi.mocked(findPhoto);

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/dims/:id/photo", () => {
  it("stores the JPEG and returns the updated dim", async () => {
    mockGetDim.mockResolvedValue({ id: 5 } as never);
    mockSave.mockResolvedValue("photos/5.jpg");
    mockSetPhoto.mockResolvedValue({ id: 5, photoPath: "photos/5.jpg" } as never);

    const res = await request(app)
      .post("/api/dims/5/photo")
      .set("Content-Type", "image/jpeg")
      .send(JPEG);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 5, photoPath: "photos/5.jpg" });
    expect(mockGetDim).toHaveBeenCalledWith(5);
    // raw body reached the service intact.
    expect(mockSave).toHaveBeenCalledWith(5, expect.any(Buffer));
    expect(mockSave.mock.calls[0][1].equals(JPEG)).toBe(true);
    expect(mockSetPhoto).toHaveBeenCalledWith(5, "photos/5.jpg");
  });

  it("404s for an unknown dim and never writes a file", async () => {
    mockGetDim.mockRejectedValue(new AppError("Dim 9 not found", 404));

    const res = await request(app)
      .post("/api/dims/9/photo")
      .set("Content-Type", "image/jpeg")
      .send(JPEG);

    expect(res.status).toBe(404);
    expect(mockSave).not.toHaveBeenCalled(); // existence is checked BEFORE writing
  });

  it("400s on a non-numeric id", async () => {
    const res = await request(app)
      .post("/api/dims/abc/photo")
      .set("Content-Type", "image/jpeg")
      .send(JPEG);
    expect(res.status).toBe(400);
  });

  it("maps a 422 from the photo service (bad bytes) to HTTP 422", async () => {
    mockGetDim.mockResolvedValue({ id: 1 } as never);
    mockSave.mockRejectedValue(new AppError("photo must be a JPEG image", 422));

    const res = await request(app)
      .post("/api/dims/1/photo")
      .set("Content-Type", "image/jpeg")
      .send(Buffer.from([0x00, 0x01]));

    expect(res.status).toBe(422);
  });
});

describe("GET /api/dims/:id/photo", () => {
  let dir: string;
  let file: string;

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("streams the JPEG when it exists", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "dca-route-"));
    file = path.join(dir, "3.jpg");
    await writeFile(file, JPEG);
    mockFind.mockResolvedValue(file);

    const res = await request(app).get("/api/dims/3/photo");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/jpeg");
    expect(Buffer.from(res.body).equals(JPEG)).toBe(true);
  });

  it("404s when there is no photo for the dim", async () => {
    mockFind.mockResolvedValue(null);
    const res = await request(app).get("/api/dims/3/photo");
    expect(res.status).toBe(404);
  });
});
