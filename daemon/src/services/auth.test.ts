import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoist mock functions so they can be referenced in vi.mock factories
const { mockGetAccessToken, mockSetCredentials, mockOn, mockFetch } =
  vi.hoisted(() => ({
    mockGetAccessToken: vi.fn(),
    mockSetCredentials: vi.fn(),
    mockOn: vi.fn(),
    mockFetch: vi.fn(),
  }));

// Mock fs
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

// Mock fs (sync) — loadOAuthCredentials uses readFileSync
vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return { ...actual, readFileSync: vi.fn() };
});

// Mock google-auth-library with a proper class constructor
vi.mock("google-auth-library", () => ({
  OAuth2Client: class MockOAuth2Client {
    getAccessToken = mockGetAccessToken;
    setCredentials = mockSetCredentials;
    on = mockOn;
  },
}));

// Mock global fetch
vi.stubGlobal("fetch", mockFetch);

import { readFile } from "node:fs/promises";

const sampleCreds = JSON.stringify({
  access_token: "ya29.test",
  refresh_token: "1//test-refresh",
  expiry_date: 1700000000000,
  token_type: "Bearer",
  scope: "openid",
});

describe("auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Set env vars so loadOAuthCredentials() succeeds at module load
    process.env.GEMINI_CLI_CLIENT_ID = "test-client-id";
    process.env.GEMINI_CLI_CLIENT_SECRET = "test-client-secret";
    mockGetAccessToken.mockResolvedValue({ token: "mock-token" });
  });

  afterEach(() => {
    delete process.env.GEMINI_CLI_CLIENT_ID;
    delete process.env.GEMINI_CLI_CLIENT_SECRET;
  });

  async function loadAuth() {
    return import("./auth.js");
  }

  describe("resolveAuth", () => {
    it("returns AuthResult when credentials are valid", async () => {
      vi.mocked(readFile).mockResolvedValue(sampleCreds);
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ cloudaicompanionProject: "test-project" }),
      });

      const { resolveAuth } = await loadAuth();
      const result = await resolveAuth();

      expect(result.method).toBe("gemini-cli-oauth");
      expect(result.projectId).toBe("test-project");
      expect(result.oauth2Client).toBeTruthy();
    });

    it("throws when credential file is missing", async () => {
      vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));

      const { resolveAuth } = await loadAuth();
      await expect(resolveAuth()).rejects.toThrow("No OAuth credentials");
    });

    it("throws when credential file has invalid JSON", async () => {
      vi.mocked(readFile).mockResolvedValue("not json{{{");

      const { resolveAuth } = await loadAuth();
      await expect(resolveAuth()).rejects.toThrow("Failed to parse");
    });

    it("throws when no refresh_token", async () => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({ access_token: "ya29.test" }),
      );

      const { resolveAuth } = await loadAuth();
      await expect(resolveAuth()).rejects.toThrow("refresh_token");
    });

    it("throws when getAccessToken fails", async () => {
      vi.mocked(readFile).mockResolvedValue(sampleCreds);
      mockGetAccessToken.mockRejectedValue(new Error("Token expired"));

      const { resolveAuth } = await loadAuth();
      await expect(resolveAuth()).rejects.toThrow("Failed to obtain");
    });

    it("throws when loadProjectId fails", async () => {
      vi.mocked(readFile).mockResolvedValue(sampleCreds);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve("Forbidden"),
      });

      const { resolveAuth } = await loadAuth();
      await expect(resolveAuth()).rejects.toThrow("loadCodeAssist failed");
    });
  });

  describe("fetchQuota", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-02-22T10:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("parses buckets and groups by model (lowest fraction)", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            buckets: [
              {
                remainingFraction: 0.8,
                resetTime: "2026-02-22T12:00:00Z",
                modelId: "gemini-2.5-flash",
                tokenType: "INPUT",
              },
              {
                remainingFraction: 0.5,
                resetTime: "2026-02-22T12:00:00Z",
                modelId: "gemini-2.5-flash",
                tokenType: "OUTPUT",
              },
              {
                remainingFraction: 0.9,
                resetTime: "2026-02-22T12:00:00Z",
                modelId: "gemini-2.5-pro",
              },
            ],
          }),
      });

      const { fetchQuota } = await loadAuth();
      const mockOAuth2Client = {
        getAccessToken: mockGetAccessToken,
      } as any;
      const quotas = await fetchQuota(mockOAuth2Client, "test-project");

      expect(quotas).toHaveLength(2);
      const flash = quotas.find((q) => q.modelId === "gemini-2.5-flash");
      expect(flash?.percentLeft).toBe(50);
      const pro = quotas.find((q) => q.modelId === "gemini-2.5-pro");
      expect(pro?.percentLeft).toBe(90);
    });

    it("skips _vertex duplicates", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            buckets: [
              { remainingFraction: 0.8, modelId: "gemini-2.5-flash" },
              { remainingFraction: 0.8, modelId: "gemini-2.5-flash_vertex" },
            ],
          }),
      });

      const { fetchQuota } = await loadAuth();
      const mockOAuth2Client = {
        getAccessToken: mockGetAccessToken,
      } as any;
      const quotas = await fetchQuota(mockOAuth2Client, "test-project");

      expect(quotas).toHaveLength(1);
      expect(quotas[0].modelId).toBe("gemini-2.5-flash");
    });

    it("formats reset times", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            buckets: [
              {
                remainingFraction: 0.5,
                resetTime: "2026-02-22T12:30:00Z",
                modelId: "gemini-2.5-flash",
              },
            ],
          }),
      });

      const { fetchQuota } = await loadAuth();
      const mockOAuth2Client = {
        getAccessToken: mockGetAccessToken,
      } as any;
      const quotas = await fetchQuota(mockOAuth2Client, "test-project");

      expect(quotas[0].resetDescription).toBe("Resets in 2h 30m");
    });

    it("returns empty array for no buckets", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ buckets: [] }),
      });

      const { fetchQuota } = await loadAuth();
      const mockOAuth2Client = {
        getAccessToken: mockGetAccessToken,
      } as any;
      const quotas = await fetchQuota(mockOAuth2Client, "test-project");

      expect(quotas).toEqual([]);
    });
  });
});
