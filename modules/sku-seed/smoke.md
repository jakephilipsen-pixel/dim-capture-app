# Smoke test: sku-seed

Quick local validation that this module boots and responds. Runs after the module is built, before declaring it ✅.

## Pre-flight
- Module marked complete in STATE.md
- All unit tests passing
- On Pop!_OS laptop with Docker daemon running

## Run
```bash
# From project root
./scripts/smoke-module.sh sku-seed
```

The script:
1. Builds this module's container (or service component)
2. Boots minimal stack (this module + its declared dependencies only)
3. Runs health check against module's exposed endpoints (per STATE.md)
4. Runs the smoke tests in `modules/sku-seed/smoke/`
5. Tears down

## Smoke test scope
Smoke tests are **not** the same as unit tests. They prove:
- The module starts in a real container
- Its declared interface (per STATE.md) actually responds
- It can talk to its declared dependencies
- One happy-path round trip works

They are NOT:
- Exhaustive (that's stress test phase)
- Cross-module integration (that's compile/stress)
- Performance (that's stress test phase)

## Acceptance
- Container boots within 30s
- Health check returns 200 on first attempt after boot
- Happy-path smoke test passes
- Clean shutdown (no zombie processes, no orphaned volumes)

## On failure
1. Do NOT mark module ✅ in MODULES.md
2. Diagnose — usually one of: missing env var, port collision, dependency contract mismatch with reality
3. Fix on the same `feature/<module>` branch — don't open a `fix/` branch yet, the module isn't done
4. Re-run smoke
5. Only when green: commit, push, mark ✅, open PR

## Smoke test files location
`modules/sku-seed/smoke/` — convention:
- `smoke/healthcheck.sh` — curls health endpoint
- `smoke/happy-path.sh` — exercises one realistic round trip
- Both must exit 0 to pass
