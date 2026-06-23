/**
 * CartonCloud API client — the validated OAuth2 / warehouse-products recipe.
 *
 * Pure service — no Express routes. Imported by sku-seed (03) and dim-api (04).
 *
 * Auth model (module 16 cc-oauth-write — replaces the never-validated Bearer
 * `CC_API_KEY` / `app.cartoncloud.com.au/api/v1` contract): OAuth2
 * client_credentials against `https://api.cartoncloud.com`.
 *   - Token: POST /uaa/oauth/token, Authorization: Basic base64(id:secret),
 *     body grant_type=client_credentials. Cached; refreshed 60s before expiry.
 *   - Data paths are tenant-scoped: /tenants/{tenant}/…, Authorization: Bearer.
 *   - Warehouse products + dims live under Accept-Version: 8.
 *
 * Why warehouse-products (not the old /products): /products is *transport
 * products* (404 "Invalid product id"); carton dims live on the warehouse
 * product's UoMs and only exist under v8. The write is a JSON-Patch op:add on
 * /unitOfMeasures/{uom}/{dim} — a v1 PATCH silently drops L/W/H.
 *
 * Rate limiting (module 10 cc-resilience, preserved):
 *   - syncBucket: guards lookupByBarcode + patchProductDims.
 *   - seedBucket: guards listProducts (the warehouse-products search pull).
 *   One token is charged per LOGICAL op, NOT per HTTP call. `patchProductDims`
 *   is now 3 HTTP calls per token (GET + PATCH + read-back GET) since the v8
 *   recipe needs a read + a verify; the PATCH itself stays ≈1 per token, and the
 *   2 extra calls are reads (CC hard-caps writes, ~30/min, far more than reads —
 *   gotcha #5). So the bucket bounds the *write* rate, not raw HTTP volume.
 *   The OAuth2 token fetch does NOT consume a bucket token (it's auth, not data).
 *   // TODO(robustness): charge per HTTP call or pace the bulk sync if a large
 *   // first-rollout backlog ever trips CC's limit.
 *
 * Fetch timeouts (module 10, preserved): every fetch gets AbortSignal.timeout;
 * a timeout becomes CcTimeoutError (504); the raw DOMException never escapes.
 *
 * Units: callers pass dims in the app's canonical mm + kg. CartonCloud stores
 * carton L/W/H in METRES, so the write converts mm→m (÷1000) at the boundary;
 * weight (kg) is unchanged.
 */
import { logger } from "../middleware/logger";

const log = logger.child({ module: "ccClient" });

/** Default CC REST base. Overridable via `CC_BASE_URL` (tests/smoke point at a mock). */
export const CC_DEFAULT_BASE_URL = "https://api.cartoncloud.com";

/** The Forage Company customer UUID — the only customer this app writes to. */
export const FORAGE_CUSTOMER_ID = "d4810e1e-91ab-43ed-b68e-b72bd858b122";

/** Schema version for warehouse-products + UoM dims (carton dims exist only here). */
const WP_ACCEPT_VERSION = "8";

/** CC's UoM-name length rule (inclusive). A name outside this poisons any dims PATCH. */
export const UOM_NAME_MIN = 3;
export const UOM_NAME_MAX = 64;

/**
 * Default fetch timeout in milliseconds. Overridable via `CC_TIMEOUT_MS`.
 * 12 000 ms gives CC a full 12 s to respond, short enough to prevent an
 * indefinite hang on `POST /api/sync/cc` (S4).
 */
export const CC_DEFAULT_TIMEOUT_MS = 12_000;

/**
 * Token-budget split between the sync and seed paths. seed + sync MUST NOT
 * exceed CC's 60 req/min tenant ceiling. Burst sync=40 + seed=20 = 60; sustained
 * 40/60 + 20/60 per sec = 60/min.
 */
export const CC_DEFAULT_SYNC_CAPACITY = 40;
export const CC_DEFAULT_SEED_CAPACITY = 20;
export const CC_DEFAULT_SYNC_REFILL_PER_SEC = 40 / 60;
export const CC_DEFAULT_SEED_REFILL_PER_SEC = 20 / 60;

