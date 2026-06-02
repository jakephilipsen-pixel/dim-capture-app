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
 * A token-bucket limiter (60 tokens, refill 1/sec) guards every outbound
 * call and *rejects* — does not queue — with `CcRateLimitError` when empty.
 *
 * Units are passed through verbatim: CC expects mm for dims and kg for
 * weight. This client does NOT convert; callers own unit handling.
 */
import { logger } from "../middleware/logger";

const log = logger.child({ module: "ccClient" });

/** Default CC REST base. Overridable via `CC_BASE_URL` (tests/smoke point at a mock). */
export const CC_DEFAULT_BASE_URL = "https://app.cartoncloud.com.au/api/v1";

/** CC API schema version sent on every request. */
const CC_ACCEPT_VERSION = "1";

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

/** Dimension payload pushed to CC. Units: mm for L/W/H, kg for weight. */
export interface CcDimPayload {
  length: number;
  width: number;
  height: number;
  weight: number;
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
  /** Token-bucket capacity. Default 60. */
  capacity?: number;
  /** Tokens refilled per second. Default 1 (→ 60/min). */
  refillPerSec?: number;
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
  private readonly bucket: TokenBucket;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: CcClientOptions) {
    this.apiKey = opts.apiKey;
    this.tenantId = opts.tenantId;
    this.baseUrl = (opts.baseUrl ?? CC_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.bucket = new TokenBucket(
      opts.capacity ?? 60,
      opts.refillPerSec ?? 1,
      opts.now ?? Date.now,
    );
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

  /** Consume a token or throw. Also guards against an unconfigured client. */
  private guard(): void {
    if (!this.apiKey || !this.tenantId) {
      throw new CcApiError(
        "CartonCloud client not configured (CC_API_KEY / CC_TENANT_ID missing)",
        500,
      );
    }
    if (!this.bucket.take()) {
      log.warn("rate limit bucket empty — rejecting request");
      throw new CcRateLimitError();
    }
  }

  /**
   * Look up a product by barcode within a warehouse account.
   * `GET /products?barcode={barcode}&warehouseAccountId={warehouseId}`.
   * Returns the first match, or `null` if CC has no such product (empty
   * result or 404). Throws `CcApiError` on any other non-2xx response.
   */
  async lookupByBarcode(barcode: string, warehouseId: string): Promise<CcProduct | null> {
    this.guard();
    const url = new URL(`${this.baseUrl}/products`);
    url.searchParams.set("barcode", barcode);
    url.searchParams.set("warehouseAccountId", warehouseId);

    const res = await this.fetchImpl(url.toString(), {
      method: "GET",
      headers: this.headers(false),
    });

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
   * Push captured dimensions to a CC product.
   * `PATCH /products/{productId}` with `{ length, width, height, weight }`.
   * Units pass through unchanged (mm / kg). Throws `CcNotFoundError` on 404,
   * `CcApiError` on any other non-2xx response.
   */
  async patchProductDims(productId: string, dims: CcDimPayload): Promise<void> {
    this.guard();
    const url = `${this.baseUrl}/products/${encodeURIComponent(productId)}`;

    const res = await this.fetchImpl(url, {
      method: "PATCH",
      headers: this.headers(true),
      body: JSON.stringify({
        length: dims.length,
        width: dims.width,
        height: dims.height,
        weight: dims.weight,
      }),
    });

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
