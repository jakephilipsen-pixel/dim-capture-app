# Build prompt: cc-oauth-write

You are building the `cc-oauth-write` module of `dim-capture-app`.

## Read first
- This file (`modules/cc-oauth-write/prompt.md`)
- `modules/cc-oauth-write/brief.md` — scope and acceptance criteria
- `modules/cc-oauth-write/smoke.md` — smoke test spec (must pass before module is ✅)
- `modules/cc-oauth-write/STATE.md` — current state
- `docs/superpowers/specs/2026-06-24-combine-pipeline-design.md` — the full design (authority)
- For each dependency in brief.md: `modules/<dep>/STATE.md` (interface contract only — not source)
- `DECISIONS.md` — architectural decisions already made

## Do not read
- Source code of dependency modules (use their STATE.md interface contracts)
- Modules not listed as dependencies
- `node_modules/`, build artifacts, lockfiles

## Task
Build this module to satisfy every acceptance criterion in `brief.md`. Production-ready code,
no placeholders. This replaces the app's CC integration layer with the validated recipe.

## Workflow
1. Confirm understanding: 2-3 sentences on what you're building + planned approach
2. Build incrementally with TDD — write a failing test, implement, pass; don't write 500 lines then test
3. After each meaningful chunk, update `STATE.md` with current exports and progress
4. When acceptance criteria all pass:
   a. Write smoke tests in `modules/cc-oauth-write/smoke/` per smoke.md
   b. Run `./scripts/smoke-module.sh cc-oauth-write` — must exit 0
   c. If smoke fails, fix on this same branch
   d. Finalise `STATE.md` with full interface contract + quirks
   e. Update `MODULES.md` row to ✅ Built
   f. Commit, push, open PR

## Stack reminders
- Node 22 + Express + TypeScript strict; Prisma + PostgreSQL 16; vitest with mocked `fetch`.
- `ccClient` already has: token-bucket rate limiter (sync/seed buckets), `AbortSignal.timeout`,
  typed errors (`CcApiError`/`CcRateLimitError`/`CcTimeoutError`/`CcNotFoundError`), and
  `mmToMetres` (mm→m ÷1000). REUSE these; do not duplicate.
- The in-container CC mock is `backend/src/smoke/mockCc.ts` — extend it to the v8
  warehouse-products + json-patch shapes.
- Prisma schema changes are additive migrations; the NUC DB is fresh (first deploy).

## CC recipe (authority — do not re-derive; confirmed by live probe 2026-06-24)
- Auth: `POST https://api.cartoncloud.com/uaa/oauth/token`, `Authorization: Basic base64(CC_CLIENT_ID:CC_CLIENT_SECRET)`,
  `Content-Type: application/x-www-form-urlencoded`, body `grant_type=client_credentials`.
  Cache `access_token`; refresh 60s before `expires_in`.
- All data paths tenant-scoped: `/tenants/{CC_TENANT_ID}/…`, `Authorization: Bearer {token}`.
- Read product: `GET /warehouse-products/{id}`, `Accept-Version: 8`.
- Search: `POST /warehouse-products/search`, `Accept-Version: 8`, customer-scoped to Forage
  (`d4810e1e-91ab-43ed-b68e-b72bd858b122`), paginated, returns full objects incl. `unitOfMeasures`.
- Write: `PATCH /warehouse-products/{id}`, `Accept-Version: 8`,
  `Content-Type: application/json-patch+json`, body = JSON-Patch array of
  `{op:"add", path:"/unitOfMeasures/{uomKey}/{length|width|height|weight}", value:<metres|kg>}`
  for CHANGED fields only. `{uomKey}` = `defaultUnitOfMeasure` (e.g. "EA"), NOT the UoM UUID.
- Read-back: GET again under v8, compare the target UoM's dims to what was written; mismatch throws.
- Name-poison: any `unitOfMeasures[*].name` outside 3–64 chars poisons the whole-product PATCH —
  skip the SKU (no PATCH), record the offending UoM(s).

## Coding standards
- TypeScript strict, no `any` without justification; all exports typed; typed errors (no string throws)
- Tests use vitest; no `console.log` in committed code — use the project logger
- Match existing code style; run linter before commit

## Context budget
This build should not exceed 180K tokens. If approaching that, stop and update STATE.md to resume
cleanly. If unavoidable, the module was scoped wrong (split seed-repoint vs write) — flag it.

## When done
Tell Jake: "Module `cc-oauth-write` complete. Smoke passed. PR: <url>. Acceptance criteria met.
STATE.md and MODULES.md updated."
