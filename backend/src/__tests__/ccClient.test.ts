import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CcApiError,
  CcClient,
  CcNotFoundError,
  CcRateLimitError,
  type CcDimPayload,
} from "../services/ccClient";

const API_KEY = "test-key";
const TENANT = "tenant-123";
const WAREHOUSE = "wh-456";
const BASE = "https://cc.test/api/v1";

/** Build a client whose fetch is a controllable mock, with a frozen clock. */
function makeClient(opts?: {
  responder?: (url: string, init: RequestInit) => Response | Promise<Response>;
  clock?: () => number;
  capacity?: number;
  refillPerSec?: number;
}) {
  const fetchMock = vi.fn(
    opts?.responder ?? (() => new Response("[]", { status: 200 })),
  );
  const client = new CcClient({
    apiKey: API_KEY,
    tenantId: TENANT,
    baseUrl: BASE,
    fetchImpl: fetchMock as unknown as typeof fetch,
    now: opts?.clock,
    capacity: opts?.capacity,
    refillPerSec: opts?.refillPerSec,
  });
  return { client, fetchMock };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("CcClient.lookupByBarcode", () => {
  it("returns a CcProduct for a known barcode", async () => {
    const { client, fetchMock } = makeClient({
      responder: () =>
        json([
          {
            id: "prod-1",
            barcode: "9300675024635",
            name: "Cadbury Dairy Milk 200g",
            length: 300,
            width: 200,
            height: 150,
            weight: 2.4,
          },
        ]),
    });

    const product = await client.lookupByBarcode("9300675024635", WAREHOUSE);

    expect(product).toEqual({
      id: "prod-1",
      barcode: "9300675024635",
      name: "Cadbury Dairy Milk 200g",
      length: 300,
      width: 200,
      height: 150,
      weight: 2.4,
    });

    // Correct URL + query params.
    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.origin + calledUrl.pathname).toBe(`${BASE}/products`);
    expect(calledUrl.searchParams.get("barcode")).toBe("9300675024635");
    expect(calledUrl.searchParams.get("warehouseAccountId")).toBe(WAREHOUSE);
  });

  it("sends the correct auth + tenant + version headers", async () => {
    const { client, fetchMock } = makeClient({ responder: () => json([]) });
    await client.lookupByBarcode("x", WAREHOUSE);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers["X-Tenant-Id"]).toBe(TENANT);
    expect(headers["Accept-Version"]).toBe("1");
    expect(init.method).toBe("GET");
  });

  it("returns null when CC responds 404", async () => {
    const { client } = makeClient({
      responder: () => new Response("not found", { status: 404 }),
    });
    expect(await client.lookupByBarcode("nope", WAREHOUSE)).toBeNull();
  });

  it("returns null for an empty result set", async () => {
    const { client } = makeClient({ responder: () => json([]) });
    expect(await client.lookupByBarcode("nope", WAREHOUSE)).toBeNull();
  });

  it("unwraps a { data: [...] } envelope and coerces string numbers", async () => {
    const { client } = makeClient({
      responder: () =>
        json({
          data: [
            { id: "p2", barcode: "b2", name: "N", length: "120", width: "80" },
          ],
        }),
    });
    const product = await client.lookupByBarcode("b2", WAREHOUSE);
    expect(product).toMatchObject({
      id: "p2",
      length: 120,
      width: 80,
      height: null,
      weight: null,
    });
  });

  it("throws CcApiError (with status) on a non-404 error", async () => {
    const { client } = makeClient({
      responder: () => new Response("boom", { status: 500 }),
    });
    await expect(client.lookupByBarcode("x", WAREHOUSE)).rejects.toMatchObject({
      name: "CcApiError",
      statusCode: 500,
    });
    await expect(client.lookupByBarcode("x", WAREHOUSE)).rejects.toBeInstanceOf(
      CcApiError,
    );
  });
});

