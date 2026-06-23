/**
 * cc-client smoke server — DEV/SMOKE ONLY.
 *
 * NEVER run by the production CMD. It stands up an in-process mock CartonCloud
 * speaking the v8 OAuth2 / warehouse-products contract (module 16), points a
 * `CcClient` at it, and exposes a tiny HTTP surface the harness curls:
 *   GET  /smoke/health            → 200 once the boot self-test passed
 *   GET  /smoke/lookup?barcode=   → ccClient.lookupByBarcode against the mock
 *   POST /smoke/patch             → ccClient.patchProductDims (write + read-back)
 *   GET  /smoke/notfound          → proves CcNotFoundError on an unknown id
 *   GET  /smoke/ratelimit         → proves CcRateLimitError when the bucket drains
 *
 * Run: `node dist/smoke/ccClientSmoke.js` (see modules/cc-client/docker-compose.smoke.yml).
 */
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { logger } from "../middleware/logger";
import {
  CcClient,
  CcNotFoundError,
  CcRateLimitError,
  FORAGE_CUSTOMER_ID,
  type CcDimPayload,
} from "../services/ccClient";

const log = logger.child({ module: "ccClientSmoke" });

const SMOKE_PORT = Number(process.env.SMOKE_PORT ?? 3006);
const MOCK_PORT = Number(process.env.MOCK_PORT ?? 9099);
const TENANT = "smoke-tenant";

const KNOWN_BARCODE = "9300675024635";
const KNOWN_ID = "prod-1";

interface SmokeUom {
  id: string;
  name: string;
  barcode?: string;
  length?: number;
  width?: number;
  height?: number;
  weight?: number;
}
interface SmokeProduct {
  id: string;
  references: { code: string };
  name: string;
  customer: { id: string };
  defaultUnitOfMeasure: string;
  unitOfMeasures: Record<string, SmokeUom>;
}

// Mutable so PATCH writes persist for the client's read-back verify.
const KNOWN_PRODUCT: SmokeProduct = {
  id: KNOWN_ID,
  references: { code: "CDM-200" },
  name: "Cadbury Dairy Milk 200g",
  customer: { id: FORAGE_CUSTOMER_ID },
  defaultUnitOfMeasure: "EA",
  unitOfMeasures: { EA: { id: "ea-1", name: "Each", barcode: KNOWN_BARCODE } },
};

// ---------- in-process mock CartonCloud (v8) ----------

