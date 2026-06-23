/**
 * DEV / SMOKE ONLY — a minimal in-container CartonCloud stand-in speaking the
 * validated v8 OAuth2 / warehouse-products contract (module 16). NEVER run by the
 * production CMD (`prisma migrate deploy && node dist/index.js`).
 *
 * Serves the endpoints the backend exercises against `CC_BASE_URL`:
 *   POST  /uaa/oauth/token                              → OAuth2 token
 *   POST  /tenants/{t}/warehouse-products/search?page=&size= → seed/lookup pages
 *   GET   /tenants/{t}/warehouse-products/{id}          → read (incl. read-back)
 *   PATCH /tenants/{t}/warehouse-products/{id}          → JSON-Patch op:add dims
 *
 * Stateful: PATCHes mutate the in-memory UoM dims so the client's read-back
 * verify passes. The catalogue includes a name-poisoned product (a 2-char `CT`
 * UoM name) to prove the blocked path.
 */
import http from "node:http";
import { logger } from "../middleware/logger";

const log = logger.child({ module: "mockCc" });
const PORT = Number(process.env.MOCK_PORT ?? "9099");
const CUSTOMER_ID = "d4810e1e-91ab-43ed-b68e-b72bd858b122"; // The Forage Company

interface Uom {
  id: string;
  name: string;
  barcode?: string;
  length?: number;
  width?: number;
  height?: number;
  weight?: number;
}
interface WhProduct {
  id: string;
  references: { code: string };
  name: string;
  customer: { id: string };
  defaultUnitOfMeasure: string;
  unitOfMeasures: Record<string, Uom>;
}

// Mutable catalogue (PATCH writes into it; GET read-back reflects it).
const CATALOGUE: Record<string, WhProduct> = {
  "whp-1": {
    id: "whp-1",
    references: { code: "FG-GRA" },
    name: "Forage Granola 500g",
    customer: { id: CUSTOMER_ID },
    defaultUnitOfMeasure: "EA",
    unitOfMeasures: {
      EA: { id: "uom-ea-1", name: "Each", barcode: "9311111000011" },
      PLT: { id: "uom-plt-1", name: "Pallet" },
    },
  },
  // Name-poisoned: the CT UoM name is 2 chars (< CC's 3-char floor) → any dims
  // PATCH on this product 422s, so the client must mark it blocked (no PATCH).
  "whp-2": {
    id: "whp-2",
    references: { code: "FG-MUE" },
    name: "Forage Muesli 1kg",
    customer: { id: CUSTOMER_ID },
    defaultUnitOfMeasure: "EA",
    unitOfMeasures: {
      EA: { id: "uom-ea-2", name: "Each", barcode: "9311111000028" },
      CT: { id: "uom-ct-2", name: "CT", barcode: "29311111000025" },
    },
  },
};

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;

  // OAuth2 token (not tenant-scoped).
  if (req.method === "POST" && path === "/uaa/oauth/token") {
    sendJson(res, 200, { access_token: "mock-token", token_type: "bearer", expires_in: 3600 });
    return;
  }

  const wpBase = path.match(/\/tenants\/[^/]+\/warehouse-products(\/.*)?$/);
  if (wpBase) {
    const rest = wpBase[1] ?? "";

    // Search: page 1 → catalogue, later pages → empty.
    if (req.method === "POST" && rest.startsWith("/search")) {
      await readBody(req);
      const page = Number(url.searchParams.get("page") ?? "1");
      sendJson(res, 200, page === 1 ? Object.values(CATALOGUE) : []);
      return;
    }

    // /{id} read or patch.
    const idMatch = rest.match(/^\/([^/?]+)/);
    if (idMatch) {
      const id = decodeURIComponent(idMatch[1]);
      const product = CATALOGUE[id];
      if (!product) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      if (req.method === "GET") {
        sendJson(res, 200, product);
        return;
      }
      if (req.method === "PATCH") {
        const raw = await readBody(req);
        // Mimic CC: validate the WHOLE UoM name set first — a bad name 422s.
        const bad = Object.values(product.unitOfMeasures).find(
          (u) => u.name.length < 3 || u.name.length > 64,
        );
        if (bad) {
          sendJson(res, 422, {
            field: `/unitOfMeasures/${bad.name}/name`,
            message: "Must be between 3 and 64 characters.",
          });
          return;
        }
        const ops = JSON.parse(raw) as Array<{ op: string; path: string; value: number }>;
        for (const op of ops) {
          const m = op.path.match(/^\/unitOfMeasures\/([^/]+)\/(length|width|height|weight)$/);
          if (m && product.unitOfMeasures[m[1]]) {
            (product.unitOfMeasures[m[1]] as unknown as Record<string, number>)[m[2]] = op.value;
          }
        }
        sendJson(res, 200, { id, updated: true });
        return;
      }
    }
  }

  sendJson(res, 404, { error: "unhandled route" });
});

server.listen(PORT, () => {
  log.info({ port: PORT, products: Object.keys(CATALOGUE).length }, "mock CartonCloud (v8) listening");
});
