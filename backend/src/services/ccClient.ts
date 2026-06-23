/**
 * CartonCloud API client.
 *
 * Pure service — no Express routes. Imported by sku-seed (03) and dim-api (04).
 *
 * Auth model (per dim-capture-app-spec.md, which wins over the parent
 * gocold-wms-flow client): Bearer `CC_API_KEY` against
 * `https://app.cartoncloud.com.au/api/v1`. Tenant is sent as the
 * `X-Tenant-Id` header on every request (see DECISIONS.md, 2026-06-03).
 *
 * Rate limiting (module 10 cc-resilience):
 *   Two separate token buckets guard outbound calls:
 *   - syncBucket: guards lookupByBarcode + patchProductDims (user lookups + syncs).
 *   - seedBucket: guards listProducts (admin seed pulls).
 *   Burst capacity: sync=40, seed=20 → combined burst = 60, within CC's 60 req/min ceiling.
 *   Sustained refill: sync=40/60 ≈ 0.6667/sec, seed=20/60 ≈ 0.3333/sec → combined sustained
 *   = 1 token/sec = 60/min, exactly at CC's ceiling. Both buckets reject (do not queue) with
 *   `CcRateLimitError` when empty.
 *
 * Fetch timeouts (module 10 cc-resilience):
 *   Every fetch call receives an `AbortSignal.timeout(timeoutMs)`. A timed-out
 *   or aborted fetch rejects with a DOMException; that is caught and converted to
 *   `CcTimeoutError extends CcApiError` (statusCode 504). The raw DOMException
 *   never escapes to callers.
 *
 * Units: callers pass dims in the app's canonical mm + kg. CartonCloud stores
 * carton L/W/H in METRES, so `patchProductDims` converts mm→m (÷1000) at the
 * write boundary; weight (kg) is unchanged.
 */
import { logger } from "../middleware/logger";

const log = logger.child({ module: "ccClient" });

/** Default CC REST base. Overridable via `CC_BASE_URL` (tests/smoke point at a mock). */
export const CC_DEFAULT_BASE_URL = "https://app.cartoncloud.com.au/api/v1";

/** CC API schema version sent on every request. */
const CC_ACCEPT_VERSION = "1";

/**
 * Default fetch timeout in milliseconds. Overridable via `CC_TIMEOUT_MS`.
 * 12 000 ms gives CC a full 12 s to respond, well above typical latency but
 * short enough to prevent an indefinite hang on `POST /api/sync/cc` (S4).
 */
export const CC_DEFAULT_TIMEOUT_MS = 12_000;

/**
 * Default token-budget split between the sync path and the seed path.
 * seed + sync MUST NOT exceed CC's 60 req/min tenant ceiling.
 * seed=20: admin seed pulls are infrequent; 20/min is ample for a ~400-SKU paginated pull.
 * sync=40: the critical sync+lookup path gets the larger share.
 *
 * Burst capacities: sync=40, seed=20 → combined burst = 60 (CC ceiling).
 * Sustained refill rates: sync=40/60/sec, seed=20/60/sec → combined sustained
 * = (40+20)/60 = 1 token/sec = 60/min (exactly CC's ceiling, never exceeds it).
 */
export const CC_DEFAULT_SYNC_CAPACITY = 40;
export const CC_DEFAULT_SEED_CAPACITY = 20;
/** Sustained refill rate for syncBucket: 40 tokens/min = 40/60 tokens/sec ≈ 0.6667/sec. */
export const CC_DEFAULT_SYNC_REFILL_PER_SEC = 40 / 60;
/** Sustained refill rate for seedBucket: 20 tokens/min = 20/60 tokens/sec ≈ 0.3333/sec. */
export const CC_DEFAULT_SEED_REFILL_PER_SEC = 20 / 60;

/** A CartonCloud product as this app cares about it. Dims/weight are nullable
 *  because a product may have no dimensions captured in CC yet. */
export interface CcProduct {
  id: string;
  barcode: string;
  name: string;
  length: number | null;
  width: number | null;
  height: number | null;
  weight: number | null;
}

/**
 * Dimension payload pushed to CC. Callers pass the app's canonical **mm** for
 * L/W/H and **kg** for weight; `patchProductDims` converts mm→m at the CC
 * boundary (CartonCloud stores carton dims in metres).
 */
export interface CcDimPayload {
  length: number;
  width: number;
  height: number;
  weight: number;
}