/** Refresh the OAuth2 token this many ms before it actually expires. */
const TOKEN_REFRESH_SKEW_MS = 60_000;

/**
 * A CartonCloud warehouse product as this app cares about it: identity + the
 * default UoM's barcode and dims. Dims/weight/barcode are nullable because a
 * product may have none captured in CC yet.
 */
export interface CcProduct {
  id: string;
  /** SKU code from `references.code` (e.g. "AE-BLA"). */
  code: string;
  /** Barcode from the default (or first barcoded) UoM. Null if none. */
  barcode: string | null;
  name: string;
  length: number | null;
  width: number | null;
  height: number | null;
  weight: number | null;
}

/**
 * Dimension payload pushed to CC. Callers pass the app's canonical **mm** for
 * L/W/H and **kg** for weight; the write converts mm→m at the CC boundary.
 */
export interface CcDimPayload {
  length: number;
  width: number;
  height: number;
  weight: number;
}

/**
 * Outcome of a dims write. `written`/`noop` mean the SKU's CC dims are correct;
 * `blocked` means CC cannot accept the write because a sibling UoM name is
 * invalid (the whole-product save would 422) — not retryable until fixed in CC.
 * Retryable failures (404, API error, read-back mismatch) THROW instead.
 */
export type DimWriteOutcome =
  | { status: "written"; uom: string }
  | { status: "noop"; uom: string }
  | { status: "blocked"; reason: string };

/** Millimetres per metre — the mm→m factor for the CC write boundary. */
const MM_PER_METRE = 1000;

/** Convert a millimetre length to metres (CC's unit), rounded to 4 dp to kill FP noise. */
function mmToMetres(mm: number): number {
  return Math.round((mm / MM_PER_METRE) * 10000) / 10000;
}

/** Two dim values are equal if within this tolerance (post-rounding / JSON round-trip). */
const DIM_EPSILON = 1e-6;

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
 * Raised when a CC fetch is aborted by `AbortSignal.timeout()` (S4). Extends
 * `CcApiError` (statusCode 504) so generic CcApiError handlers also catch it.
 */
export class CcTimeoutError extends CcApiError {
  constructor(message = "CartonCloud request timed out") {
    super(message, 504);
    this.name = "CcTimeoutError";
    Object.setPrototypeOf(this, CcTimeoutError.prototype);
  }
}

/** Raised when a CC auth (token) call fails — credentials or token endpoint. */
export class CcAuthError extends CcApiError {
  constructor(message = "CartonCloud authentication failed") {
    super(message, 401);
    this.name = "CcAuthError";
    Object.setPrototypeOf(this, CcAuthError.prototype);
  }
}

/** Raised when a write targets a warehouse-product id CC doesn't know (404). */
export class CcNotFoundError extends Error {
  constructor(message = "CartonCloud warehouse product not found") {
    super(message);
    this.name = "CcNotFoundError";
    Object.setPrototypeOf(this, CcNotFoundError.prototype);
  }
}

