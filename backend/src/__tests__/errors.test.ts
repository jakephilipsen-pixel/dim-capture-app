import { describe, expect, it } from "vitest";
import { AppError } from "../lib/errors";

describe("AppError", () => {
  it("sets message and statusCode", () => {
    const err = new AppError("not found", 404);
    expect(err.message).toBe("not found");
    expect(err.statusCode).toBe(404);
  });

  it("is an instance of Error", () => {
    const err = new AppError("bad request", 400);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
  });

  it("has name AppError", () => {
    const err = new AppError("forbidden", 403);
    expect(err.name).toBe("AppError");
  });

  it("survives prototype chain check across instanceof boundaries", () => {
    const err = new AppError("test", 500);
    // Simulates what happens when instanceof is checked after crossing a module boundary
    expect(Object.getPrototypeOf(err)).toBe(AppError.prototype);
  });
});