/** Millimetres per metre — the mm→m factor for the CC write boundary. */
const MM_PER_METRE = 1000;

/** Convert a millimetre length to metres (CC's unit), rounded to 4 dp to kill FP noise. */
function mmToMetres(mm: number): number {
  return Math.round((mm / MM_PER_METRE) * 10000) / 10000;
}

/** Raised when the rate-limit bucket is empty — the request is NOT sent. */
export class CcRateLimitError extends Error {
  constructor(message = "CartonCloud rate limit exceeded (60 req/min)") {
    super(message);
    this.name = "CcRateLimitError";
    Object.setPrototypeOf(this, CcRateLimitError.prototype);
  }
}

/** Raised for any non-404 CC error response. Carries the HTTP status. */
export class CcApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "CcApiError";
    Object.setPrototypeOf(this, CcApiError.prototype);
  }
}

/**
 * Raised when a CC fetch is aborted by `AbortSignal.timeout()` or any
 * AbortSignal (S4 fix). Extends `CcApiError` with `statusCode: 504` so
 * callers that handle `CcApiError` generically also handle timeouts without
 * changes, while callers that need to distinguish timeouts can `instanceof
 * CcTimeoutError`. The raw DOMException is never exposed to callers.
 */
export class CcTimeoutError extends CcApiError {
  constructor(message = "CartonCloud request timed out") {
    super(message, 504);
    this.name = "CcTimeoutError";
    Object.setPrototypeOf(this, CcTimeoutError.prototype);
  }
}

/** Raised when a PATCH targets a product id CC doesn't know (404). */
export class CcNotFoundError extends Error {
  constructor(message = "CartonCloud product not found") {
    super(message);
    this.name = "CcNotFoundError";
    Object.setPrototypeOf(this, CcNotFoundError.prototype);
  }
}

/** Injectable so tests/smoke can supply a fake fetch + deterministic clock. */
export interface CcClientOptions {
  apiKey: string;
  tenantId: string;
  baseUrl?: string;
  /**
   * Sync-path token-bucket capacity (lookupByBarcode + patchProductDims).
   * Default 40. Combined with seedCapacity MUST NOT exceed 60 (CC tenant limit).
   */
  syncCapacity?: number;
  /**
   * Sync-path tokens refilled per second.
   * Default CC_DEFAULT_SYNC_REFILL_PER_SEC (40/60 ≈ 0.6667/sec → 40/min sustained).
   * Combined with seedRefillPerSec, default sustained rate = 60/min ≤ CC ceiling.
   */
  syncRefillPerSec?: number;
  /**
   * Seed-path token-bucket capacity (listProducts).
   * Default 20. Combined with syncCapacity MUST NOT exceed 60 (CC tenant limit).
   */
  seedCapacity?: number;
  /**
   * Seed-path tokens refilled per second.
   * Default CC_DEFAULT_SEED_REFILL_PER_SEC (20/60 ≈ 0.3333/sec → 20/min sustained).
   * Combined with syncRefillPerSec, default sustained rate = 60/min ≤ CC ceiling.
   */
  seedRefillPerSec?: number;
  /**
   * @deprecated Use syncCapacity instead. Kept for backwards compatibility with
   * existing tests that pass `capacity` — treated as syncCapacity when provided
   * without syncCapacity (so old tests pass unchanged).
   * @internal
   */
  capacity?: number;
  /** @deprecated Use syncRefillPerSec. @internal */
  refillPerSec?: number;
  /** Fetch timeout in milliseconds. Default CC_DEFAULT_TIMEOUT_MS (12 000). */
  timeoutMs?: number;
  /** Defaults to global `fetch` (Node 22). */
  fetchImpl?: typeof fetch;
  /** Monotonic clock in ms. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * In-memory token bucket. Refills continuously at `refillPerSec`, capped at
 * `capacity`. `take()` consumes one token if available, else returns false —
 * the caller turns that into a `CcRateLimitError`.
 */
class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    private readonly now: () => number,
  ) {
    this.tokens = capacity;
    this.lastRefill = now();
  }

  private refill(): void {
    const t = this.now();
    const elapsedSec = (t - this.lastRefill) / 1000;
    if (elapsedSec <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
    this.lastRefill = t;
  }

  take(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

/**
 * Maps a raw CC product object to our `CcProduct`. Tolerant of missing dim
 * fields (→ null) since most products start without dimensions. A numeric
 * coercion is applied so string-encoded numbers from CC still land as numbers.
 */
function toCcProduct(raw: Record<string, unknown>): CcProduct {
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    id: String(raw.id ?? ""),
    barcode: String(raw.barcode ?? ""),
    name: String(raw.name ?? ""),
    length: num(raw.length),
    width: num(raw.width),
    height: num(raw.height),
    weight: num(raw.weight),
  };
}

/**
 * Extracts the product list from a CC `/products` response. CC list endpoints
 * may return a bare array or wrap it in `{ data: [...] }` / `{ products: [...] }`;
 * we accept all three and ignore anything else.
 */
function extractProducts(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data as Record<string, unknown>[];
    if (Array.isArray(obj.products)) return obj.products as Record<string, unknown>[];
  }
  return [];
}

