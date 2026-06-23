import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CcClient,
  CC_DEFAULT_BASE_URL,
  CcNotFoundError,
  CcRateLimitError,
  FORAGE_CUSTOMER_ID,
  type CcDimPayload,
} from "../services/ccClient";

/** Narrow `T | undefined` to `T`, throwing in tests instead of a `!` assertion. */
const must = <T>(v: T | undefined): T => {
  if (v === undefined) throw new Error("expected a value but got undefined");
  return v;
};

const CLIENT_ID = "test-id";
const CLIENT_SECRET = "test-secret";
const TENANT = "tenant-123";
const BASE = "https://cc.test";
const TOKEN_URL = `${BASE}/uaa/oauth/token`;
const SEARCH_PATH = `/tenants/${TENANT}/warehouse-products/search`;
const expectedBasic = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/**
 * Build a client whose fetch is a controllable mock. The OAuth2 token endpoint
 * is auto-answered; `dataResponder` handles everything else. `calls`/`tokenCalls`
 * record data vs token fetches separately for assertions.
 */
function makeClient(opts?: {
  dataResponder?: (url: string, init: RequestInit) => Response | Promise<Response>;
  clock?: () => number;
  syncCapacity?: number;
  syncRefillPerSec?: number;
  seedCapacity?: number;
  seedRefillPerSec?: number;
  tokenResponder?: () => Response;
}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const tokenCalls: { url: string; init: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/uaa/oauth/token")) {
      tokenCalls.push({ url: u, init });
      return opts?.tokenResponder?.() ?? json({ access_token: "tok-abc", expires_in: 3600 });
    }
    calls.push({ url: u, init });
    return opts?.dataResponder ? opts.dataResponder(u, init) : json([]);
  });
  const client = new CcClient({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    tenantId: TENANT,
    baseUrl: BASE,
    fetchImpl: fetchMock as unknown as typeof fetch,
    now: opts?.clock,
    syncCapacity: opts?.syncCapacity,
    syncRefillPerSec: opts?.syncRefillPerSec,
    seedCapacity: opts?.seedCapacity,
    seedRefillPerSec: opts?.seedRefillPerSec,
  });
  return { client, fetchMock, calls, tokenCalls };
}

/** A raw v8 warehouse product with one EA (default) + PLT UoM. */
function rawProduct(over: Record<string, unknown> = {}) {
  return {
    id: "whp-1",
    references: { code: "AE-BLA" },
    name: "AE - Dark Blackout",
    customer: { id: FORAGE_CUSTOMER_ID },
    defaultUnitOfMeasure: "EA",
    unitOfMeasures: {
      EA: { id: "uom-ea", name: "Each", barcode: "19345911000021" },
      PLT: { id: "uom-plt", name: "Pallet" },
    },
    ...over,
  };
}

