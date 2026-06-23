import { describe, expect, it, vi } from "vitest";
import { CcApiError, CcClient, FORAGE_CUSTOMER_ID } from "../services/ccClient";

const BASE = "https://cc.test";
const TENANT = "t";

/** Mock fetch that auto-answers the token endpoint and delegates data calls. */
function makeClient(responder: (url: string) => Response | Promise<Response>) {
  const fetchMock = vi.fn((url: string) => {
    if (String(url).endsWith("/uaa/oauth/token")) {
      return json({ access_token: "tok", expires_in: 3600 });
    }
    return responder(String(url));
  });
  const client = new CcClient({
    clientId: "id",
    clientSecret: "secret",
    tenantId: TENANT,
    baseUrl: BASE,
    fetchImpl: fetchMock as unknown as typeof fetch,
  });
  return { client, fetchMock };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const raw = (id: string, code: string, over: Record<string, unknown> = {}) => ({
  id,
  references: { code },
  name: code,
  customer: { id: FORAGE_CUSTOMER_ID },
  defaultUnitOfMeasure: "EA",
  unitOfMeasures: { EA: { id: `${id}-ea`, name: "Each", barcode: `bc-${id}` } },
  ...over,
});

describe("CcClient.listProducts (warehouse-products v8 search)", () => {
  it("requests the search path with page + size and maps products", async () => {
    const { client, fetchMock } = makeClient(() =>
      json([
        raw("p1", "ONE", {
          unitOfMeasures: { EA: { id: "p1-ea", name: "Each", barcode: "b1", length: 0.1, width: 0.05, height: 0.02, weight: 1 } },
        }),
        raw("p2", "TWO"),
      ]),
    );

    const products = await client.listProducts(1, 100);

    const dataCall = fetchMock.mock.calls.find((c) => !String(c[0]).endsWith("/uaa/oauth/token"));
    if (!dataCall) throw new Error("no data call recorded");
    const url = new URL(dataCall[0] as string);
    expect(url.origin + url.pathname).toBe(`${BASE}/tenants/${TENANT}/warehouse-products/search`);
    expect(url.searchParams.get("page")).toBe("1");
    expect(url.searchParams.get("size")).toBe("100");

    expect(products).toHaveLength(2);
    expect(products[0]).toEqual({ id: "p1", code: "ONE", barcode: "b1", name: "ONE", length: 0.1, width: 0.05, height: 0.02, weight: 1 });
    expect(products[1].length).toBeNull();
  });

  it("treats a 404 page as the end of the result set (empty)", async () => {
    const { client } = makeClient(() => new Response("", { status: 404 }));
    expect(await client.listProducts(5, 100)).toEqual([]);
  });

  it("throws CcApiError on a non-2xx (non-404) response", async () => {
    const { client } = makeClient(() => new Response("boom", { status: 500 }));
    await expect(client.listProducts(1, 100)).rejects.toBeInstanceOf(CcApiError);
  });
});
