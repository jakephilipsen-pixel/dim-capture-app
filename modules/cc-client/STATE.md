# State: cc-client

> This file is the handoff record between conversations. Keep it accurate. Other modules will load THIS FILE (not source) to understand what this module exports.

## Status
✅ Built — smoke passing (2026-06-03)

## Branch
`feature/cc-client`

## Last touched
2026-06-03 — built from scratch on top of merged backend-core. CcClient + token-bucket limiter + typed errors, 13 unit tests (mocked fetch), containerised smoke against an in-container mock CC. tsc + lint clean, 20/20 tests, smoke green.

## Public interface (the contract other modules see)

```typescript
// src/services/ccClient.ts

export interface CcProduct {
  id: string;
  barcode: string;
  name: string;
  length: number | null;   // mm — null if CC has no dims yet
  width: number | null;    // mm
  height: number | null;   // mm
  weight: number | null;   // kg
}

export interface CcDimPayload {
  length: number;  // mm  — passed through verbatim, NO conversion
  width: number;   // mm
  height: number;  // mm
  weight: number;  // kg
}

export class CcRateLimitError extends Error {}              // name: "CcRateLimitError"
export class CcApiError extends Error {                     // name: "CcApiError"
  readonly statusCode: number;
}
export class CcNotFoundError extends Error {}               // name: "CcNotFoundError"

export class CcClient {
  constructor(opts: CcClientOptions);
  static fromEnv(overrides?: Partial<CcClientOptions>): CcClient;
  lookupByBarcode(barcode: string, warehouseId: string): Promise<CcProduct | null>;
  patchProductDims(productId: string, dims: CcDimPayload): Promise<void>;
}

export interface CcClientOptions {
  apiKey: string;
  tenantId: string;
  baseUrl?: string;        // default CC_DEFAULT_BASE_URL
  capacity?: number;       // token-bucket capacity, default 60
  refillPerSec?: number;   // default 1 (→ 60/min)
  fetchImpl?: typeof fetch; // default global fetch — inject a mock in tests
  now?: () => number;       // default Date.now — inject for deterministic rate-limit tests
}

export const CC_DEFAULT_BASE_URL = "https://app.cartoncloud.com.au/api/v1";

// App-wide singleton, built from env. IMPORT THIS — do not `new CcClient()` per call.
export const ccClient: CcClient;
```

HTTP surface this module owns: **none.** It is a pure service, imported by
sku-seed (03) and dim-api (04). No Express routes.

## How to use (for modules 03 / 04)

```typescript
import { ccClient, CcNotFoundError, CcRateLimitError } from "../services/ccClient";

const product = await ccClient.lookupByBarcode(barcode, process.env.CC_WAREHOUSE_ID!);
if (product === null) { /* CC doesn't know this barcode */ }

await ccClient.patchProductDims(product.id, { length, width, height, weight }); // mm / kg
```

- `lookupByBarcode` → `CcProduct` on hit, `null` on miss (CC 404 OR empty result set).
- `patchProductDims` → resolves on success; throws `CcNotFoundError` (404) or `CcApiError` (other non-2xx).
- Any call may throw `CcRateLimitError` (bucket empty) or `CcApiError(500)` if creds unset.
- The singleton reads `CC_API_KEY` / `CC_TENANT_ID` / `CC_BASE_URL` at import; missing
  creds do NOT throw at import — they surface as `CcApiError(500)` on first call.

## Behaviour / contract details

- **Auth:** `Authorization: Bearer ${CC_API_KEY}` on every request.
- **Tenant:** sent as `X-Tenant-Id: ${CC_TENANT_ID}` header (DECISIONS.md 2026-06-03). Paths
  are un-prefixed (`/products`, `/products/{id}`) per the spec.
- **Version:** `Accept-Version: 1` header on every request.
- **Endpoints:**
  - `GET  /products?barcode={barcode}&warehouseAccountId={warehouseId}`
  - `PATCH /products/{productId}` body `{ length, width, height, weight }`
