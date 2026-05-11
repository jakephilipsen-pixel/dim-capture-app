# Module: cc-client

## Purpose
Build the CartonCloud API client used by all CC-facing backend operations. Implements a token-bucket rate limiter (60 req/min), product lookup by barcode, and the PATCH call to push captured dimensions back to CC. This client is a pure service — it has no Express routes; it's imported by sku-seed and dim-api.

## In scope
- `backend/src/services/ccClient.ts` — the CC API client class/module
- Token-bucket rate limiter (60 req/min, rejects with typed error when bucket empty)
- `lookupByBarcode(barcode: string, warehouseId: string): Promise<CcProduct | null>` — `GET /products?barcode=&warehouseAccountId=`
- `patchProductDims(productId: string, dims: CcDimPayload): Promise<void>` — `PATCH /products/{productId}`
- Typed error classes: `CcRateLimitError`, `CcApiError`, `CcNotFoundError`
- Unit tests with mocked HTTP (no real CC calls in tests)
- Auth via `CC_API_KEY` env var (Bearer token), tenant via `CC_TENANT_ID`

## Out of scope
- Pagination of product lists — that's sku-seed's responsibility
- Any Express routes — this is a service only
- Sync batching logic — dim-api

## Dependencies
- `backend-core` — uses `AppError` base class, `prisma` (not directly, but needs the env setup)

## Public interface (what this module exports)

```typescript
// src/services/ccClient.ts
export interface CcProduct {
  id: string
  barcode: string
  name: string
  length: number | null
  width: number | null
  height: number | null
  weight: number | null
}

export interface CcDimPayload {
  length: number  // mm
  width: number   // mm
  height: number  // mm
  weight: number  // kg
}

export class CcRateLimitError extends Error {}
export class CcApiError extends Error { constructor(msg: string, public statusCode: number) {} }
export class CcNotFoundError extends Error {}

export class CcClient {
  lookupByBarcode(barcode: string, warehouseId: string): Promise<CcProduct | null>
  patchProductDims(productId: string, dims: CcDimPayload): Promise<void>
}

export const ccClient: CcClient  // singleton instance
```

## Acceptance criteria
- [ ] `lookupByBarcode` returns a `CcProduct` for a known barcode (mocked test)
- [ ] `lookupByBarcode` returns `null` for a barcode CC doesn't know (404 response)
- [ ] `patchProductDims` calls `PATCH /products/:id` with correct body and headers
- [ ] Rate limiter rejects requests past 60/min with `CcRateLimitError`
- [ ] `CcApiError` is thrown for non-404 CC error responses (includes status code)
- [ ] All unit tests pass with mocked HTTP — no real CC calls
- [ ] TypeScript strict compiles with zero errors

## Notes
CC base URL: `https://app.cartoncloud.com.au/api/v1`. Auth header: `Authorization: Bearer ${CC_API_KEY}`. The `CC_TENANT_ID` env var may need to be sent as a query param or header depending on the CC API — check the spec. CC expects mm for dims, kg for weight — do NOT convert here; callers are responsible.

Use `node-fetch` or native `fetch` (Node 18+). Do not use axios.