describe("CcClient OAuth2 token", () => {
  it("fetches a client_credentials token with Basic auth + caches it", async () => {
    const { client, tokenCalls, calls } = makeClient({ dataResponder: () => json([]) });
    await client.listProducts(1, 100);
    await client.listProducts(2, 100);

    // One token fetch, reused across both data calls.
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0].url).toBe(TOKEN_URL);
    expect(tokenCalls[0].init.method).toBe("POST");
    const th = tokenCalls[0].init.headers as Record<string, string>;
    expect(th.Authorization).toBe(expectedBasic);
    expect(th["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(tokenCalls[0].init.body).toBe("grant_type=client_credentials");
    expect(calls).toHaveLength(2);
  });

  it("refreshes the token shortly before it expires", async () => {
    let t = 0;
    const { client, tokenCalls } = makeClient({
      dataResponder: () => json([]),
      clock: () => t,
      tokenResponder: () => json({ access_token: "tok", expires_in: 3600 }), // 1h
    });
    await client.listProducts(1, 100);
    expect(tokenCalls).toHaveLength(1);
    // Advance to within the 60s refresh skew of expiry → refetch.
    t = 3600_000 - 30_000;
    await client.listProducts(1, 100);
    expect(tokenCalls).toHaveLength(2);
  });

  it("throws CcApiError(401) when the token endpoint rejects", async () => {
    const { client } = makeClient({ tokenResponder: () => new Response("nope", { status: 401 }) });
    await expect(client.listProducts(1, 100)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("on a 401 from a DATA call, refreshes the token and retries once (succeeds)", async () => {
    let data = 0;
    const { client, calls, tokenCalls } = makeClient({
      // first data call 401s mid-flight (stale token); second succeeds.
      dataResponder: () => (++data === 1 ? new Response("stale", { status: 401 }) : json([])),
    });
    const result = await client.listProducts(1, 100);
    expect(result).toEqual([]);
    expect(tokenCalls).toHaveLength(2); // initial fetch + one forced refresh
    expect(calls).toHaveLength(2); // original + exactly one retry
  });

  it("surfaces a persistent data-call 401 after a single retry (no loop)", async () => {
    const { client, calls, tokenCalls } = makeClient({
      dataResponder: () => new Response("nope", { status: 401 }),
    });
    await expect(client.listProducts(1, 100)).rejects.toMatchObject({ statusCode: 401 });
    expect(tokenCalls).toHaveLength(2); // one refresh attempt, then give up
    expect(calls).toHaveLength(2); // original + one retry only — not an infinite loop
  });

  it("treats an empty CC_BASE_URL as the default (absolute token URL, not relative)", async () => {
    const seen: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      seen.push(String(url));
      return json(
        String(url).endsWith("/uaa/oauth/token") ? { access_token: "tok", expires_in: 3600 } : [],
      );
    });
    const client = new CcClient({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      tenantId: TENANT,
      baseUrl: "", // the documented blank `CC_BASE_URL=` must fall back to the default
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await client.listProducts(1, 5);
    const tokenUrl = must(seen.find((u) => u.endsWith("/uaa/oauth/token")));
    // Was producing the relative "/uaa/oauth/token" (Invalid URL) before the `||` fix.
    expect(tokenUrl).toBe(`${CC_DEFAULT_BASE_URL}/uaa/oauth/token`);
    expect(tokenUrl.startsWith("https://")).toBe(true);
  });
});

describe("CcClient.listProducts (warehouse-products v8 search)", () => {
  it("POSTs a customer-scoped search and maps to CcProduct (default-UoM dims/barcode)", async () => {
    const { client, calls } = makeClient({
      dataResponder: () =>
        json([
          rawProduct({
            unitOfMeasures: {
              EA: { id: "uom-ea", name: "Each", barcode: "bar-ea", length: 0.3, width: 0.2, height: 0.15, weight: 2.4 },
              PLT: { id: "uom-plt", name: "Pallet", barcode: "bar-plt" },
            },
          }),
        ]),
    });

    const products = await client.listProducts(1, 100);

    expect(products).toEqual([
      { id: "whp-1", code: "AE-BLA", barcode: "bar-ea", name: "AE - Dark Blackout", length: 0.3, width: 0.2, height: 0.15, weight: 2.4 },
    ]);
    const { url, init } = calls[0];
    expect(url).toBe(`${BASE}${SEARCH_PATH}?page=1&size=100`);
    expect(init.method).toBe("POST");
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer tok-abc");
    expect(h["Accept-Version"]).toBe("8");
    expect(h["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body.condition.conditions[0]).toMatchObject({
      field: { pointer: "/customer/id" },
      value: { value: FORAGE_CUSTOMER_ID },
      method: "EQUAL_TO",
    });
  });

  it("falls back to the first barcoded UoM when the default has none", async () => {
    const { client } = makeClient({
      dataResponder: () =>
        json([
          rawProduct({
            unitOfMeasures: {
              EA: { id: "uom-ea", name: "Each" }, // no barcode
              CT: { id: "uom-ct", name: "Carton", barcode: "ct-bar" },
            },
          }),
        ]),
    });
    const [p] = await client.listProducts(1, 100);
    expect(p.barcode).toBe("ct-bar");
  });
});

describe("CcClient.lookupByBarcode", () => {
  it("matches any UoM barcode across the search and returns the product", async () => {
    const { client } = makeClient({
      dataResponder: (u) => {
        const page = new URL(u).searchParams.get("page");
        if (page === "1") return json([rawProduct()]); // EA barcode 19345911000021
        return json([]);
      },
    });
    const p = await client.lookupByBarcode("19345911000021");
    expect(p?.id).toBe("whp-1");
  });

  it("returns null when no product carries the barcode", async () => {
    const { client } = makeClient({ dataResponder: () => json([]) });
    expect(await client.lookupByBarcode("nope")).toBeNull();
  });
});

describe("CcClient.patchProductDims (v8 JSON-Patch recipe)", () => {
  const dims: CcDimPayload = { length: 300, width: 200, height: 150, weight: 2.4 };

  /** Stateful responder: GET returns `product`; PATCH applies op:add into it. */
  function statefulResponder(product: ReturnType<typeof rawProduct>, applyPatch = true) {
    return async (url: string, init: RequestInit) => {
      if (init.method === "GET") return json(product);
      if (init.method === "PATCH") {
        if (applyPatch) {
          const ops = JSON.parse(init.body as string) as Array<{ path: string; value: number }>;
          for (const op of ops) {
            const m = op.path.match(/^\/unitOfMeasures\/([^/]+)\/(\w+)$/);
            if (m) {
              (product.unitOfMeasures as Record<string, Record<string, unknown>>)[m[1]][m[2]] = op.value;
            }
          }
        }
        return json({ ok: true });
      }
      return json([]);
    };
  }

  it("writes op:add metres on the default UoM, verifies read-back, returns written", async () => {
    const product = rawProduct();
    const { client, calls } = makeClient({ dataResponder: statefulResponder(product) });

    const outcome = await client.patchProductDims("whp-1", dims);
    expect(outcome).toEqual({ status: "written", uom: "EA" });

    const patch = must(calls.find((c) => c.init.method === "PATCH"));
    expect(patch.url).toBe(`${BASE}/tenants/${TENANT}/warehouse-products/whp-1`);
    const h = patch.init.headers as Record<string, string>;
    expect(h["Content-Type"]).toBe("application/json-patch+json");
    expect(h["Accept-Version"]).toBe("8");
    expect(JSON.parse(patch.init.body as string)).toEqual([
      { op: "add", path: "/unitOfMeasures/EA/length", value: 0.3 },
      { op: "add", path: "/unitOfMeasures/EA/width", value: 0.2 },
      { op: "add", path: "/unitOfMeasures/EA/height", value: 0.15 },
      { op: "add", path: "/unitOfMeasures/EA/weight", value: 2.4 },
    ]);
  });

  it("no-ops (no PATCH) when the default UoM dims already match", async () => {
    const product = rawProduct({
      unitOfMeasures: {
        EA: { id: "uom-ea", name: "Each", barcode: "b", length: 0.3, width: 0.2, height: 0.15, weight: 2.4 },
        PLT: { id: "uom-plt", name: "Pallet" },
      },
    });
    const { client, calls } = makeClient({ dataResponder: statefulResponder(product) });
    const outcome = await client.patchProductDims("whp-1", dims);
    expect(outcome).toEqual({ status: "noop", uom: "EA" });
    expect(calls.some((c) => c.init.method === "PATCH")).toBe(false);
  });

  it("only patches changed fields", async () => {
    const product = rawProduct({
      unitOfMeasures: {
        EA: { id: "uom-ea", name: "Each", barcode: "b", length: 0.3 }, // length already correct
        PLT: { id: "uom-plt", name: "Pallet" },
      },
    });
    const { client, calls } = makeClient({ dataResponder: statefulResponder(product) });
    await client.patchProductDims("whp-1", dims);
    const ops = JSON.parse(must(calls.find((c) => c.init.method === "PATCH")).init.body as string);
    expect(ops.map((o: { path: string }) => o.path)).toEqual([
      "/unitOfMeasures/EA/width",
      "/unitOfMeasures/EA/height",
      "/unitOfMeasures/EA/weight",
    ]);
  });

  it("blocks (no PATCH) a name-poisoned product", async () => {
    const product = rawProduct({
      unitOfMeasures: {
        EA: { id: "uom-ea", name: "Each", barcode: "b" },
        CT: { id: "uom-ct", name: "CT" }, // 2 chars → poisons the whole-product save
      },
    });
    const { client, calls } = makeClient({ dataResponder: statefulResponder(product) });
    const outcome = await client.patchProductDims("whp-1", dims);
    expect(outcome.status).toBe("blocked");
    if (outcome.status === "blocked") expect(outcome.reason).toContain("CT");
    expect(calls.some((c) => c.init.method === "PATCH")).toBe(false);
  });

  it("blocks (terminal, no PATCH) a non-Forage product — pinned customer guard", async () => {
    const product = rawProduct({ customer: { id: "some-other-customer" } });
    const { client, calls } = makeClient({ dataResponder: statefulResponder(product) });
    const outcome = await client.patchProductDims("whp-1", dims);
    expect(outcome.status).toBe("blocked");
    if (outcome.status === "blocked") expect(outcome.reason).toContain("non-Forage");
    // terminal, not retryable: no PATCH was issued (only the guard GET).
    expect(calls.some((c) => c.init.method === "PATCH")).toBe(false);
  });

  it("throws CcNotFoundError when the product GET 404s", async () => {
    const { client } = makeClient({
      dataResponder: () => new Response("gone", { status: 404 }),
    });
    await expect(client.patchProductDims("ghost", dims)).rejects.toBeInstanceOf(CcNotFoundError);
  });

  it("throws on read-back mismatch (the live seatbelt)", async () => {
    const product = rawProduct();
    // applyPatch=false → read-back GET still shows no dims → mismatch.
    const { client } = makeClient({ dataResponder: statefulResponder(product, false) });
    await expect(client.patchProductDims("whp-1", dims)).rejects.toMatchObject({
      name: "CcApiError",
    });
  });
});

describe("CcClient rate limiting", () => {
  it("drains the sync bucket via lookupByBarcode and refills at the configured rate", async () => {
    let t = 1_000_000;
    const { client, calls } = makeClient({
      dataResponder: () => json([]), // empty page → 1 token per lookup, returns null
      clock: () => t,
      syncCapacity: 60,
      syncRefillPerSec: 1,
    });
    for (let i = 0; i < 60; i++) await client.lookupByBarcode(`b${i}`);
    expect(calls).toHaveLength(60);
    await expect(client.lookupByBarcode("over")).rejects.toBeInstanceOf(CcRateLimitError);
    expect(calls).toHaveLength(60);
    t += 1000; // one token refills
    await client.lookupByBarcode("after");
    expect(calls).toHaveLength(61);
  });
});

describe("CcClient configuration guard", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("throws CcApiError(500) when OAuth2 creds are missing", async () => {
    const client = new CcClient({ clientId: "", clientSecret: "", tenantId: "", baseUrl: BASE });
    await expect(client.listProducts(1, 100)).rejects.toMatchObject({
      name: "CcApiError",
      statusCode: 500,
    });
    warn.mockRestore();
  });
});
