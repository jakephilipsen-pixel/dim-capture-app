# State: cc-oauth-write

> Handoff record. Other modules load THIS FILE (not source) to know what this module exports.

## Status
🟨 Built — smoke green; pending adversarial review (parent will flip MODULES.md to ✅ + open PR).

## Branch
feature/cc-oauth-write

## Last touched
2026-06-24 — CC layer rewritten to the OAuth2/v8 recipe; 156 backend tests + tsc green;
`./scripts/smoke-module.sh cc-oauth-write` PASSED (real container + v8 mock CC).

## Public interface (the contract other modules see)

```typescript
// services/ccClient.ts
export const ccClient: CcClient;            // app-wide singleton (CcClient.fromEnv())
export class CcClient {
  static fromEnv(overrides?): CcClient;      // CC_CLIENT_ID/SECRET, CC_TENANT_ID, CC_BASE_URL, CC_CUSTOMER_ID
  listProducts(page: number, pageSize: number): Promise<CcProduct[]>;        // seed: v8 customer-scoped search page
  lookupByBarcode(barcode: string): Promise<CcProduct | null>;              // DB-miss fallback (bounded search)
  patchProductDims(productId: string, dims: CcDimPayload): Promise<DimWriteOutcome>;
}
export interface CcProduct { id; code: string|null... ; barcode: string|null; name; length|width|height|weight: number|null; }
export interface CcDimPayload { length; width; height; weight: number; } // app mm/kg in; converted mm→m at the boundary
export type DimWriteOutcome =
  | { status: "written"; uom: string }
  | { status: "noop"; uom: string }       // already correct in CC
  | { status: "blocked"; reason: string };// name-poison: CC would 422 the whole product
export const FORAGE_CUSTOMER_ID: string;
export const UOM_NAME_MIN = 3; export const UOM_NAME_MAX = 64;
export function isValidUomName(name: unknown): boolean;
export class CcApiError(statusCode) / CcRateLimitError / CcTimeoutError(504) / CcAuthError(401) / CcNotFoundError;

// services/syncService.ts
export interface SyncReport { synced; failed; blocked; pending: number; }   // + `blocked` (module 16)
export function syncUnsyncedDims(): Promise<SyncReport>;                     // batch-10, advisory lock, X-Sync-Key (unchanged)
```

## Exports / behaviour
- **Auth**: OAuth2 client_credentials → `POST {base}/uaa/oauth/token` (Basic base64(id:secret)),
  cached + refreshed 60s before expiry; data paths tenant-scoped `/tenants/{tenant}/…` Bearer; 401 → refresh+retry once.
- **Seed/lookup**: `POST /warehouse-products/search` v8, customer-scoped to Forage. `Sku.id` = warehouse-product
  id; `Sku.code` = `references.code`; `Sku.barcode` = default (or first) UoM barcode (nullable).
- **Write**: GET v8 → customer guard → name-poison guard → resolve `defaultUnitOfMeasure` → mm→m diff →
  JSON-Patch `op:add` on `/unitOfMeasures/{uom}/{field}` (changed fields only), `Content-Type: application/json-patch+json`,
  `Accept-Version: 8` → read-back verify (mismatch throws).
- **Sync**: blocked SKUs get `Dim.syncBlockedReason` set and are excluded from the retry/pending set; a re-capture
  (`dimService.saveDim`/`updateDim`) clears it.

## Internal structure
- `backend/src/services/ccClient.ts` — full rewrite (token mgr, search, write recipe, guards). Reuses the
  existing token-bucket limiter (sync=lookups+writes, seed=search pull), `AbortSignal.timeout`, typed errors, `mmToMetres`.
- `backend/src/services/syncService.ts` — write path swapped; `blocked` terminal state + report field.
- `backend/src/services/skuService.ts` — seed/lookup re-pointed; `SkuSummary`/`SkuDetail` gained `code`.
- `backend/src/services/dimService.ts` — clears `syncBlockedReason` on re-capture/correction; joined barcode nullable.
- `backend/prisma/schema.prisma` + migration `20260624020000_cc_oauth_warehouse_products` — `Sku.code`,
  nullable `Sku.barcode`, `Dim.syncBlockedReason` (additive).
- `backend/src/smoke/mockCc.ts` + `ccClientSmoke.ts` — rewritten to the v8 OAuth2/warehouse-products/json-patch contract.

## Quirks / gotchas
- CC unit is **metres** (mm→m ÷1000 via `mmToMetres`). NEVER cm/mm to CC.
- JSON-Patch `{uom}` path segment = the UoM **key** (e.g. "EA"), not the UUID.
- **Barcode lives on the UoM** (`unitOfMeasures.{uom}.barcode`), not top-level — seed reads it from there.
- Name-poison (a sibling UoM name <3 or >64 chars) 422s the WHOLE-product save → blocked, not retried.
- `getProgress().pendingSync` still counts blocked dims as not-synced (overview number); `SyncReport.pending`
  excludes them. Module 17 surfaces the blocked state to the operator.
- `lookupByBarcode` is a bounded customer-scoped search fallback; the seed populates the DB for the common path.
- Env changed: `CC_CLIENT_ID`/`CC_CLIENT_SECRET` (was `CC_API_KEY`); `CC_WAREHOUSE_ID` no longer used.

## Test status
- [x] Unit tests written (ccClient/ccClientListProducts/ccClientResilience/syncService/skuService updated)
- [x] Unit tests passing — 156/156 backend; `tsc --noEmit` clean
- [x] Integration with dependencies verified — `smoke-module.sh cc-oauth-write` PASSED (real container + v8 mock)

## In-flight / follow-ups
- 4 pre-existing lint errors in `writeConcurrency.test.ts` (non-null assertions; unchanged from main, NOT this module).
- Frontend `SyncStatus`/Review surfacing of `blocked` = module 17 `blocked-sku-feedback`.
- MODULES.md row still 🟨 (parent flips to ✅ after adversarial review + PR).

## Decisions made during this module's build
See DECISIONS.md 2026-06-24 entries (OAuth2 swap, warehouse-products re-point, blocked state, read-back verify).
