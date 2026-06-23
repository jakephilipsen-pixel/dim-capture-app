import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppError } from "../lib/errors";
import { findPhoto, photoAbsolutePath, savePhoto } from "../services/photoService";

// A 6-byte buffer that passes the JPEG magic-number check (FF D8 FF …).
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "dca-photo-"));
  process.env.PHOTO_DIR = dir;
});

afterEach(async () => {
  delete process.env.PHOTO_DIR;
  await rm(dir, { recursive: true, force: true });
});

async function expectAppError(fn: () => Promise<unknown>, status: number): Promise<void> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(status);
    return;
  }
  throw new Error("expected an AppError, but none was thrown");
}

describe("savePhoto", () => {
  it("writes the bytes to <dimId>.jpg under PHOTO_DIR and returns a relative path", async () => {
    const rel = await savePhoto(42, JPEG);
    expect(rel).toBe("photos/42.jpg");
    const written = await readFile(photoAbsolutePath(42));
    expect(written.equals(JPEG)).toBe(true);
  });

  it("rejects an empty body with 422", async () => {
    await expectAppError(() => savePhoto(1, Buffer.alloc(0)), 422);
  });

  it("rejects a non-JPEG body with 422", async () => {
    await expectAppError(() => savePhoto(1, Buffer.from([0x89, 0x50, 0x4e, 0x47])), 422); // PNG header
  });

  it("rejects a body over the size ceiling with 422", async () => {
    const huge = Buffer.concat([JPEG, Buffer.alloc(13 * 1024 * 1024)]);
    await expectAppError(() => savePhoto(1, huge), 422);
  });

  it("overwrites an existing photo on re-capture (stable filename)", async () => {
    await savePhoto(7, JPEG);
    const next = Buffer.from([0xff, 0xd8, 0xff, 0xee, 0x01, 0x02]);
    await savePhoto(7, next);
    const written = await readFile(photoAbsolutePath(7));
    expect(written.equals(next)).toBe(true);
  });
});

describe("findPhoto", () => {
  it("returns the absolute path when the photo exists", async () => {
    await savePhoto(9, JPEG);
    expect(await findPhoto(9)).toBe(photoAbsolutePath(9));
  });

  it("returns null when no photo exists for the dim", async () => {
    expect(await findPhoto(123)).toBeNull();
  });
});
