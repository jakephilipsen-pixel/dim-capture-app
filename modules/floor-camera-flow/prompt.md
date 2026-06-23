# Build prompt: floor-camera-flow

> Closeout note: this module was already built + merged (PR #9, 2026-06-23). This prompt is kept for
> the record / future rework. The work below is DONE; see STATE.md for the as-built contract.

You are building the `floor-camera-flow` module of `dim-capture-app`.

## Read first
- `modules/floor-camera-flow/brief.md` — scope and acceptance criteria
- `modules/floor-camera-flow/smoke.md` — smoke test spec
- `modules/floor-camera-flow/STATE.md` — as-built interface contract
- Dependencies (STATE.md only): `modules/dim-api/STATE.md`, `modules/capture-page/STATE.md`
- `DECISIONS.md` (2026-06-23 entries)

## Task
Mobile-first full-screen floor capture: barcode-scan → SKU lookup → cm L/W/H/KG (auto-volume) +
Dry/Ambient/Chilled/Frozen toggle + carton photo. Backend adds `Dim.productType` + on-disk carton
photo (`POST/GET /api/dims/:id/photo`). Production-ready, no placeholders.

## Stack reminders
- Backend: Express + TS strict; Prisma; photos on disk under `PHOTO_DIR` (volume in Docker); raw
  `image/jpeg` body via a route-local `raw()` parser (bypasses the JSON limit).
- Frontend: React 19 + Vite + Tailwind; ZXing for the camera; routes OUTSIDE `<Layout>`.
- cm display / mm-canonical storage: convert cm→mm at the form boundary; DB stays mm.

## Coding standards
TypeScript strict, typed, no console.log (use the logger), match style, vitest.

## When done
Smoke green (`./scripts/smoke-module.sh floor-camera-flow`), STATE.md + MODULES.md current, PR opened.
