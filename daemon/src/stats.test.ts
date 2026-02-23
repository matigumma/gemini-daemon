import { describe, it, expect, beforeEach, vi } from "vitest";

describe("stats", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns empty object initially", async () => {
    const { getStats } = await import("./stats.js");
    expect(getStats()).toEqual({ requests_by_model: {} });
  });

  it("recordRequest increments per-model count", async () => {
    const { recordRequest, getStats } = await import("./stats.js");
    recordRequest("gemini-2.5-flash");
    recordRequest("gemini-2.5-flash");
    recordRequest("gemini-2.5-pro");
    expect(getStats()).toEqual({
      requests_by_model: {
        "gemini-2.5-flash": 2,
        "gemini-2.5-pro": 1,
      },
    });
  });

  it("getStats returns requests_by_model correctly", async () => {
    const { recordRequest, getStats } = await import("./stats.js");
    recordRequest("model-a");
    const stats = getStats();
    expect(stats).toHaveProperty("requests_by_model");
    expect(stats.requests_by_model["model-a"]).toBe(1);
  });
});
