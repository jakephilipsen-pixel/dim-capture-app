# Smoke test: floor-camera-flow

Quick local validation that the floor capture + carton-photo round trip works against the real
backend container (no real CartonCloud — a SKU is seeded via the in-container v8 mock so the floor
flow has something to capture against).

## Pre-flight
- Module marked complete in STATE.md
- All unit tests passing
- On Pop!_OS laptop with Docker daemon running

## Run
```bash
# From project root
./scripts/smoke-module.sh floor-camera-flow
```

The script builds the backend image, boots backend + throwaway Postgres + the mock CC, runs the
health check + the smoke tests in `modules/floor-camera-flow/smoke/`, and tears down.

## Smoke test scope
Proves the floor capture path end to end:
- Backend boots, `/api/health` reports `db:connected`.
- A SKU is seeded (via the mock CC) so the floor flow has a target.
- `POST /api/dims` with a `productType` (e.g. Chilled) is accepted and the class is stored.
- `POST /api/dims/:id/photo` stores a JPEG on disk (200), and `GET /api/dims/:id/photo` streams it
  back (200, `image/jpeg`).

NOT in scope: camera/getUserMedia UI (browser-only), exhaustive cases (unit tests), CC sync.

## Acceptance
- Container boots within 30s; health check 200 on first attempt after boot.
- Floor capture (with productType) + photo upload + photo fetch all succeed.
- Clean shutdown (no orphaned volumes).

## On failure
1. Do NOT regress the module in MODULES.md.
2. Diagnose — usually a missing env var, PHOTO_DIR not writable, or a port collision (this stack uses 3013).
3. Fix on a branch, re-run smoke, then commit.

## Smoke test files location
`modules/floor-camera-flow/smoke/`:
- `smoke/healthcheck.sh` — polls `/api/health` for `db:connected`
- `smoke/happy-path.sh` — seed → floor capture (productType) → photo upload → photo fetch
- Both must exit 0.