export class CcClient {
  private readonly apiKey: string;
  private readonly tenantId: string;
  private readonly baseUrl: string;
  private readonly syncBucket: TokenBucket;
  private readonly seedBucket: TokenBucket;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: CcClientOptions) {
    this.apiKey = opts.apiKey;
    this.tenantId = opts.tenantId;
    this.baseUrl = (opts.baseUrl ?? CC_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? Number(process.env.CC_TIMEOUT_MS ?? CC_DEFAULT_TIMEOUT_MS);

    const clockFn = opts.now ?? Date.now;

    // Backwards-compat: if the deprecated `capacity`/`refillPerSec` are present
    // and the new per-path options are absent, apply capacity to the sync bucket
    // (the original meaning) and leave the seed bucket at its default.
    // This keeps all pre-module-10 tests passing without modification.
    const syncCap =
      opts.syncCapacity ?? (opts.capacity !== undefined ? opts.capacity : CC_DEFAULT_SYNC_CAPACITY);
    // Default: 40/60/sec so sustained sync throughput = 40/min.
    // Backwards-compat: deprecated `refillPerSec` still maps to the sync bucket.
    const syncRefill = opts.syncRefillPerSec ?? opts.refillPerSec ?? CC_DEFAULT_SYNC_REFILL_PER_SEC;
    const seedCap = opts.seedCapacity ?? CC_DEFAULT_SEED_CAPACITY;
    // Default: 20/60/sec so sustained seed throughput = 20/min.
    // Combined sustained = (40+20)/60 = 1/sec = 60/min ≤ CC tenant ceiling.
    const seedRefill = opts.seedRefillPerSec ?? CC_DEFAULT_SEED_REFILL_PER_SEC;

    this.syncBucket = new TokenBucket(syncCap, syncRefill, clockFn);
    this.seedBucket = new TokenBucket(seedCap, seedRefill, clockFn);
  }

  /** Build from `CC_*` env vars. Does not throw on missing creds at construction
   *  (the singleton is imported app-wide); missing creds surface on first call. */
  static fromEnv(overrides: Partial<CcClientOptions> = {}): CcClient {
    return new CcClient({
      apiKey: process.env.CC_API_KEY ?? "",
      tenantId: process.env.CC_TENANT_ID ?? "",
      baseUrl: process.env.CC_BASE_URL ?? CC_DEFAULT_BASE_URL,
      ...overrides,
    });
  }

  private headers(json: boolean): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Accept-Version": CC_ACCEPT_VERSION,
      "X-Tenant-Id": this.tenantId,
      Accept: "application/json",
    };
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  /**
   * Consume a token from the appropriate bucket or throw CcRateLimitError.
   * Also guards against an unconfigured client.
   *
   * @param path - "sync" (lookupByBarcode + patchProductDims) or "seed" (listProducts).
   */
  private guard(path: "sync" | "seed"): void {
    if (!this.apiKey || !this.tenantId) {
      throw new CcApiError(
        "CartonCloud client not configured (CC_API_KEY / CC_TENANT_ID missing)",
        500,
      );
    }
    const bucket = path === "seed" ? this.seedBucket : this.syncBucket;
    if (!bucket.take()) {
      log.warn({ path }, "rate limit bucket empty — rejecting request");
      throw new CcRateLimitError();
    }
  }

  /**
   * Convert an AbortError or TimeoutError DOMException thrown by a timed-out
   * fetch into a CcTimeoutError. Any other error is re-thrown as-is.
   * This is called in every fetch catch block (S4 fix).
   */
  private handleFetchError(err: unknown): never {
    if (
      err instanceof DOMException &&
      (err.name === "AbortError" || err.name === "TimeoutError")
    ) {
      log.warn("CartonCloud request timed out or was aborted");
      throw new CcTimeoutError();
    }
    throw err;
  }

  /**
   * Look up a product by barcode within a warehouse account.
   * `GET /products?barcode={barcode}&warehouseAccountId={warehouseId}`.
   * Returns the first match, or `null` if CC has no such product (empty
   * result or 404). Throws `CcApiError` on any other non-2xx response.
   */
  async lookupByBarcode(barcode: string, warehouseId: string): Promise<CcProduct | null> {
    this.guard("sync");
    const url = new URL(`${this.baseUrl}/products`);
    url.searchParams.set("barcode", barcode);
    url.searchParams.set("warehouseAccountId", warehouseId);

    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        method: "GET",
        headers: this.headers(false),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      this.handleFetchError(err);
    }

    if (res.status === 404) return null;
    if (!res.ok) {
      throw new CcApiError(
        `lookupByBarcode failed for "${barcode}": ${res.status} ${await safeText(res)}`,
        res.status,
      );
    }

    const products = extractProducts(await res.json());
    if (products.length === 0) return null;
    return toCcProduct(products[0]);
  }

  /**
   * List products for a warehouse account, one page at a time.
   * `GET /products?warehouseAccountId={warehouseId}&page={page}&pageSize={pageSize}`.
   * Returns the page's products (possibly empty). Callers paginate by
   * incrementing `page` until a page returns fewer than `pageSize` items.
   * Throws `CcApiError` on any non-2xx response.
   *
   * Added in the sku-seed module (03) for the admin seed pull.
   */
  async listProducts(
    warehouseId: string,
    page: number,
    pageSize: number,
  ): Promise<CcProduct[]> {
    this.guard("seed");
    const url = new URL(`${this.baseUrl}/products`);
    url.searchParams.set("warehouseAccountId", warehouseId);
    url.searchParams.set("page", String(page));
    url.searchParams.set("pageSize", String(pageSize));

    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        method: "GET",
        headers: this.headers(false),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      this.handleFetchError(err);
    }

    // A 404 on the list endpoint means "no such page" — treat as the end of
    // the result set (empty page) rather than an error.
    if (res.status === 404) return [];
    if (!res.ok) {
      throw new CcApiError(
        `listProducts failed (warehouse ${warehouseId}, page ${page}): ${res.status} ${await safeText(res)}`,
        res.status,
      );
    }

    return extractProducts(await res.json()).map(toCcProduct);
  }

  /**
   * Push captured dimensions to a CC product.
   * `PATCH /products/{productId}` with `{ length, width, height, weight }`.
   *
   * UNITS: callers pass `CcDimPayload` in the app's canonical **mm / kg** (the DB
   * unit). CartonCloud stores carton L/W/H in **metres**, so we convert
   * mm→m (÷1000) here at the CC boundary; weight (kg) is sent unchanged
   * (Jake confirmed metres against CC, 24 Jun 2026 — supersedes the earlier
   * "cm" read). Converting in this one method keeps every sync path correct.
   *
   * Throws `CcNotFoundError` on 404, `CcApiError` on any other non-2xx response.
   */
  async patchProductDims(productId: string, dims: CcDimPayload): Promise<void> {
    this.guard("sync");
    const url = `${this.baseUrl}/products/${encodeURIComponent(productId)}`;

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "PATCH",
        headers: this.headers(true),
        body: JSON.stringify({
          length: mmToMetres(dims.length),
          width: mmToMetres(dims.width),
          height: mmToMetres(dims.height),
          weight: dims.weight,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      this.handleFetchError(err);
    }

    if (res.status === 404) {
      throw new CcNotFoundError(`product ${productId} not found in CartonCloud`);
    }
    if (!res.ok) {
      throw new CcApiError(
        `patchProductDims failed for ${productId}: ${res.status} ${await safeText(res)}`,
        res.status,
      );
    }
    log.info({ productId }, "patched product dims in CartonCloud");
  }
}

/** Read a response body as text without throwing (used only for error context). */
async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}

/** App-wide singleton, built from env. Import this; don't `new CcClient()` per call. */
export const ccClient = CcClient.fromEnv();
