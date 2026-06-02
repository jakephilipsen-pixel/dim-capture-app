import { describe, expect, it, vi } from "vitest";
import { CcApiError, CcClient } from "../services/ccClient";

const BASE = "https://cc.test/api/v1";
const WAREHOUSE = "wh-456";

function makeClient(responder: (url: string) => Response | Promise<Response>) {
  const fetchMock = vi.fn((url: string) => responder(url));
  const client = new CcClient({
    apiKey: "k",
    tenantId: "t",
    baseUrl: BASE,
    fetchImpl: fetchMock as unknown as typeof fetch,
  });
  return { client, fetchMock };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("CcClient.listProducts", () => {
  it("requests the right URL with page + pageSize and maps products", async () => {
    const { client, fetchMock } = makeClient(() =>
      json([
        { id: "p1", barcode: "b1", name: "One", length: 10, width: 5, height: 2, weight: 1 },
        { id: "p2", barcode: "b2", name: "Two", length: null, width: null, height: null, weight: null },
      ]),
    );

    const products = await client.listProducts(WAREHOUSE, 1, 100);

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe(`${BASE}/products`);
    expect(url.searchParams.get("warehouseAccountId")).toBe(WAREHOUSE);
    expect(url.searchParams.get("page")).toBe("1");
    expect(url.searchParams.get("pageSize")).toBe("100");

    expect(products).toHaveLength(2);
    expect(products[0]).toEqual({
      id: "p1",
      barcode: "b1",
      name: "One",
      length: 10,
      width: 5,
      height: 2,
      weight: 1,
    });
    expect(products[1].length).toBeNull();
  });

  it("unwraps a { data: [...] } envelope", async () => {
    const { client } = makeClient(() =>
      json({ data: [{ id: "p9", barcode: "b9", name: "Nine" }] }),
    );

    const products = await client.listProducts(WAREHOUSE, 2, 100);

    expect(products).toHaveLength(1);
    expect(products[0].id).toBe("p9");
  });

  it("treats a 404 page as the end of the result set (empty)", async () => {
    const { client } = makeClient(() => new Response("", { status: 404 }));
    const products = await client.listProducts(WAREHOUSE, 5, 100);
    expect(products).toEqual([]);
  });

  it("throws CcApiError on a non-2xx (non-404) response", async () => {
    const { client } = makeClient(() => new Response("boom", { status: 500 }));
    await expect(client.listProducts(WAREHOUSE, 1, 100)).rejects.toBeInstanceOf(CcApiError);
  });
});