function mockCcHandler(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${MOCK_PORT}`);
  const method = req.method ?? "GET";
  const path = url.pathname;

  if (method === "POST" && path === "/uaa/oauth/token") {
    return sendRaw(res, 200, { access_token: "smoke-tok", expires_in: 3600 });
  }

  const wp = path.match(/\/tenants\/[^/]+\/warehouse-products(\/.*)?$/);
  if (wp) {
    const rest = wp[1] ?? "";
    if (method === "POST" && rest.startsWith("/search")) {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const page = Number(url.searchParams.get("page") ?? "1");
        sendRaw(res, 200, page === 1 ? [KNOWN_PRODUCT] : []);
      });
      return;
    }
    const idMatch = rest.match(/^\/([^/?]+)/);
    if (idMatch) {
      const id = decodeURIComponent(idMatch[1]);
      if (id !== KNOWN_ID) return sendRaw(res, 404, { error: "not found" });
      if (method === "GET") return sendRaw(res, 200, KNOWN_PRODUCT);
      if (method === "PATCH") {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          const ops = JSON.parse(Buffer.concat(chunks).toString() || "[]") as Array<{
            path: string;
            value: number;
          }>;
          for (const op of ops) {
            const m = op.path.match(/^\/unitOfMeasures\/([^/]+)\/(\w+)$/);
            if (m && KNOWN_PRODUCT.unitOfMeasures[m[1]]) {
              (KNOWN_PRODUCT.unitOfMeasures[m[1]] as unknown as Record<string, number>)[m[2]] = op.value;
            }
          }
          sendRaw(res, 200, { id, ok: true });
        });
        return;
      }
    }
  }

  sendRaw(res, 404, { error: "unhandled" });
}

// ---------- smoke client + helpers ----------

const baseUrl = `http://127.0.0.1:${MOCK_PORT}`;
const cc = new CcClient({
  clientId: "smoke-id",
  clientSecret: "smoke-secret",
  tenantId: TENANT,
  baseUrl,
});

const sampleDims: CcDimPayload = { length: 300, width: 200, height: 150, weight: 2.4 };

let bootOk = false;
let bootDetail = "pending";

/** Boot self-test: one happy round trip through the real ccClient + mock. */
async function selfTest(): Promise<void> {
  const found = await cc.lookupByBarcode(KNOWN_BARCODE);
  if (!found || found.id !== KNOWN_ID) throw new Error("lookup(known) did not return the product");

  const missing = await cc.lookupByBarcode("0000000000000");
  if (missing !== null) throw new Error("lookup(missing) should be null");

  const outcome = await cc.patchProductDims(KNOWN_ID, sampleDims);
  if (outcome.status !== "written") {
    throw new Error(`expected a written dims outcome, got ${outcome.status}`);
  }
}

function sendRaw(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
const send = sendRaw;

// ---------- smoke HTTP surface ----------

async function smokeHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${SMOKE_PORT}`);
  const method = req.method ?? "GET";

  try {
    if (method === "GET" && url.pathname === "/smoke/health") {
      return send(res, bootOk ? 200 : 503, { status: bootOk ? "ok" : "error", detail: bootDetail });
    }

    if (method === "GET" && url.pathname === "/smoke/lookup") {
      const barcode = url.searchParams.get("barcode") ?? "";
      const product = await cc.lookupByBarcode(barcode);
      return send(res, 200, { found: product !== null, product });
    }

    if (method === "POST" && url.pathname === "/smoke/patch") {
      const outcome = await cc.patchProductDims(KNOWN_ID, sampleDims);
      return send(res, 200, { outcome });
    }

    if (method === "GET" && url.pathname === "/smoke/notfound") {
      try {
        await cc.patchProductDims("ghost-999", sampleDims);
        return send(res, 500, { error: "expected CcNotFoundError, got success" });
      } catch (e) {
        const ok = e instanceof CcNotFoundError;
        return send(res, ok ? 200 : 500, { notFoundErrorRaised: ok, type: (e as Error).name });
      }
    }

    if (method === "GET" && url.pathname === "/smoke/ratelimit") {
      // Fresh client, sync capacity 2, frozen clock → the 3rd lookup is rejected
      // before any HTTP call is made.
      const tiny = new CcClient({
        clientId: "smoke-id",
        clientSecret: "smoke-secret",
        tenantId: TENANT,
        baseUrl,
        syncCapacity: 2,
        now: () => 0,
      });
      await tiny.lookupByBarcode(KNOWN_BARCODE);
      await tiny.lookupByBarcode(KNOWN_BARCODE);
      try {
        await tiny.lookupByBarcode(KNOWN_BARCODE);
        return send(res, 500, { error: "expected CcRateLimitError, got success" });
      } catch (e) {
        const ok = e instanceof CcRateLimitError;
        return send(res, ok ? 200 : 500, { rateLimitErrorRaised: ok, type: (e as Error).name });
      }
    }

    return send(res, 404, { error: "unknown smoke route" });
  } catch (e) {
    log.error({ err: e }, "smoke handler error");
    return send(res, 500, { error: (e as Error).message });
  }
}

// ---------- boot ----------

const mockServer = http.createServer(mockCcHandler);
const smokeServer = http.createServer((req, res) => {
  void smokeHandler(req, res);
});

mockServer.listen(MOCK_PORT, "127.0.0.1", () => {
  log.info({ port: MOCK_PORT }, "mock CartonCloud (v8) listening");
  selfTest()
    .then(() => {
      bootOk = true;
      bootDetail = "self-test passed";
      log.info("cc-client smoke self-test passed");
    })
    .catch((e: unknown) => {
      bootOk = false;
      bootDetail = (e as Error).message;
      log.error({ err: e }, "cc-client smoke self-test FAILED");
    })
    .finally(() => {
      smokeServer.listen(SMOKE_PORT, () => {
        log.info({ port: SMOKE_PORT }, "cc-client smoke server listening");
      });
    });
});

function shutdown(): void {
  smokeServer.close();
  mockServer.close();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
