/**
 * cc-resilience tests — module 10, updated for the module-16 OAuth2/v8 client.
 *
 * Covers:
 *   S4 — fetch timeout: a fetch that rejects with an abort/timeout DOMException
 *        surfaces as CcTimeoutError (not a hang, no raw DOMException leak).
 *   M2a — an empty bucket rejects the call with CcRateLimitError BEFORE any data
 *         fetch (the OAuth2 token fetch doesn't consume a bucket token).
 *   M2b — seedBucket (listProducts) vs syncBucket (lookupByBarcode +
 *         patchProductDims) don't starve each other; each refills independently;
 *         combined sustained throughput stays ≤ CC's 60/min ceiling.
 */
import { describe, expect, it, vi } from "vitest";
import {
  CcApiError,
  CcClient,
  CcRateLimitError,
  CcTimeoutError,
  FORAGE_CUSTOMER_ID,
  type CcDimPayload,
} from "../services/ccClient";

const TENANT = "tenant-123";
const BASE = "https://cc.test";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/**
 * Build a client with controllable fetch + frozen clock. The OAuth2 token
 * endpoint is auto-answered (never rejects unless `tokenRejects`); `dataResponder`
 * handles everything else. `dataCalls()` counts non-token fetches.
 */
function makeClient(opts?: {
  dataResponder?: (url: string, init: RequestInit) => Response | Promise<Response>;
  clock?: () => number;
  seedCapacity?: number;
  syncCapacity?: number;
  seedRefillPerSec?: number;
  syncRefillPerSec?: number;
}) {
  let dataCalls = 0;
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    if (String(url).endsWith("/uaa/oauth/token")) return json({ access_token: "tok", expires_in: 3600 });
    dataCalls += 1;
    return opts?.dataResponder ? opts.dataResponder(String(url), init) : json([]);
  });
  const client = new CcClient({
    clientId: "id",
    clientSecret: "secret",
    tenantId: TENANT,
    baseUrl: BASE,
    fetchImpl: fetchMock as unknown as typeof fetch,
    now: opts?.clock,
    seedCapacity: opts?.seedCapacity,
    syncCapacity: opts?.syncCapacity,
    seedRefillPerSec: opts?.seedRefillPerSec,
    syncRefillPerSec: opts?.syncRefillPerSec,
  });
  return { client, fetchMock, dataCalls: () => dataCalls };
}

const dims: CcDimPayload = { length: 300, width: 200, height: 150, weight: 2.4 };

// ---------------------------------------------------------------------------
// S4 — Fetch timeout
// ---------------------------------------------------------------------------

