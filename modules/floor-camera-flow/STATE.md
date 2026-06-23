# State: floor-camera-flow

> Handoff record. Other modules load THIS FILE (not source) to know what this module exports.

## Status
✅ Built — merged 2026-06-23 (PR #9). This dir/STATE/smoke written retrospectively (closeout,
2026-06-24) so `/deploy-local`'s full smoke run is honest.

## Branch
feature/floor-camera-flow (merged to main)

## Last touched
2026-06-24 — module-15 closeout: brief/prompt/smoke/STATE + smoke scripts added.

## Public interface (the contract other modules see)
```typescript
// Backend — dim fields (schema.prisma)
//   Dim.productType: "Dry" | "Ambient" | "Chilled" | "Frozen" | null
//   Dim.photoPath:   string | null   // relative path under PHOTO_DIR, e.g. "photos/<dimId>.jpg"

// Routes (backend/src/routes/dims.ts)
POST /api/dims                 // body may include productType (validated enum); upsert one dim per SKU
POST /api/dims/:id/photo       // raw image/jpeg body → 200 {Dim}; 404 unknown id; 422 non-JPEG/empty/>12MB
GET  /api/dims/:id/photo       // 200 image/jpeg; 404 if no file on disk

// services/photoService.ts
savePhoto(dimId: number, bytes: Buffer): Promise<string>   // validates JPEG + size, writes <dimId>.jpg, returns rel path
findPhoto(dimId: number): Promise<string | null>           // abs path if on disk, else null
photoAbsolutePath(dimId: number): string
photoDir(): string                                         // PHOTO_DIR env, default <cwd>/data/photos
export const MAX_PHOTO_BYTES = 12 * 1024 * 1024

// services/dimService.ts
export const PRODUCT_TYPES = ["Dry","Ambient","Chilled","Frozen"] as const
setDimPhoto(id, photoPath)   // sets Dim.photoPath (does NOT reset sync state)

// Frontend routes (router.tsx) — OUTSIDE <Layout>
//   /floor                    → FloorScan (ZXing camera + manual entry)
//   /floor/capture/:barcode   → FloorCapture (lookup, cm L/W/H/KG + auto-volume, productType toggle, photo, SAVE)
//   FloorPhotoCapture          getUserMedia carton camera → downscaled JPEG
```

## Internal structure
- Backend: `routes/dims.ts` (photo POST uses route-local `raw({type:"image/jpeg"})`), `services/photoService.ts`
  (on-disk JPEG, magic-byte + size validation), `services/dimService.ts` (`productType` in captureSchema, `setDimPhoto`).
- Schema: `Dim.productType`, `Dim.photoPath` (additive migration).
- Frontend: `src/floor/{FloorScan,FloorCapture,FloorPhotoCapture}.tsx`, wired in `src/router.tsx`.

## Quirks / gotchas
- **cm display / mm-canonical storage**: FloorCapture converts cm→mm (`cmToMm`) at the form boundary;
  the DB/API stay mm. No unit migration. (CC-boundary metres conversion is module 16's concern, separate.)
- Carton photo is on disk (`PHOTO_DIR`, one `<dimId>.jpg`), NOT in Postgres; `Dim.photoPath` flags existence.
- Photo upload confirms the dim exists (404) BEFORE writing the file — no orphan JPEG.
- A photo is metadata: attaching one does NOT reset `syncedToCC`.
- Offline: dims queue (IndexedDB); the photo needs a live connection (operator told "photo not saved").

## Test status
- [x] Unit tests: backend photo route/service + floor capture (see backend `photoService`/`photoRoutes`/`floorCapture` tests, frontend FloorCapture test).
- [x] Smoke: `modules/floor-camera-flow/smoke/` (seed → floor capture w/ productType → photo upload → fetch).

## In-flight / follow-ups
- None. Module complete; closeout only.

## Decisions made during this module's build
See DECISIONS.md 2026-06-23 (cm-display/mm-canonical, on-disk JPEG, offline scope, productType enum).
