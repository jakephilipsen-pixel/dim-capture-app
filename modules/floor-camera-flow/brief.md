# Module: floor-camera-flow

## Purpose
Full-screen, mobile-first floor capture flow (from the claude.ai/design mockup): a putaway
operator scans a carton barcode with the device camera, the app looks up the SKU, and they enter
L/W/H/weight (in cm, auto-volume), pick a carton class (Dry/Ambient/Chilled/Frozen), and snap a
carton photo — all outside the desktop `<Layout>` chrome. Backend adds an optional carton class
and on-disk carton-photo storage to a dim. (Closeout doc — the module was built and merged
2026-06-23, PR #9; this file/STATE/smoke were written retrospectively to make the deploy-local
gate honest.)

## In scope
- Frontend routes OUTSIDE `<Layout>`: `/floor` (FloorScan — ZXing barcode camera + manual
  fallback), `/floor/capture/:barcode` (FloorCapture — SKU lookup, progress ring, customer chip,
  SKU card, Dry/Ambient/Chilled/Frozen toggle, carton-photo thumbnail, L/W/H/KG **in cm** with live
  auto-volume, SAVE), and FloorPhotoCapture (getUserMedia carton camera → downscaled JPEG).
- Backend: `Dim.productType` (nullable enum) + `Dim.photoPath` (nullable); additive migration.
- Backend: `POST /api/dims/:id/photo` (raw `image/jpeg` body, route-local parser bypassing the JSON
  limit) and `GET /api/dims/:id/photo` (streams the on-disk JPEG); `productType` validated on capture.
- cm display / **mm-canonical storage**: the form converts cm→mm (`cmToMm`) at the boundary; the DB
  stays mm — no schema/unit migration.

## Out of scope
- Pushing dims to CartonCloud (that's the sync path / module 16 `cc-oauth-write`).
- Offline photo queueing — dims queue offline; the carton photo needs a live connection (the
  operator is told "photo not saved (no connection)"). Deferred enhancement, not a stub.
- The desktop capture/progress/review pages (modules 06/07).

## Dependencies
- 04 `dim-api` — `POST/GET /api/dims`, `dimService` (extended here with `productType` + photo).
- 06 `capture-page` — SKU lookup hook, `DimForm` patterns, the offline sync manager.

## Public interface (what this module exports)
```typescript
// Backend
// Dim.productType: "Dry" | "Ambient" | "Chilled" | "Frozen" | null
// Dim.photoPath:   string | null  (relative path under PHOTO_DIR, e.g. "photos/<dimId>.jpg")
POST /api/dims                 // body may include productType (validated enum)
POST /api/dims/:id/photo       // Content-Type image/jpeg, raw bytes → 200 {Dim}; 404 unknown id; 422 non-JPEG/empty/oversize
GET  /api/dims/:id/photo       // 200 image/jpeg stream; 404 if none on disk
// services/photoService.ts: savePhoto(dimId, bytes) → relPath; findPhoto(dimId) → absPath|null;
//   photoDir() (PHOTO_DIR env, default <cwd>/data/photos); MAX_PHOTO_BYTES = 12 MB; JPEG magic-byte check.

// Frontend routes: /floor, /floor/capture/:barcode  (outside <Layout>)
```

## Acceptance criteria
- [x] `/floor` scans a barcode (camera) with a manual entry fallback.
- [x] `/floor/capture/:barcode` looks up the SKU and captures L/W/H/KG (cm in, mm stored) + productType + photo.
- [x] `POST /api/dims` accepts and validates an optional `productType` enum.
- [x] `POST /api/dims/:id/photo` stores a JPEG on disk (404 before write for unknown id; 422 on bad bytes); `GET` streams it back.
- [x] Carton photo never resets CC sync state (it's metadata, not a re-measurement).
- [x] Unit tests cover the backend photo route/service + floor capture; integrates with dim-api.

## Notes
- DECISIONS.md 2026-06-23 entries: cm-display/mm-canonical at the form boundary; on-disk JPEG storage
  (one `<dimId>.jpg`); offline scope (dims queue, photo needs a connection); `productType` optional enum.
- A photo write confirms dim existence BEFORE writing the file (no orphan JPEG on a 404).
- The historical "cc-client sends dims in mm/cm" flag noted here at build time is resolved separately
  (metres fix + module 16); not part of this flow.
