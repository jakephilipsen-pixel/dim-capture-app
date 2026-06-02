# State: backend-core

> This file is the handoff record between conversations. Keep it accurate. Other modules will load THIS FILE (not source) to understand what this module exports.

## Status
✅ Built — smoke passing (2026-06-03)

## Branch
`feature/backend-core`

## Last touched
2026-06-03 — verify-and-finish pass: fixed Prisma/Alpine OpenSSL, hardened smoke scripts, routed startup log through pino. Smoke green.

## Public interface (the contract other modules see)

```typescript
// src/lib/db.ts
export const prisma: PrismaClient;          // singleton — import this, do not `new PrismaClient()`

// src/lib/errors.ts
export class AppError extends Error {
  constructor(message: string, statusCode: number);
  readonly statusCode: number;
}

// src/middleware/errorHandler.ts
export function errorHandler(err, req, res, next): void;  // Express error middleware (mounted last)

// src/middleware/logger.ts
export const logger: pino.Logger;            // base app logger — use instead of console.*
export const requestLogger;                  // pino-http middleware (uses `logger`)

// src/app.ts
export const app: Express;                   // fully wired; imported by tests and index.ts
```

HTTP surface this module owns:
- `GET /api/health` → `200 { status: "ok", db: "connected" }` (DB reachable) / `503 { status: "error", db: "error" }` (DB down)
- Router mounts (stubs, owned by later modules): `/api/skus`, `/api/dims`, `/api/sync`, `/api/admin` — all return `501 { error: "Not implemented" }` until 02–04 fill them.

## Exports
- `prisma` — Prisma client singleton (models: `Sku`, `Dim`)
- `AppError` — typed error with `statusCode`; thrown by handlers, mapped by `errorHandler`
- `errorHandler` — centralised Express error middleware
- `logger`, `requestLogger` — pino logging
- `app` — the Express app (no `listen`; `index.ts` does that on `PORT`/3005)

## Data model (prisma/schema.prisma)
- `Sku { id: String @id (CC UUID), barcode @unique, name, ccDimsCaptured: Boolean, createdAt, dims: Dim? }`
- `Dim { id: Int autoinc, skuId @unique → Sku, lengthMm/widthMm/heightMm/weightKg: Float, measuredBy, measuredAt, syncedToCC: Boolean, syncedAt: DateTime?, notes: String? }`
- One dim per SKU (`Dim.skuId @unique`). Migration: `prisma/migrations/20260511063342_init/`.

## Internal structure
```
backend/
  src/index.ts            entrypoint — app.listen(PORT)
  src/app.ts              express wiring: cors, json, requestLogger, /api/health, router mounts, errorHandler
  src/lib/db.ts           prisma singleton
  src/lib/errors.ts       AppError
  src/middleware/         errorHandler.ts, logger.ts
  src/routes/             skus|dims|sync|admin .ts (501 stubs for 02–04)
  src/__tests__/          errors.test.ts, errorHandler.test.ts (vitest)
  prisma/schema.prisma + migrations/
  Dockerfile              multi-stage; runner CMD = `prisma migrate deploy && node dist/index.js`
```

## Quirks / gotchas (read before touching modules 02–04)
- **Prisma on node:22-alpine needs OpenSSL + the musl engine target.** Without it the schema/query
  engine fails to load (`Could not parse schema engine response`) and `migrate deploy` crashes,
  so nothing listens. Fix already in place: `schema.prisma` generator
  `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]` **and** `apk add --no-cache openssl`
  in every Dockerfile stage that runs a prisma command. **Reuse this for 02/03/04 — same container.**
- **Health endpoint uses `SELECT 1`** — it proves connectivity, not schema. It returns `ok` even on
  an unmigrated DB; the container CMD runs `migrate deploy` before serving so that's moot in prod.
- **Smoke `curl` rules:** `healthcheck.sh` polls with `curl -sf` (retry until 200 — correct for
  readiness). `happy-path.sh` asserts status codes incl. 501, so it uses `curl -s` (NO `-f`, which
  would make curl exit non-zero on 501 and kill the script under `set -e`).
- **Harness boot-wait is loose:** `scripts/smoke-module.sh` prints "Stack running after 0s" because
  it only waits for *any* container to be `running` (Postgres, instantly). The module's polling
  `healthcheck.sh` compensates. Not fixed here (shared script, out of module scope).
- Dev DB: `docker compose -f docker-compose.local.yml up -d postgres` (host port 5434).
  `DATABASE_URL=postgresql://gocold:gocold@localhost:5434/dimcapture`. Backend port 3005.

## Test status
- [x] Unit tests written (AppError, errorHandler) — 7 tests
- [x] Unit tests passing (`npm test` → 7/7)
- [x] Typecheck clean (`tsc --noEmit` exit 0), lint clean
- [x] Smoke written + passing (`./scripts/smoke-module.sh backend-core` exit 0): health=connected, all stubs 501
- [x] `prisma migrate deploy` runs clean on a fresh Postgres (proven in smoke container)
- Note: the 503/db-down branch is implemented (`app.ts`) but not exercised by smoke (happy-path only).

## In-flight work
None — module complete.

## Decisions made during this module's build
- 2026-06-03 | Prisma generator `binaryTargets += linux-musl-openssl-3.0.x` + `apk add openssl` in Dockerfile | Prisma engine fails to load on node:22-alpine otherwise | (also added to DECISIONS.md)
