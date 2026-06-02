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

describe("errorHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("responds with AppError statusCode and message", () => {
    const res = makeRes();
    const err = new AppError("resource not found", 404);
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "resource not found" });
  });

  it("responds 500 for generic Error", () => {
    const res = makeRes();
    errorHandler(new Error("boom"), req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "boom" });
  });

  it("responds 500 with fallback message for non-Error throws", () => {
    const res = makeRes();
    errorHandler("some string error", req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });
  });
});