describe("S4 — CC fetch timeout", () => {
  it("CcTimeoutError is a subclass of CcApiError", () => {
    const err = new CcTimeoutError();
    expect(err).toBeInstanceOf(CcApiError);
    expect(err.statusCode).toBe(504);
  });

  it("listProducts: an abort DOMException surfaces as CcTimeoutError — not a hang", async () => {
    const { client } = makeClient({
      dataResponder: () => Promise.reject(new DOMException("timeout", "TimeoutError")),
    });
    await expect(client.listProducts(1, 100)).rejects.toBeInstanceOf(CcTimeoutError);
    await expect(client.listProducts(1, 100)).rejects.not.toBeInstanceOf(DOMException);
  });

  it("lookupByBarcode: AbortError also surfaces as CcTimeoutError", async () => {
    const { client } = makeClient({
      dataResponder: () => Promise.reject(new DOMException("aborted", "AbortError")),
    });
    await expect(client.lookupByBarcode("b1")).rejects.toBeInstanceOf(CcTimeoutError);
  });

  it("patchProductDims: an abort on the initial GET surfaces as CcTimeoutError", async () => {
    const { client } = makeClient({
      dataResponder: () => Promise.reject(new DOMException("timeout", "TimeoutError")),
    });
    await expect(client.patchProductDims("whp-1", dims)).rejects.toBeInstanceOf(CcTimeoutError);
  });

  it("non-abort errors are not converted to CcTimeoutError", async () => {
    const { client } = makeClient({
      dataResponder: () => Promise.reject(new TypeError("Failed to fetch")),
    });
    await expect(client.listProducts(1, 100)).rejects.toBeInstanceOf(TypeError);
  });

  it("each fetch call receives an AbortSignal", async () => {
    const { client, fetchMock } = makeClient({ dataResponder: () => json([]) });
    await client.listProducts(1, 100);
    const dataCall = fetchMock.mock.calls.find((c) => !String(c[0]).endsWith("/uaa/oauth/token"));
    if (!dataCall) throw new Error("no data call recorded");
    const init = dataCall[1] as RequestInit;
    expect(init.signal).toBeDefined();
    expect(typeof (init.signal as AbortSignal).aborted).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// M2a — bucket rejection happens before any data fetch
// ---------------------------------------------------------------------------

describe("M2a — CcRateLimitError before any fetch", () => {
  it("CcRateLimitError is not a subclass of CcApiError", () => {
    expect(new CcRateLimitError()).not.toBeInstanceOf(CcApiError);
  });

  it("empty sync bucket rejects patchProductDims before any data fetch", async () => {
    const { client, dataCalls } = makeClient({
      dataResponder: () => json([]),
      clock: () => 0,
      syncCapacity: 1,
    });
    // Drain the single sync token via a lookup (empty page → 1 token, 1 data call).
    await client.lookupByBarcode("b1");
    expect(dataCalls()).toBe(1);
    // patchProductDims now finds the sync bucket empty → rejects before any GET.
    await expect(client.patchProductDims("p", dims)).rejects.toBeInstanceOf(CcRateLimitError);
    expect(dataCalls()).toBe(1);
  });

  it("empty seed bucket rejects listProducts before any data fetch", async () => {
    const { client, dataCalls } = makeClient({
      dataResponder: () => json([]),
      clock: () => 0,
      seedCapacity: 1,
    });
    await client.listProducts(1, 100);
    expect(dataCalls()).toBe(1);
    await expect(client.listProducts(2, 100)).rejects.toBeInstanceOf(CcRateLimitError);
    expect(dataCalls()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// M2b — separate seed and sync buckets
// ---------------------------------------------------------------------------

describe("M2b — separate seed and sync buckets", () => {
  it("draining the seed bucket does NOT block sync calls", async () => {
    const { client } = makeClient({
      dataResponder: () => json([]),
      clock: () => 0,
      seedCapacity: 3,
      syncCapacity: 3,
    });
    await client.listProducts(1, 100);
    await client.listProducts(2, 100);
    await client.listProducts(3, 100);
    await expect(client.listProducts(4, 100)).rejects.toBeInstanceOf(CcRateLimitError);
    // Sync path still has its own budget.
    expect(await client.lookupByBarcode("b1")).toBeNull();
    expect(await client.lookupByBarcode("b2")).toBeNull();
  });

  it("draining the sync bucket does NOT block seed calls", async () => {
    const { client } = makeClient({
      dataResponder: () => json([]),
      clock: () => 0,
      seedCapacity: 3,
      syncCapacity: 2,
    });
    await client.lookupByBarcode("b1");
    await client.lookupByBarcode("b2");
    await expect(client.lookupByBarcode("b3")).rejects.toBeInstanceOf(CcRateLimitError);
    // Seed path still works.
    expect(await client.listProducts(1, 100)).toEqual([]);
    expect(await client.listProducts(2, 100)).toEqual([]);
  });

  it("each bucket refills independently at its configured rate", async () => {
    let t = 0;
    const { client } = makeClient({
      dataResponder: () => json([]),
      clock: () => t,
      seedCapacity: 1,
      syncCapacity: 1,
      seedRefillPerSec: 1,
      syncRefillPerSec: 1,
    });
    await client.listProducts(1, 100);
    await client.lookupByBarcode("b1");
    await expect(client.listProducts(2, 100)).rejects.toBeInstanceOf(CcRateLimitError);
    await expect(client.lookupByBarcode("b2")).rejects.toBeInstanceOf(CcRateLimitError);
    t += 1000; // each bucket refills exactly 1 token
    await client.listProducts(2, 100);
    await client.lookupByBarcode("b2");
  });

  /**
   * SUSTAINED-RATE regression: with the default rates (sync=40/60/sec,
   * seed=20/60/sec → 1 token/sec combined), 60 s of replenishment permits ≤ 60
   * calls (pre-fix it was ~120 with 1/sec each). Drain both, then measure 60 s.
   */
  it("sustained combined throughput over 60 s with default rates is ≤ 60 (not 120)", async () => {
    let t = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith("/uaa/oauth/token")) return json({ access_token: "tok", expires_in: 3600 });
      return json([]);
    });
    const c = new CcClient({
      clientId: "id",
      clientSecret: "secret",
      tenantId: TENANT,
      baseUrl: BASE,
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => t,
      // Default capacities + DEFAULT refill rates (what we're testing).
    });

    // Drain both buckets completely (start full at 40 + 20 = 60 burst).
    for (let i = 0; i < 200; i++) {
      let took = false;
      try { await c.listProducts(i, 10); took = true; } catch { /* empty */ }
      try { await c.lookupByBarcode(`b${i}`); took = true; } catch { /* empty */ }
      if (!took) break;
    }

    let sustainedOk = 0;
    for (let step = 1; step <= 60; step++) {
      t = step * 1000;
      for (let attempt = 0; attempt < 5; attempt++) {
        try { await c.listProducts(step * 10 + attempt, 10); sustainedOk++; } catch { /* limited */ }
        try { await c.lookupByBarcode(`b${step * 10 + attempt}`); sustainedOk++; } catch { /* limited */ }
      }
    }
    expect(sustainedOk).toBeLessThanOrEqual(60);
    expect(sustainedOk).toBeGreaterThanOrEqual(55);
  });

  it("default seed + sync capacity total does not exceed 60 (CC tenant ceiling)", async () => {
    const t = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith("/uaa/oauth/token")) return json({ access_token: "tok", expires_in: 3600 });
      return json([]);
    });
    const c = new CcClient({
      clientId: "id",
      clientSecret: "secret",
      tenantId: TENANT,
      baseUrl: BASE,
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => t,
    });
    let okCount = 0;
    for (let i = 0; i < 100; i++) {
      try { await c.listProducts(i, 10); okCount++; } catch (e) { if (!(e instanceof CcRateLimitError)) throw e; }
      try { await c.lookupByBarcode(`b${i}`); okCount++; } catch (e) { if (!(e instanceof CcRateLimitError)) throw e; }
    }
    expect(okCount).toBeLessThanOrEqual(60);
  });
});

// Keep the Forage customer id imported symbol referenced (guards against an
// accidental unused-import lint without weakening the suite).
void FORAGE_CUSTOMER_ID;