describe("CcClient.patchProductDims", () => {
  const dims: CcDimPayload = { length: 300, width: 200, height: 150, weight: 2.4 };

  it("PATCHes /products/:id with the correct body and headers", async () => {
    const { client, fetchMock } = makeClient({
      responder: () => new Response(null, { status: 200 }),
    });

    await client.patchProductDims("prod-1", dims);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/products/prod-1`);
    expect(init.method).toBe("PATCH");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers["X-Tenant-Id"]).toBe(TENANT);
    expect(headers["Content-Type"]).toBe("application/json");
    // L/W/H converted mm→cm at the CC boundary (CC stores carton dims in cm);
    // weight (kg) unchanged. 300/200/150 mm → 30/20/15 cm.
    expect(JSON.parse(init.body as string)).toEqual({
      length: 30,
      width: 20,
      height: 15,
      weight: 2.4,
    });
  });

  it("converts non-round mm to cm without float noise", async () => {
    const { client, fetchMock } = makeClient({
      responder: () => new Response(null, { status: 200 }),
    });
    await client.patchProductDims("prod-1", { length: 255, width: 145, height: 7, weight: 1.3 });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      length: 25.5,
      width: 14.5,
      height: 0.7,
      weight: 1.3,
    });
  });

  it("url-encodes the product id", async () => {
    const { client, fetchMock } = makeClient({
      responder: () => new Response(null, { status: 204 }),
    });
    await client.patchProductDims("a/b c", dims);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/products/a%2Fb%20c`);
  });

  it("throws CcNotFoundError on 404", async () => {
    const { client } = makeClient({
      responder: () => new Response("gone", { status: 404 }),
    });
    await expect(client.patchProductDims("ghost", dims)).rejects.toBeInstanceOf(
      CcNotFoundError,
    );
  });

  it("throws CcApiError (with status) on a non-404 error", async () => {
    const { client } = makeClient({
      responder: () => new Response("bad", { status: 422 }),
    });
    await expect(client.patchProductDims("p", dims)).rejects.toMatchObject({
      name: "CcApiError",
      statusCode: 422,
    });
  });
});

describe("CcClient rate limiting", () => {
  it("rejects the 61st request within a minute with CcRateLimitError", async () => {
    let t = 1_000_000;
    // Explicit refillPerSec=1 (deprecated alias → syncRefillPerSec) to keep this
    // test's 1000 ms advance == 1 token assertion independent of the production
    // default rate (40/60 ≈ 0.6667/sec). Tests refill *logic*, not the default.
    const { client, fetchMock } = makeClient({
      responder: () => json([]),
      clock: () => t, // frozen — no refill between calls
      capacity: 60,
      refillPerSec: 1,
    });

    // 60 requests drain the full bucket.
    for (let i = 0; i < 60; i++) {
      await client.lookupByBarcode(`b${i}`, WAREHOUSE);
    }
    expect(fetchMock).toHaveBeenCalledTimes(60);

    // 61st is rejected before any HTTP call is made.
    await expect(client.lookupByBarcode("over", WAREHOUSE)).rejects.toBeInstanceOf(
      CcRateLimitError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(60);

    // After 1 second, exactly one token refills (1/sec) and a call succeeds.
    t += 1000;
    await client.lookupByBarcode("after-refill", WAREHOUSE);
    expect(fetchMock).toHaveBeenCalledTimes(61);
  });

  it("refills at configured rate, capped at capacity", async () => {
    let t = 0;
    // Explicit refillPerSec=1 so the 5 × 1000 ms advance == 5 tokens assertion
    // is independent of the production default rate (40/60 ≈ 0.6667/sec).
    const { client, fetchMock } = makeClient({
      responder: () => json([]),
      clock: () => t,
      capacity: 60,
      refillPerSec: 1,
    });
    // Drain.
    for (let i = 0; i < 60; i++) await client.lookupByBarcode(`b${i}`, WAREHOUSE);
    // Advance 5s at 1/sec → 5 tokens back.
    t += 5000;
    for (let i = 0; i < 5; i++) await client.lookupByBarcode(`r${i}`, WAREHOUSE);
    expect(fetchMock).toHaveBeenCalledTimes(65);
    // 6th should fail — only 5 refilled.
    await expect(client.lookupByBarcode("x", WAREHOUSE)).rejects.toBeInstanceOf(
      CcRateLimitError,
    );
  });
});

describe("CcClient configuration guard", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("throws CcApiError(500) when API key / tenant are missing", async () => {
    const client = new CcClient({ apiKey: "", tenantId: "", baseUrl: BASE });
    await expect(client.lookupByBarcode("x", WAREHOUSE)).rejects.toMatchObject({
      name: "CcApiError",
      statusCode: 500,
    });
    warn.mockRestore();
  });
});