- **List parsing:** `lookupByBarcode` accepts a bare array, `{ data: [...] }`, or
  `{ products: [...] }`; takes the first match. String-encoded numbers are coerced.
- **Units:** mm for L/W/H, kg for weight — passed through verbatim. Callers own conversion.
- **Rate limiter:** in-memory token bucket, 60 tokens, refills 1/sec, capped at 60.
  *Rejects* (does not queue) with `CcRateLimitError` when empty. The token is consumed
  BEFORE the HTTP call, so a rejected request never hits the network.

## Env vars
- `CC_API_KEY` (required at call time) — Bearer token
- `CC_TENANT_ID` (required at call time) — sent as `X-Tenant-Id`
- `CC_BASE_URL` (optional) — overrides the default base; used by tests/smoke
- `CC_WAREHOUSE_ID` — NOT read by this module; callers pass it to `lookupByBarcode`

## Internal structure
```
backend/src/
  services/ccClient.ts          the client (production)
  smoke/ccClientSmoke.ts        DEV/SMOKE ONLY entry — never run by prod CMD
  __tests__/ccClient.test.ts    13 vitest tests, mocked fetch
modules/cc-client/
  docker-compose.smoke.yml      builds backend image, runs the smoke server (host port 3007)
  smoke/healthcheck.sh          polls /smoke/health
  smoke/happy-path.sh           lookup/patch/404/rate-limit round trips vs in-container mock CC
```

## Quirks / gotchas
- **The smoke harness assumes HTTP endpoints; cc-client has none.** Smoke therefore boots a
  dev-only `dist/smoke/ccClientSmoke.js` in the real backend image, which stands up an
  in-container mock CC (port 9099, not published) and a debug surface on port 3007. The
  prod CMD (`prisma migrate deploy && node dist/index.js`) never runs the smoke server.
- **Host port 3007** for smoke — `3006` is taken by an unrelated project on Jake's laptop.
- **Rate-limit tests use an injected `now()`** (frozen/advanced clock) — no fake timers, no
  real sleeps. Reuse this pattern for deterministic time-based tests in 03/04.
- **Auth/base-URL diverges from the parent gocold-wms-flow client** (which uses OAuth2 on
  `api.cartoncloud.com`). We follow the dim-capture spec (Bearer on `app.cartoncloud.com.au/api/v1`).
  If real CC integration 401s later, this is the first place to check. See DECISIONS.md.
- No real CartonCloud call is made anywhere in tests or smoke.

## Test status
- [x] Unit tests written — 13 (lookup hit/miss/404/envelope/headers/api-error, patch ok/encode/404/api-error, rate-limit reject+refill, unconfigured guard)
- [x] Unit tests passing (`npm test` → 20/20 incl. backend-core's 7)
- [x] Typecheck clean (`tsc --noEmit` exit 0), lint clean (`npm run lint` exit 0)
- [x] Smoke written + passing (`./scripts/smoke-module.sh cc-client` exit 0): health ok, lookup hit/miss, patch round trip, CcNotFoundError, CcRateLimitError. Clean teardown, no orphans.

## In-flight work
None — module complete.

## Decisions made during this module's build (also in DECISIONS.md)
- 2026-06-03 | Follow spec auth (Bearer `CC_API_KEY` on `app.cartoncloud.com.au/api/v1`), not the parent OAuth client | spec wins over briefs/precedent | RISK flagged
- 2026-06-03 | Tenant via `X-Tenant-Id` header, paths un-prefixed | spec silent on transmission; least-surprising default
- 2026-06-03 | `Accept-Version: 1` on all requests | matches parent baseline; spec silent
- 2026-06-03 | Service-only modules smoke via a dev-only `dist/smoke/*.js` entry in the real image vs an in-container mock | the smoke harness assumes HTTP; route-less services have none
