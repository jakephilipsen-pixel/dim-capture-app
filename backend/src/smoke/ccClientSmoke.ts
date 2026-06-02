/**
 * cc-client smoke server — DEV/SMOKE ONLY.
 *
 * This entry is NEVER run by the production CMD (`prisma migrate deploy &&
 * node dist/index.js`). It exists so the container-based smoke harness can
 * exercise the route-less `ccClient` at runtime in the real backend image,
 * with ZERO real CartonCloud calls.
 *
 * It stands up an in-process mock CC server, points a `CcClient` at it, and
 * exposes a tiny HTTP surface the harness curls:
 *   GET  /smoke/health            → 200 once the boot self-test passed
 *   GET  /smoke/lookup?barcode=   → runs ccClient.lookupByBarcode against the mock
 *   POST /smoke/patch             → runs ccClient.patchProductDims against the mock
 *   GET  /smoke/notfound          → proves CcNotFoundError on a 404 PATCH
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
  type CcDimPayload,
} from "../services/ccClient";

const log = logger.child({ module: "ccClientSmoke" });

const SMOKE_PORT = Number(process.env.SMOKE_PORT ?? 3006);
const MOCK_PORT = Number(process.env.MOCK_PORT ?? 9099);

const KNOWN_BARCODE = "9300675024635";
const KNOWN_ID = "prod-1";
const KNOWN_PRODUCT = {
  id: KNOWN_ID,
  barcode: KNOWN_BARCODE,
  name: "Cadbury Dairy Milk 200g",
  length: 300,
  width: 200,
  height: 150,
  weight: 2.4,
};

let lastPatchedBody: unknown = null;

// ---------- in-process mock CartonCloud ----------

function mockCcHandler(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${MOCK_PORT}`);
  const method = req.method ?? "GET";

  // GET /products?barcode=&warehouseAccountId=
  if (method === "GET" && url.pathname === "/products") {
    const barcode = url.searchParams.get("barcode");
    if (barcode === KNOWN_BARCODE) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([KNOWN_PRODUCT]));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    }
    return;
  }

  // PATCH /products/{id}
  if (method === "PATCH" && url.pathname.startsWith("/products/")) {
    const id = decodeURIComponent(url.pathname.slice("/products/".length));
    if (id.startsWith("ghost")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      lastPatchedBody = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id, ok: true }));
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "unhandled" }));
}

// ---------- smoke client + helpers ----------

const baseUrl = `http://127.0.0.1:${MOCK_PORT}`;
const cc = new CcClient({ apiKey: "smoke-key", tenantId: "smoke-tenant", baseUrl });

const sampleDims: CcDimPayload = { length: 300, width: 200, height: 150, weight: 2.4 };

let bootOk = false;
let bootDetail = "pending";

/** Boot self-test: one happy round trip through the real ccClient + mock. */
async function selfTest(): Promise<void> {
  const found = await cc.lookupByBarcode(KNOWN_BARCODE, "wh-smoke");
  if (!found || found.id !== KNOWN_ID) throw new Error("lookup(known) did not return the product");

  const missing = await cc.lookupByBarcode("0000000000000", "wh-smoke");
  if (missing !== null) throw new Error("lookup(missing) should be null");

  await cc.patchProductDims(KNOWN_ID, sampleDims);
  if (JSON.stringify(lastPatchedBody) !== JSON.stringify(sampleDims)) {
    throw new Error("patch body did not pass through unchanged");
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

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
      const product = await cc.lookupByBarcode(barcode, "wh-smoke");
      return send(res, 200, { found: product !== null, product });
    }

    if (method === "POST" && url.pathname === "/smoke/patch") {
      await cc.patchProductDims(KNOWN_ID, sampleDims);
      return send(res, 200, { patched: true, sent: sampleDims });
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
      // Fresh client, capacity 2, frozen clock → the 3rd call must be rejected
      // before any HTTP call is made.
      const tiny = new CcClient({
        apiKey: "smoke-key",
        tenantId: "smoke-tenant",
        baseUrl,
        capacity: 2,
        now: () => 0,
      });
      await tiny.lookupByBarcode(KNOWN_BARCODE, "wh-smoke");
      await tiny.lookupByBarcode(KNOWN_BARCODE, "wh-smoke");
      try {
        await tiny.lookupByBarcode(KNOWN_BARCODE, "wh-smoke");
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
  log.info({ port: MOCK_PORT }, "mock CartonCloud listening");
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
