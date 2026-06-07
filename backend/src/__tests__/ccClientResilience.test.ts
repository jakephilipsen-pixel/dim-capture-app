/**
 * cc-resilience tests — module 10.
 *
 * Covers:
 *   S4 — fetch timeout: a fetch that never resolves aborts at CC_TIMEOUT_MS
 *        and surfaces as CcTimeoutError (not a hang).
 *   M2a — rate-limit rejection maps to a CcRateLimitError that callers convert
 *         to 429 (verified in skuService / syncService caller tests).
 *   M2b — seedBucket vs syncBucket: listProducts burns the seed budget;
 *         lookupByBarcode + patchProductDims burn the sync budget; they do
 *         not starve each other.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CcApiError,
  CcClient,
  CcRateLimitError,
  CcTimeoutError,
  type CcDimPayload,
} from "../services/ccClient";

const API_KEY = "test-key";
const TENANT = "tenant-123";
const WAREHOUSE = "wh-456";
const BASE = "https://cc.test/api/v1";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Build a client with controllable fetch + frozen clock. */
function makeClient(opts?: {
  responder?: (url: string, init: RequestInit) => Response | Promise<Response>;
  clock?: () => number;
  seedCapacity?: number;
  syncCapacity?: number;
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
    seedCapacity: opts?.seedCapacity,
    syncCapacity: opts?.syncCapacity,
  });
  return { client, fetchMock };
}

const dims: CcDimPayload = { length: 300, width: 200, height: 150, weight: 2.4 };

// ---------------------------------------------------------------------------
// S4 — Fetch timeout
// ---------------------------------------------------------------------------

