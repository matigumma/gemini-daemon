import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../services/auth.js", () => ({
  fetchQuota: vi.fn(),
}));

import { quotaRoute } from "./quota.js";
import { fetchQuota } from "../services/auth.js";
import type { AuthResult } from "../services/auth.js";

function makeAuth(): AuthResult {
  return {
    oauth2Client: {
      getAccessToken: vi.fn().mockResolvedValue({ token: "test" }),
    } as any,
    projectId: "test-project",
    method: "gemini-cli-oauth",
  };
}

describe("quotaRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns quota data", async () => {
    const mockQuotas = [
      {
        modelId: "gemini-2.5-flash",
        percentLeft: 80,
        resetTime: "2026-02-22T12:00:00Z",
        resetDescription: "Resets in 2h",
      },
    ];
    vi.mocked(fetchQuota).mockResolvedValue(mockQuotas);

    const app = quotaRoute(makeAuth());
    const res = await app.request("/quota");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quotas).toEqual(mockQuotas);
    expect(fetchQuota).toHaveBeenCalledTimes(1);
  });

  it("caches for 60 seconds", async () => {
    const mockQuotas = [
      {
        modelId: "gemini-2.5-flash",
        percentLeft: 80,
        resetTime: null,
        resetDescription: "—",
      },
    ];
    vi.mocked(fetchQuota).mockResolvedValue(mockQuotas);

    const app = quotaRoute(makeAuth());

    // First request
    await app.request("/quota");
    // Second request (should be cached)
    const res = await app.request("/quota");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quotas).toEqual(mockQuotas);
    expect(fetchQuota).toHaveBeenCalledTimes(1);
  });

  it("returns error on fetchQuota failure", async () => {
    vi.mocked(fetchQuota).mockRejectedValue(new Error("API failed"));

    const app = quotaRoute(makeAuth());
    const res = await app.request("/quota");

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.quotas).toEqual([]);
    expect(body.error).toBeTruthy();
  });
});
