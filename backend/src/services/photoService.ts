/**
 * Photo service — on-disk storage for carton photos (Floor camera flow).
 *
 * A carton photo rides along with a dim capture. We store the JPEG bytes on disk
 * (one file per dim, keyed by the stable dim id) rather than in Postgres: photos
 * are large binary blobs, the DB row only needs to know one exists, and a flat
 * directory is trivial to back up and serve. `Dim.photoPath` holds the relative
 * path so `GET /api/dims/:id/photo` can stream it and `listDims` can flag it.
 *
 * Storage root is `PHOTO_DIR` (env), defaulting to `<cwd>/data/photos`. In Docker
 * this is a mounted volume so photos survive container restarts.
 */
import { mkdir, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

import { AppError } from "../lib/errors";

/** Storage root for carton JPEGs (a mounted volume in Docker). Read at call time
 * so tests — and a relocated deployment — can point PHOTO_DIR elsewhere. */
export function photoDir(): string {
  return process.env.PHOTO_DIR ?? path.join(process.cwd(), "data", "photos");
}

/** Largest carton JPEG we accept (bytes). The client downscales before upload; this is the ceiling. */
export const MAX_PHOTO_BYTES = 12 * 1024 * 1024; // 12 MB

/** The on-disk filename for a dim's photo. Stable across re-captures (dim id is stable per SKU). */
function photoFilename(dimId: number): string {
  return `${dimId}.jpg`;
}

/** Absolute path to a dim's photo file (whether or not it exists yet). */
export function photoAbsolutePath(dimId: number): string {
  return path.join(photoDir(), photoFilename(dimId));
}

/**
 * Persist a JPEG buffer for a dim. Validates the bytes are a non-empty JPEG and
 * within the size ceiling (422 otherwise), writes `<dimId>.jpg` under PHOTO_DIR
 * (creating it on first use), and returns the relative path to store on the Dim.
 */
export async function savePhoto(dimId: number, bytes: Buffer): Promise<string> {
  if (bytes.length === 0) {
    throw new AppError("photo body is empty", 422);
  }
  if (bytes.length > MAX_PHOTO_BYTES) {
    throw new AppError(`photo exceeds ${MAX_PHOTO_BYTES} bytes`, 422);
  }
  // JPEG magic number (FF D8 FF). Guards against a wrong content type reaching disk.
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new AppError("photo must be a JPEG image", 422);
  }

  await mkdir(photoDir(), { recursive: true });
  await writeFile(photoAbsolutePath(dimId), bytes);
  return path.posix.join("photos", photoFilename(dimId));
}

/** Absolute path to a dim's photo if it exists on disk, else null. */
export async function findPhoto(dimId: number): Promise<string | null> {
  const abs = photoAbsolutePath(dimId);
  try {
    await access(abs, constants.R_OK);
    return abs;
  } catch {
    return null;
  }
}
