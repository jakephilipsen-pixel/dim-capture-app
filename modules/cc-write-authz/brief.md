# Module 12: cc-write-authz

## What this module does

Implements the CC-write authorisation gate (S6 from STRESS_TEST_RESULTS.md).

`POST /api/sync/cc` and `POST /api/admin/seed` are the only routes that write
to CartonCloud in production. In the stress test these routes were completely
unauthenticated, directly conflicting with CLAUDE.md's "never push to CC
automatically — human approval gate" requirement.

This module adds a shared-secret header gate: the caller must send
`X-Sync-Key: <SYNC_SECRET>` on every request. The gate runs as Express
middleware mounted directly on the two handlers — no other routes are affected.

## Scope

**In scope:**
- `backend/src/middleware/requireSyncKey.ts` — the gate middleware
- Mount on `POST /api/sync/cc` and `POST /api/admin/seed` only
- `.env.example` — `SYNC_SECRET=` entry with generation instructions
- Tests covering: no key → 401, wrong key → 401, correct key → pass, unset
  secret → 503 fail-closed; un-gated routes (GET /api/skus, GET /api/progress,
  POST/PUT /api/dims) still work without any key

**Out of scope:**
- Session tokens, OAuth2, API key rotation (a shared secret is the decided
  mechanism — see DECISIONS.md 2026-06-08)
- Gating read routes — deliberate; read routes stay open on the LAN
- Rate limiting on the gate itself (that's a future hardening concern)

## Acceptance criteria

1. `POST /api/sync/cc` and `POST /api/admin/seed` return 401 if `X-Sync-Key`
   is absent, empty, or wrong.
2. Both routes return 503 (fail-closed) if `SYNC_SECRET` is unset or empty in
   the environment — even when a header is present.
3. Correct key → request reaches the handler; 200/expected body returned.
4. `GET /api/skus`, `GET /api/progress`, `POST /api/dims`, `PUT /api/dims/:id`
   — all return their normal status without any `X-Sync-Key`.
5. The comparison is timing-safe (`crypto.timingSafeEqual`); length-mismatched
   keys do not throw.
6. Error messages are generic — no secret value or internal detail in the body.
7. Server-side warning logged when SYNC_SECRET is unset.
8. `npx tsc --noEmit` clean; `npm test` green.