/** Injectable so tests/smoke can supply a fake fetch + deterministic clock. */
export interface CcClientOptions {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  baseUrl?: string;
  /** Customer to scope reads/writes to. Default FORAGE_CUSTOMER_ID. */
  customerId?: string;
  /** Sync-path bucket capacity (lookupByBarcode + patchProductDims). Default 40. */
  syncCapacity?: number;
  /** Sync-path refill/sec. Default 40/60. */
  syncRefillPerSec?: number;
  /** Seed-path bucket capacity (listProducts). Default 20. */
  seedCapacity?: number;
  /** Seed-path refill/sec. Default 20/60. */
  seedRefillPerSec?: number;
  /** @deprecated maps to syncCapacity. @internal */
  capacity?: number;
  /** @deprecated maps to syncRefillPerSec. @internal */
  refillPerSec?: number;
  /** Fetch timeout in ms. Default CC_DEFAULT_TIMEOUT_MS (12 000). */
  timeoutMs?: number;
  /** Defaults to global `fetch` (Node 22). */
  fetchImpl?: typeof fetch;
  /** Monotonic clock in ms. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * In-memory token bucket. Refills continuously at `refillPerSec`, capped at
 * `capacity`. `take()` consumes one token if available, else returns false.
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

/** One UoM as CC returns it under v8 (the fields we read). */
interface RawUom {
  name?: string | null;
  barcode?: string | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  weight?: number | null;
}

/** A warehouse product as CC returns it under v8 (the fields we read). */
interface RawWarehouseProduct {
  id?: string;
  name?: string;
  references?: { code?: string } | null;
  customer?: { id?: string } | null;
  defaultUnitOfMeasure?: string | null;
  unitOfMeasures?: Record<string, RawUom | null> | null;
}

/** Coerce a CC value to a finite number or null. */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Is a UoM name within CC's 3–64 char rule? (missing / non-string → invalid) */
export function isValidUomName(name: unknown): boolean {
  return typeof name === "string" && name.length >= UOM_NAME_MIN && name.length <= UOM_NAME_MAX;
}

/** UoM keys whose name fails CC's 3–64 rule — these poison any dims PATCH on the product. */
function poisoningUoms(raw: RawWarehouseProduct): string[] {
  const uoms = raw.unitOfMeasures ?? {};
  return Object.entries(uoms)
    .filter(([, obj]) => !isValidUomName((obj ?? {}).name))
    .map(([key]) => key);
}

/** The default UoM's dims (CC stores metres) — null fields when unset. */
function defaultUomDims(raw: RawWarehouseProduct): {
  length: number | null;
  width: number | null;
  height: number | null;
  weight: number | null;
} {
  const key = raw.defaultUnitOfMeasure ?? "";
  const uom = (raw.unitOfMeasures ?? {})[key] ?? {};
  return {
    length: num(uom.length),
    width: num(uom.width),
    height: num(uom.height),
    weight: num(uom.weight),
  };
}

/** The barcode to scan against: the default UoM's, else the first UoM that has one. */
function productBarcode(raw: RawWarehouseProduct): string | null {
  const uoms = raw.unitOfMeasures ?? {};
  const defKey = raw.defaultUnitOfMeasure ?? "";
  const def = uoms[defKey];
  if (def && typeof def.barcode === "string" && def.barcode) return def.barcode;
  for (const obj of Object.values(uoms)) {
    if (obj && typeof obj.barcode === "string" && obj.barcode) return obj.barcode;
  }
  return null;
}

/** Map a raw warehouse product to the summary `CcProduct` (default-UoM dims). */
function toCcProduct(raw: RawWarehouseProduct): CcProduct {
  const dims = defaultUomDims(raw);
  return {
    id: String(raw.id ?? ""),
    code: String(raw.references?.code ?? ""),
    barcode: productBarcode(raw),
    name: String(raw.name ?? ""),
    ...dims,
  };
}

/** A search page is a bare array; tolerate `{data}`/`{items}` wrappers too. */
function extractItems(body: unknown): RawWarehouseProduct[] {
  if (Array.isArray(body)) return body as RawWarehouseProduct[];
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data as RawWarehouseProduct[];
    if (Array.isArray(obj.items)) return obj.items as RawWarehouseProduct[];
  }
  return [];
}

/** Build the customer-scoped + active warehouse-products search body. */
function searchBody(customerId: string): unknown {
  return {
    condition: {
      type: "AndCondition",
      conditions: [
        {
          type: "TextComparisonCondition",
          field: { type: "JsonField", pointer: "/customer/id" },
          value: { type: "ValueField", value: customerId },
          method: "EQUAL_TO",
        },
        {
          type: "BooleanComparisonCondition",
          field: { type: "JsonField", pointer: "/details/active" },
          value: { type: "ValueField", value: "true" },
          method: "EQUAL_TO",
        },
      ],
    },
  };
}

