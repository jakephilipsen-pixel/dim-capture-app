/**
 * app-level security header tests.
 *
 * M3 — Express must not expose version information via X-Powered-By.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// The health route hits Prisma — mock the DB so the test is self-contained.
vi.mock("../lib/db", () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  },
}));

import request from "supertest";
import { app } from "../app";

beforeEach(() => vi.clearAllMocks());

describe("Security headers — M3", () => {
  it("does not include X-Powered-By on any response (Express version disclosure)", async () => {
    const res = await request(app).get("/api/health");

    // The header must be absent entirely, not just blank.
    expect(res.headers).not.toHaveProperty("x-powered-by");
  });
});