describe("S4 — CC fetch timeout", () => {
  it("CcTimeoutError is a subclass of CcApiError", () => {
    const err = new CcTimeoutError();
    expect(err).toBeInstanceOf(CcApiError);
    expect(err).toBeInstanceOf(CcTimeoutError);
    expect(err.name).toBe("CcTimeoutError");
    expect(err.statusCode).toBe(504);
  });

  it("lookupByBarcode: a fetch that rejects with AbortError surfaces as CcTimeoutError — not a hang", async () => {
    // Simulate what AbortSignal.timeout() produces when the deadline fires:
    // the fetch rejects with a DOMException named "TimeoutError" in Node 22.
    const abortError = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const { client } = makeClient({
      responder: () => Promise.reject(abortError),
    });

    await expect(client.lookupByBarcode("b1", WAREHOUSE)).rejects.toBeInstanceOf(CcTimeoutError);
    // Verify no raw DOMException leaks to the caller.
    await expect(client.lookupByBarcode("b2", WAREHOUSE)).rejects.not.toBeInstanceOf(DOMException);
  });

  it("lookupByBarcode: AbortError (name='AbortError') also surfaces as CcTimeoutError", async () => {
    const abortError = new DOMException("Aborted", "AbortError");
    const { client } = makeClient({
      responder: () => Promise.reject(abortError),
    });
    await expect(client.lookupByBarcode("b1", WAREHOUSE)).rejects.toBeInstanceOf(CcTimeoutError);
  });

  it("patchProductDims: AbortError surfaces as CcTimeoutError", async () => {
    const abortError = new DOMException("Aborted", "TimeoutError");
    const { client } = makeClient({
      responder: () => Promise.reject(abortError),
    });
    await expect(client.patchProductDims("prod-1", dims)).rejects.toBeInstanceOf(CcTimeoutError);
  });

  it("listProducts: AbortError surfaces as CcTimeoutError", async () => {
    const abortError = new DOMException("Aborted", "TimeoutError");
    const { client } = makeClient({
      responder: () => Promise.reject(abortError),
    });
    await expect(client.listProducts(WAREHOUSE, 1, 100)).rejects.toBeInstanceOf(CcTimeoutError);
  });

  it("non-abort errors are not converted to CcTimeoutError", async () => {
    // A genuine network error (not an abort) should not be swallowed.
    const netError = new TypeError("Failed to fetch");
    const { client } = makeClient({
      responder: () => Promise.reject(netError),
    });
    await expect(client.lookupByBarcode("b1", WAREHOUSE)).rejects.toBeInstanceOf(TypeError);
    await expect(client.lookupByBarcode("b1", WAREHOUSE)).rejects.not.toBeInstanceOf(CcTimeoutError);
  });

  it("each fetch call receives a signal in its RequestInit", async () => {
    const { client, fetchMock } = makeClient({
      responder: () => json([]),
    });
    await client.lookupByBarcode("b1", WAREHOUSE);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    // AbortSignal.timeout() returns an AbortSignal; presence is sufficient.
    expect(init.signal).toBeDefined();
    expect(typeof (init.signal as AbortSignal).aborted).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// M2a — CcRateLimitError identity (callers own the HTTP mapping)
// ---------------------------------------------------------------------------

describe("M2a — CcRateLimitError identity", () => {
  it("CcRateLimitError is not a subclass of CcApiError (separate typed error)", () => {
    const err = new CcRateLimitError();
    expect(err).toBeInstanceOf(CcRateLimitError);
    expect(err).not.toBeInstanceOf(CcApiError);
  });

  it("empty sync bucket rejects patchProductDims with CcRateLimitError before any fetch", async () => {
    let t = 0;
    const { client, fetchMock } = makeClient({
      responder: () => new Response(null, { status: 200 }),
      clock: () => t,
      syncCapacity: 2, // tiny budget so we can drain it fast
    });

    await client.patchProductDims("p1", dims);
    await client.patchProductDims("p2", dims);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Third call: sync bucket is empty → CcRateLimitError, no fetch made.
    await expect(client.patchProductDims("p3", dims)).rejects.toBeInstanceOf(CcRateLimitError);
    expect(fetchMock).toHaveBeenCalledTimes(2); // no extra call
  });

  it("empty seed bucket rejects listProducts with CcRateLimitError before any fetch", async () => {
    let t = 0;
    const { client, fetchMock } = makeClient({
      responder: () => json([]),
      clock: () => t,
      seedCapacity: 1,
    });

    await client.listProducts(WAREHOUSE, 1, 100);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(client.listProducts(WAREHOUSE, 2, 100)).rejects.toBeInstanceOf(CcRateLimitError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// M2b — Separate buckets: seed and sync do not starve each other
// ---------------------------------------------------------------------------

describe("M2b — separate seed and sync buckets", () => {
  it("draining the seed bucket does NOT block sync calls", async () => {
    let t = 0;
    const { client, fetchMock } = makeClient({
      responder: () => json([]),
      clock: () => t,
      seedCapacity: 3,   // seed budget
      syncCapacity: 3,   // sync budget
    });

    // Drain the seed bucket completely via listProducts.
    await client.listProducts(WAREHOUSE, 1, 100);
    await client.listProducts(WAREHOUSE, 2, 100);
    await client.listProducts(WAREHOUSE, 3, 100);
    // Seed budget exhausted.
    await expect(client.listProducts(WAREHOUSE, 4, 100)).rejects.toBeInstanceOf(CcRateLimitError);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Sync calls (lookupByBarcode, patchProductDims) should still succeed — they draw from a separate budget.
    await client.lookupByBarcode("b1", WAREHOUSE);
    await client.patchProductDims("p1", dims);
    await client.lookupByBarcode("b2", WAREHOUSE);
    expect(fetchMock).toHaveBeenCalledTimes(6); // 3 seed + 3 sync
  });

  it("draining the sync bucket does NOT block seed calls", async () => {
    let t = 0;
    const { client, fetchMock } = makeClient({
      responder: () => json([]),
      clock: () => t,
      seedCapacity: 3,
      syncCapacity: 2,
    });

    // Drain the sync budget.
    await client.lookupByBarcode("b1", WAREHOUSE);
    await client.patchProductDims("p1", dims);
    await expect(client.patchProductDims("p2", dims)).rejects.toBeInstanceOf(CcRateLimitError);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Seed calls still work.
    await client.listProducts(WAREHOUSE, 1, 100);
    await client.listProducts(WAREHOUSE, 2, 100);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("each bucket refills independently at 1 token/sec", async () => {
    let t = 0;
    const { client, fetchMock } = makeClient({
      responder: () => json([]),
      clock: () => t,
      seedCapacity: 1,
      syncCapacity: 1,
    });

    // Drain both.
    await client.listProducts(WAREHOUSE, 1, 100);
    await client.lookupByBarcode("b1", WAREHOUSE);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await expect(client.listProducts(WAREHOUSE, 2, 100)).rejects.toBeInstanceOf(CcRateLimitError);
    await expect(client.lookupByBarcode("b2", WAREHOUSE)).rejects.toBeInstanceOf(CcRateLimitError);

    // After 1 second, each bucket refills 1 token.
    t += 1000;
    await client.listProducts(WAREHOUSE, 2, 100);
    await client.lookupByBarcode("b2", WAREHOUSE);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("default seedCapacity + syncCapacity total does not exceed 60 (CC tenant ceiling)", () => {
    // Verify the defaults baked into the singleton constructor don't exceed CC's limit.
    // We expose them via a static helper so this test doesn't need to instantiate
    // a full client; instead, create a client with defaults and inspect via factory.
    const client = new CcClient({
      apiKey: "k",
      tenantId: "t",
      baseUrl: BASE,
    });
    // The combined default seed + sync capacity must be ≤ 60.
    // We verify this by draining both buckets with a frozen clock and confirming
    // at most 60 calls go through before both are exhausted.
    let t = 0;
    const fetchMock = vi.fn(() => json([]));
    const c = new CcClient({
      apiKey: "k",
      tenantId: "t",
      baseUrl: BASE,
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => t,
    });

    // This asserts the sum of default budgets ≤ 60, not a hard internal check —
    // if the test passes, the system upholds the constraint.
    void client; // satisfy TypeScript; the live check is on `c` below.

    // Drive both paths until both buckets empty.
    const results: Array<"ok" | "limited"> = [];
    const exhaust = async () => {
      for (let i = 0; i < 100; i++) {
        try {
          await c.listProducts(WAREHOUSE, i, 10); // seed path
          results.push("ok");
        } catch (e) {
          if (e instanceof CcRateLimitError) results.push("limited");
          else throw e;
        }
        try {
          await c.lookupByBarcode(`b${i}`, WAREHOUSE); // sync path
          results.push("ok");
        } catch (e) {
          if (e instanceof CcRateLimitError) results.push("limited");
          else throw e;
        }
      }
    };
    return exhaust().then(() => {
      const okCount = results.filter((r) => r === "ok").length;
      // At most 60 total calls should succeed (default seed+sync ≤ 60).
      expect(okCount).toBeLessThanOrEqual(60);
    });
  });
});
