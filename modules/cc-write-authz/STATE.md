# State: cc-write-authz

> This file is the handoff record between conversations. Keep it accurate.
> Other modules will load THIS FILE (not source) to understand what this module exports.

## Status
✅ Built — 2026-06-08

## Branch
`feature/hardening` (shared with modules 09, 10, 11, 13)

## Last touched
2026-06-08 — module built (S6 CC-write gate). tsc clean; **134/134** tests
(was 116; +18 new: 18 in ccWriteAuthz.test.ts; dimRoutes + skuRoutes updated to
supply the key in the three tests that hit gated routes).

## What changed

### `backend/src/middleware/requireSyncKey.ts` (new)

Express middleware that gates `POST /api/sync/cc` and `POST /api/admin/seed`.

**Behaviour:**
- Reads `SYNC_SECRET` from env at request time (not at module load), so tests
  can set/unset it within a test.
- If `SYNC_SECRET` is unset or empty → `503 { error: "Sync authorisation not
  configured" }` and `next()` is NOT called. Logs a `warn` via pino.
- Reads `X-Sync-Key` request header. If absent, empty, or an array → `401`.
- Compares header value to `SYNC_SECRET` using `timingSafeStringEqual`:
  pads both to `maxLen`, calls `crypto.timingSafeEqual`, then AND-checks
  `aBuf.length === bBuf.length`. Length-mismatched keys always return 401
  and never throw.
- Match → `next()`.

**Messages (intentionally generic):**
- 503: `"Sync authorisation not configured"`
- 401: `"Invalid or missing sync key"`

No secret value is echoed in any error body.

### `backend/src/routes/sync.ts` (updated)

`POST /cc` handler now: `router.post("/cc", requireSyncKey, async ...)`.
Comment documents the gate (module 12 / S6).

### `backend/src/routes/admin.ts` (updated)

`POST /seed` handler now: `router.post("/seed", requireSyncKey, async ...)`.
Comment documents the gate (module 12 / S6).

### `backend/.env.example` (updated)

Added:
```
# Required to enable CC sync (POST /api/sync/cc) and seed (POST /api/admin/seed).
# If unset, both routes refuse with 503 (fail-closed — never allows an unauthenticated CC write).
# Generate a strong random value for production: openssl rand -hex 32
SYNC_SECRET=
```

### `backend/src/__tests__/ccWriteAuthz.test.ts` (new)

18 tests:
- `POST /api/sync/cc`: no key → 401; wrong key → 401; empty key → 401;
  correct key → 200 + canned sync report; SYNC_SECRET unset → 503; empty
  SYNC_SECRET → 503.
- `POST /api/admin/seed`: no key → 401; wrong key → 401; correct key → 200 +
  canned seed report; SYNC_SECRET unset → 503; empty SYNC_SECRET → 503.
- Un-gated routes: GET /api/skus → 200; GET /api/progress → 200;
  POST /api/dims → 200; PUT /api/dims/7 → 200 — all without X-Sync-Key.
- Timing-safe edge cases: longer key → 401 (no throw); shorter key → 401
  (no throw); empty key with SYNC_SECRET set → 401 (no throw).

### `backend/src/__tests__/dimRoutes.test.ts` (updated)

`POST /api/sync/cc` test now sets `process.env.SYNC_SECRET` and sends
`X-Sync-Key` so it reaches the handler. Title updated to note auth gate satisfied.

### `backend/src/__tests__/skuRoutes.test.ts` (updated)

`POST /api/admin/seed` describe block gains a nested `beforeEach`/`afterEach`
that sets `process.env.SYNC_SECRET = "test-seed-secret"`. Both tests now send
`X-Sync-Key` so they exercise the service/error-mapping path. Import updated to
include `afterEach`.

## Public interface (new additions)

```typescript
// backend/src/middleware/requireSyncKey.ts

/**
 * Express middleware: gates the request behind SYNC_SECRET / X-Sync-Key.
 * 503 if SYNC_SECRET unset/empty. 401 if key missing/wrong. next() on match.
 */
export function requireSyncKey(req: Request, res: Response, next: NextFunction): void;
```

**Env var:** `SYNC_SECRET` — required in the environment for the two CC-write
routes to accept requests. Not required for any other route. Checked at
request time (not at startup), so the server boots fine without it and
surfaces the configuration error only when the routes are called.

## Routes gated

| Route | Gated | Key required |
|-------|-------|-------------|
| `POST /api/sync/cc` | YES | `X-Sync-Key: <SYNC_SECRET>` |
| `POST /api/admin/seed` | YES | `X-Sync-Key: <SYNC_SECRET>` |
| `GET /api/skus` | NO | — |
| `GET /api/skus/:barcode` | NO | — |
| `GET /api/progress` | NO | — |
| `GET /api/dims` | NO | — |
| `POST /api/dims` | NO | — |
| `PUT /api/dims/:id` | NO | — |
| `GET /api/health` | NO | — |

## Test status
- [x] Unit tests written: +18 (ccWriteAuthz.test.ts); dimRoutes (1 updated);
      skuRoutes (2 updated, afterEach added).
- [x] All tests passing: `npm test` → **134/134** (was 116/116; +18 new).
- [x] Typecheck clean: `npx tsc --noEmit` exit 0.

## Quirks / gotchas

- **SYNC_SECRET is checked at request time, not module load.** This is
  deliberate — it allows tests to set/unset the env var and keeps the server
  bootable without the secret configured. The operator will see a 503 and a
  server-side warning log on the first attempt, which is the correct fail-closed
  signal.
- **Timing-safe compare pads both buffers to `maxLen` before calling
  `timingSafeEqual`.** `timingSafeEqual` throws when buffers differ in length
  — padding ensures it never throws regardless of what the client sends. The
  length check (`aBuf.length === bBuf.length`) after the time-constant compare
  ensures length-mismatched inputs always return false.
- **Un-gated routes stay open on the LAN by design.** Read routes and
  `POST/PUT /api/dims` are intentionally unauthenticated — the capture flow
  runs on a LAN-only device and there is no user identity. The only routes that
  write to CartonCloud are gated.
- **Existing route tests that hit gated endpoints** (dimRoutes + skuRoutes)
  were updated to supply the key. Their purpose is testing handler/service
  behaviour, not the auth gate — the gate tests live in ccWriteAuthz.test.ts.

## In-flight work
None — module complete.

## New dependencies added
None (`crypto` is a Node built-in).

## Decisions made during this module's build (also in DECISIONS.md)
The binding decision was already recorded in DECISIONS.md (2026-06-08) before
building. No additional non-trivial decisions were made during implementation.
