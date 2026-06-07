import { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../lib/errors";
import { errorHandler } from "../middleware/errorHandler";

function makeRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

const req = {} as Request;
const next = vi.fn() as unknown as NextFunction;

/** A body-parser-style error: plain Error with a numeric status/statusCode. */
function bodyParserError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

describe("errorHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  // AppError: keep the intended status + message (they are deliberate, safe).
  it("responds with AppError statusCode and message", () => {
    const res = makeRes();
    const err = new AppError("resource not found", 404);
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "resource not found" });
  });

  // S1 — unknown errors must NOT echo err.message to the client.
  it("responds 500 with generic message for an unknown Error (S1 — no leak)", () => {
    const res = makeRes();
    // Simulates a Prisma/Postgres error whose message contains the DSN.
    errorHandler(new Error("connect ECONNREFUSED postgres:5432"), req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });
    // The raw message must not appear in the client payload.
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as { error: string };
    expect(body.error).not.toContain("postgres");
  });

  it("responds 500 with generic message for non-Error throws (S1)", () => {
    const res = makeRes();
    errorHandler("some string error", req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });
  });

  // S2 — body-parser raises errors with err.status / err.statusCode; honour them.
  it("responds 400 for a body-parser SyntaxError (bad JSON) — S2", () => {
    const res = makeRes();
    errorHandler(bodyParserError(400, "Unexpected token < in JSON"), req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid request body" });
  });

  it("responds 413 for a body-parser payload-too-large error — S2", () => {
    const res = makeRes();
    const err = bodyParserError(413, "request entity too large");
    // body-parser sometimes uses statusCode, not status.
    const errWithStatusCode = err as Error & { status: number; statusCode: number };
    errWithStatusCode.statusCode = 413;
    errorHandler(errWithStatusCode, req, res, next);
    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith({ error: "Payload too large" });
  });

  it("does NOT promote a 5xx body-parser error to a specific message (falls through to 500 generic)", () => {
    // A non-4xx status on a non-AppError must still return a generic 500.
    const res = makeRes();
    errorHandler(bodyParserError(500, "some internal parse failure"), req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });
  });
});
