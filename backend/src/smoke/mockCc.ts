/**
 * DEV / SMOKE ONLY — a minimal in-container CartonCloud stand-in for the
 * sku-seed smoke test. NEVER run by the production CMD (which is
 * `prisma migrate deploy && node dist/index.js`).
 *
 * Serves the two CC endpoints sku-seed exercises against `CC_BASE_URL`:
 *   GET /products?warehouseAccountId=&page=&pageSize=   → seed list page
 *   GET /products?barcode=&warehouseAccountId=          → barcode lookup
 *
 * The catalogue is fixed and small: three products returned by the list pull
 * (one already carrying dims in CC), plus one extra product that is ONLY
 * reachable via barcode lookup — that proves the DB-miss → CC-fallback path.
 */
import http from "node:http";
import { logger } from "../middleware/logger";

const log = logger.child({ module: "mockCc" });
const PORT = Number(process.env.MOCK_PORT ?? "9099");

interface MockProduct {
  id: string;
  barcode: string;
  name: string;
  length: number | null;
  width: number | null;
  height: number | null;
  weight: number | null;
}

const noDims = { length: null, width: null, height: null, weight: null };

// Products returned by the seed list pull.
const LIST: MockProduct[] = [
  { id: "cc-1", barcode: "9311111000011", name: "Forage Granola 500g", length: 300, width: 200, height: 150, weight: 0.5 },
  { id: "cc-2", barcode: "9311111000028", name: "Forage Muesli 1kg", ...noDims },
  { id: "cc-3", barcode: "9311111000035", name: "Forage Oats 750g", ...noDims },
];

// CC-only product — not in the list pages, only resolvable by barcode lookup.
const CC_ONLY: MockProduct = {
  id: "cc-9",
  barcode: "9311111000099",
  name: "Forage Trail Mix 250g (CC only)",
  ...noDims,
};

const LOOKUP: Record<string, MockProduct> = Object.fromEntries(
  [...LIST, CC_ONLY].map((p) => [p.barcode, p]),
);

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (req.method === "GET" && url.pathname === "/products") {
    const barcode = url.searchParams.get("barcode");

    // Barcode lookup branch.
    if (barcode !== null) {
      const hit = LOOKUP[barcode];
      if (!hit) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      sendJson(res, 200, [hit]);
      return;
    }

    // List branch — page 1 has the catalogue, every later page is empty.
    const page = Number(url.searchParams.get("page") ?? "1");
    sendJson(res, 200, page === 1 ? LIST : []);
    return;
  }

  sendJson(res, 404, { error: "unhandled route" });
});

server.listen(PORT, () => {
  log.info({ port: PORT, listCount: LIST.length }, "mock CartonCloud listening");
});
