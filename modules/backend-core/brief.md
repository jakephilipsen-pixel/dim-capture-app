# Module: backend-core

## Purpose
Stand up the Express + TypeScript backend with Prisma ORM, PostgreSQL connection, and the two data models (Sku, Dim). This module is the foundation everything else runs on — it exports no business logic, only the DB client, typed models, middleware utilities, and a health endpoint.

## In scope
- `backend/` directory: `package.json`, `tsconfig.json`, `.env.example`
- Express app skeleton: `src/index.ts` wiring up middleware and router mounts (routes themselves return 501 — filled by later modules)
- Middleware: CORS (allow frontend origin), JSON body parser, request logger, centralised error handler (`AppError` class + Express error middleware)
- Prisma schema: `Sku` and `Dim` models exactly as specified (see spec at project root)
- Initial migration: `prisma/migrations/0001_init/`
- DB connection: `src/lib/db.ts` exporting singleton Prisma client
- Health endpoint: `GET /api/health` → `{ status: "ok", db: "connected" | "error" }`
- TypeScript strict mode + ESLint config

## Out of scope
- Actual route implementations (skus, dims, sync, admin/seed) — modules 02–04
- CartonCloud API client — module 02
- Frontend — modules 05–07
- Docker Compose — module 08

## Dependencies
None — this is the root module.

## Public interface (what this module exports)

```typescript
// src/lib/db.ts
export const prisma: PrismaClient

// src/lib/errors.ts
export class AppError extends Error {
  constructor(message: string, public statusCode: number) {}
}

// src/app.ts
export const app: Express  // used by tests
```

## Acceptance criteria
- [ ] `npm run dev` starts without errors, logs port 3005
- [ ] `GET /api/health` returns `200 { status: "ok", db: "connected" }` when DB is up
- [ ] `GET /api/health` returns `503 { status: "error", db: "error" }` when DB is unreachable
- [ ] `npx prisma migrate dev` runs clean from scratch
- [ ] TypeScript strict compiles with zero errors
- [ ] All stub route mounts return 501 Not Implemented
- [ ] Unit tests cover AppError class and error middleware

## Notes
Ports: backend 3005, postgres 5434 (dev Docker). Dev DB started via `docker compose -f docker-compose.local.yml up -d postgres`.

Prisma schema uses `String @id` for Sku.id (CartonCloud UUID, not autoincrement). Dim.skuId is `@unique` — one dim per SKU maximum.