export class CcClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly tenantId: string;
  private readonly baseUrl: string;
  private readonly customerId: string;
  private readonly syncBucket: TokenBucket;
  private readonly seedBucket: TokenBucket;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private token: { accessToken: string; expiresAt: number } | null = null;

  constructor(opts: CcClientOptions) {
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.tenantId = opts.tenantId;
    this.baseUrl = (opts.baseUrl ?? CC_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.customerId = opts.customerId ?? process.env.CC_CUSTOMER_ID ?? FORAGE_CUSTOMER_ID;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? Number(process.env.CC_TIMEOUT_MS ?? CC_DEFAULT_TIMEOUT_MS);
    this.now = opts.now ?? Date.now;

    const syncCap =
      opts.syncCapacity ?? (opts.capacity !== undefined ? opts.capacity : CC_DEFAULT_SYNC_CAPACITY);
    const syncRefill = opts.syncRefillPerSec ?? opts.refillPerSec ?? CC_DEFAULT_SYNC_REFILL_PER_SEC;
    const seedCap = opts.seedCapacity ?? CC_DEFAULT_SEED_CAPACITY;
    const seedRefill = opts.seedRefillPerSec ?? CC_DEFAULT_SEED_REFILL_PER_SEC;

    this.syncBucket = new TokenBucket(syncCap, syncRefill, this.now);
    this.seedBucket = new TokenBucket(seedCap, seedRefill, this.now);
  }

  /** Build from `CC_*` env. Missing creds surface on first call, not construction. */
  static fromEnv(overrides: Partial<CcClientOptions> = {}): CcClient {
    return new CcClient({
      clientId: process.env.CC_CLIENT_ID ?? "",
      clientSecret: process.env.CC_CLIENT_SECRET ?? "",
      tenantId: process.env.CC_TENANT_ID ?? "",
      baseUrl: process.env.CC_BASE_URL ?? CC_DEFAULT_BASE_URL,
      ...overrides,
    });
  }

  private assertConfigured(): void {
    if (!this.clientId || !this.clientSecret || !this.tenantId) {
      throw new CcApiError(
        "CartonCloud client not configured (CC_CLIENT_ID / CC_CLIENT_SECRET / CC_TENANT_ID missing)",
        500,
      );
    }
  }

  /** Consume a token from the named bucket or throw CcRateLimitError. */
  private guard(path: "sync" | "seed"): void {
    this.assertConfigured();
    const bucket = path === "seed" ? this.seedBucket : this.syncBucket;
    if (!bucket.take()) {
      log.warn({ path }, "rate limit bucket empty — rejecting request");
      throw new CcRateLimitError();
    }
  }

  /** Convert an abort/timeout DOMException into CcTimeoutError; re-throw the rest. */
  private handleFetchError(err: unknown): never {
    if (err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError")) {
      log.warn("CartonCloud request timed out or was aborted");
      throw new CcTimeoutError();
    }
    throw err;
  }

  /** OAuth2 client_credentials token, cached + refreshed 60s before expiry. */
  private async ensureToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.token && this.now() < this.token.expiresAt - TOKEN_REFRESH_SKEW_MS) {
      return this.token.accessToken;
    }
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/uaa/oauth/token`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      this.handleFetchError(err);
    }
    if (!res.ok) {
      throw new CcAuthError(`CartonCloud token request failed: ${res.status} ${await safeText(res)}`);
    }
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      throw new CcAuthError("CartonCloud token response missing access_token");
    }
    const expiresInMs = (Number(data.expires_in) || 3600) * 1000;
    this.token = { accessToken: data.access_token, expiresAt: this.now() + expiresInMs };
    return this.token.accessToken;
  }

  /**
   * Tenant-scoped, authenticated fetch under Accept-Version 8. Ensures a token,
   * applies the timeout, and retries ONCE on a 401 (token revoked mid-flight).
   * Rate-limit bucket consumption is the caller's responsibility (via `guard`).
   */
  private async authedFetch(path: string, init: RequestInit, retryOn401 = true): Promise<Response> {
    const token = await this.ensureToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Accept-Version": WP_ACCEPT_VERSION,
      Accept: "application/json",
      ...((init.headers as Record<string, string>) ?? {}),
    };
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/tenants/${this.tenantId}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      this.handleFetchError(err);
    }
    if (res.status === 401 && retryOn401) {
      log.info("CC returned 401 — refreshing token and retrying once");
      await this.ensureToken(true);
      return this.authedFetch(path, init, false);
    }
    return res;
  }

  /**
   * One page of the Forage warehouse-products search (POST /warehouse-products/search).
   * `page` is 1-based; CC returns a bare array (empty when past the end). Callers
   * paginate by incrementing `page` until a short/empty page. Throws CcApiError
   * on any non-2xx.
   */
  async listProducts(page: number, pageSize: number): Promise<CcProduct[]> {
    const items = await this.rawSearchPage(page, pageSize, "seed");
    return items.map(toCcProduct);
  }

  /**
   * Resolve a barcode to its Forage warehouse product via the customer-scoped
   * search, matching any UoM barcode. Used only as a DB-miss fallback (the seed
   * populates the DB), so it paginates and stops at the first match. Returns null
   * if no Forage product carries the barcode. Throws CcApiError on a non-2xx.
   */
  async lookupByBarcode(barcode: string): Promise<CcProduct | null> {
    const pageSize = 100;
    for (let page = 1; ; page += 1) {
      const items = await this.rawSearchPage(page, pageSize, "sync");
      if (items.length === 0) return null;
      const hit = items.find((raw) => uomBarcodes(raw).includes(barcode));
      if (hit) return toCcProduct(hit);
      if (items.length < pageSize) return null;
    }
  }

  /** One raw search page (POST /warehouse-products/search). `bucket` picks the limiter. */
  private async rawSearchPage(
    page: number,
    pageSize: number,
    bucket: "sync" | "seed",
  ): Promise<RawWarehouseProduct[]> {
    this.guard(bucket);
    const qs = new URLSearchParams({ page: String(page), size: String(pageSize) });
    const res = await this.authedFetch(`/warehouse-products/search?${qs.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(searchBody(this.customerId)),
    });
    // NOTE: do NOT treat 404 as an empty page here. /warehouse-products/search is a
    // supported endpoint; a 404 means a misconfigured path/tenant/version, not
    // end-of-pagination (that's handled by empty/short pages in the callers). Masking
    // it would make a broken seed report a silent zero-product success.
    if (!res.ok) {
      throw new CcApiError(
        `warehouse-products search failed (page ${page}): ${res.status} ${await safeText(res)}`,
        res.status,
      );
    }
    return extractItems(await res.json());
  }

  /** GET a single warehouse product under v8 (raw — used by the write path). */
  private async getWarehouseProduct(id: string): Promise<RawWarehouseProduct> {
    const res = await this.authedFetch(`/warehouse-products/${encodeURIComponent(id)}`, {
      method: "GET",
    });
    if (res.status === 404) {
      throw new CcNotFoundError(`warehouse product ${id} not found in CartonCloud`);
    }
    if (!res.ok) {
      throw new CcApiError(
        `getWarehouseProduct failed for ${id}: ${res.status} ${await safeText(res)}`,
        res.status,
      );
    }
    return (await res.json()) as RawWarehouseProduct;
  }

  /**
   * Write captured dims to a warehouse product's default (Each/Base) UoM, the
   * validated recipe:
   *   1. GET the product (v8) → customer + defaultUnitOfMeasure + current dims
   *   2. customer guard (must be Forage)
   *   3. name-poison guard → blocked (no PATCH) if any UoM name is invalid
   *   4. resolve target UoM = defaultUnitOfMeasure (the UoM key, e.g. "EA")
   *   5. desired = mm→m (L/W/H) + weight kg; idempotent diff → noop if unchanged
   *   6. PATCH JSON-Patch op:add on /unitOfMeasures/{uom}/{field} for changed fields
   *   7. read-back GET and verify; mismatch THROWS
   *
   * `productId` is the **warehouse-product id** (= `Sku.id` after the v8 re-seed).
   * Throws CcNotFoundError (404), CcApiError (other non-2xx / read-back mismatch).
   * The bucket token is consumed once up front; the internal GET/read-back reuse
   * the same logical operation.
   */
  async patchProductDims(productId: string, dims: CcDimPayload): Promise<DimWriteOutcome> {
    this.guard("sync");
    const raw = await this.getWarehouseProduct(productId);

    // (2) customer guard — never write to a non-Forage product. Pinned to the
    // FORAGE_CUSTOMER_ID CONSTANT (not the env-configurable this.customerId used
    // for reads/search), so the live write path can't be silently retargeted off
    // Forage via CC_CUSTOMER_ID. A mismatch is a permanent, terminal condition →
    // return blocked (NOT a throw) so it leaves the retry set instead of looping.
    const customerId = raw.customer?.id ?? "";
    if (customerId !== FORAGE_CUSTOMER_ID) {
      const reason = `blocked — non-Forage customer: ${customerId || "(none)"}`;
      log.warn({ productId, customerId }, "refusing dims write — product is not Forage");
      return { status: "blocked", reason };
    }

    // (3) name-poison guard.
    const poisoned = poisoningUoms(raw);
    if (poisoned.length > 0) {
      const reason = `blocked — UoM name invalid (CC ${UOM_NAME_MIN}-${UOM_NAME_MAX} chars): ${poisoned.join(", ")}`;
      log.warn({ productId, poisoned }, "skipping dims write — name-poisoned product");
      return { status: "blocked", reason };
    }

    // (4) target UoM.
    const uom = raw.defaultUnitOfMeasure ?? "";
    if (!uom || !(raw.unitOfMeasures ?? {})[uom]) {
      throw new CcApiError(`warehouse product ${productId} has no resolvable default UoM`, 422);
    }

    // (5) desired (metres) vs current; build op:add for changed fields only.
    const desired: Record<string, number> = {
      length: mmToMetres(dims.length),
      width: mmToMetres(dims.width),
      height: mmToMetres(dims.height),
      weight: dims.weight,
    };
    const current = (raw.unitOfMeasures ?? {})[uom] ?? {};
    const ops = buildPatchOps(uom, desired, current);
    if (ops.length === 0) {
      log.info({ productId, uom }, "dims already match in CartonCloud — no-op");
      return { status: "noop", uom };
    }

    // (6) PATCH.
    const patchRes = await this.authedFetch(`/warehouse-products/${encodeURIComponent(productId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json-patch+json" },
      body: JSON.stringify(ops),
    });
    if (patchRes.status === 404) {
      throw new CcNotFoundError(`warehouse product ${productId} not found in CartonCloud`);
    }
    if (!patchRes.ok) {
      throw new CcApiError(
        `patchProductDims failed for ${productId}: ${patchRes.status} ${await safeText(patchRes)}`,
        patchRes.status,
      );
    }

    // (7) read-back verify.
    const after = await this.getWarehouseProduct(productId);
    const afterDims = (after.unitOfMeasures ?? {})[uom] ?? {};
    for (const field of ["length", "width", "height", "weight"] as const) {
      const want = desired[field];
      const got = num(afterDims[field]);
      if (got === null || Math.abs(got - want) > DIM_EPSILON) {
        throw new CcApiError(
          `read-back mismatch for ${productId}/${uom}/${field}: wrote ${want}, read ${got}`,
          502,
        );
      }
    }
    log.info({ productId, uom }, "patched + verified warehouse-product dims in CartonCloud");
    return { status: "written", uom };
  }
}

/** All UoM barcodes present on a raw product (for the barcode-lookup fallback). */
function uomBarcodes(raw: RawWarehouseProduct): string[] {
  return Object.values(raw.unitOfMeasures ?? {})
    .map((u) => (u && typeof u.barcode === "string" ? u.barcode : ""))
    .filter((b): b is string => b.length > 0);
}

/** JSON-Patch op:add entries for the dim fields whose desired value differs from current. */
function buildPatchOps(
  uom: string,
  desired: Record<string, number>,
  current: RawUom,
): Array<{ op: "add"; path: string; value: number }> {
  const ops: Array<{ op: "add"; path: string; value: number }> = [];
  for (const field of ["length", "width", "height", "weight"] as const) {
    const want = desired[field];
    const have = num(current[field]);
    if (have === null || Math.abs(have - want) > DIM_EPSILON) {
      ops.push({ op: "add", path: `/unitOfMeasures/${uom}/${field}`, value: want });
    }
  }
  return ops;
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
