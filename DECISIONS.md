# Architectural Decisions

Append-only log of decisions made during planning and module builds. Once written, decisions are binding for all future work on this project unless explicitly revisited.

Format: `YYYY-MM-DD | Decision | Rationale | Made during`

## Decisions

| Date | Decision | Rationale | Context |
|------|----------|-----------|---------|
| 2026-05-11 | Stack: React 19 + TS + Vite + Tailwind + shadcn/ui / Node Express + TS / PostgreSQL 16 + Prisma / Docker Compose | Project default | Initial scaffold |
| 2026-05-11 | Deployment: NUC via Docker Compose + Caddy at dim-capture-app.rolodex-ai.com | Project default | Initial scaffold |
| 2026-06-03 | Prisma generator `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]` + `apk add --no-cache openssl` in every Dockerfile stage that runs prisma | On node:22-alpine the Prisma schema/query engine defaults to libssl-1.1 and fails to load ("Could not parse schema engine response"), crashing `migrate deploy` so the server never starts | backend-core build — applies to all backend modules (02–04) sharing this container |
| 2026-06-03 | cc-client follows the dim-capture spec's auth model (Bearer `CC_API_KEY` on `https://app.cartoncloud.com.au/api/v1`), NOT the parent gocold-wms-flow client's OAuth2/`api.cartoncloud.com` model | Framework rule: spec wins over briefs/precedent. Base URL overridable via `CC_BASE_URL`. RISK: the parent OAuth client is what actually talks to CC in prod today — if real CC integration 401s, revisit this. | cc-client build |
| 2026-06-03 | CC tenant sent as `X-Tenant-Id: <CC_TENANT_ID>` header on every request; paths stay un-prefixed (`/products`, `/products/{id}`) per the spec's literal endpoints | Spec lists CC_TENANT_ID as env but never specifies transmission; header keeps the spec's endpoint shapes intact and is the least-surprising default | cc-client build |
| 2026-06-03 | `Accept-Version: 1` header on all cc-client requests | Matches the parent client's baseline; spec is silent. Products supports v8 for newer schema but v1 is the safe default for barcode lookup + dim PATCH | cc-client build |
| 2026-06-03 | Service-only modules smoke via a dev-only entry (`dist/smoke/*.js`) booted in the real backend image against an in-container HTTP mock — never invoked by the prod CMD | The smoke harness (`smoke-module.sh`) assumes HTTP health/happy-path curls; route-less services have no surface. This proves the module runs in the real container with zero real upstream calls. | cc-client build — pattern reusable for future service-only modules |
| 2026-06-03 | `GET /api/progress` is mounted **top-level** (`/api/progress`), not under `/api/admin` where backend-core stubbed it. Added `routes/progress.ts` + an `app.ts` mount; removed the admin `/progress` stub | Spec (line 135) and the sku-seed brief both specify `/api/progress`; framework rule says spec wins over a stub. Frontend (05/07) must call `/api/progress`. Confirmed with Jake before building. | sku-seed build |
| 2026-06-03 | `ccClient.listProducts(warehouseId, page, pageSize)` added to the cc-client service during the sku-seed build (cc-client STATE.md extended) | The sku-seed brief anticipated the seed pull needing a paginated list method that cc-client didn't yet have; adding it to the existing client (vs a new HTTP layer) keeps all CC access, auth, and rate-limiting in one place | sku-seed build |
| 2026-06-03 | Route handlers stay thin; all SKU logic lives in `services/skuService.ts`. `zod` validates request params; `supertest` (dev) covers routing/validation/error-mapping | Keeps business logic unit-testable with mocked Prisma + ccClient; supertest verifies AppError→HTTP status mapping through the real app without a DB/CC | sku-seed build |

## How to add a decision
When working on a module and a non-trivial choice comes up (library, pattern, schema shape, naming convention that will repeat), append a row here before continuing. This prevents re-litigating the same question in every future module conversation.
