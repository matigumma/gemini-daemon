import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoist mock functions so they can be referenced in vi.mock factories
const {
  mockGetAccessToken,
  mockGetToken,
  mockSetCredentials,
  mockOn,
  mockFetch,
} = vi.hoisted(() => ({
  mockGetAccessToken: vi.fn(),
  mockGetToken: vi.fn(),
  mockSetCredentials: vi.fn(),
  mockOn: vi.fn(),
  mockFetch: vi.fn(),
}));

// Mock keychain
vi.mock("./keychain.js", () => ({
  readKeychain: vi.fn(),
  writeKeychain: vi.fn(),
}));

// Mock fs
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

// Mock google-auth-library with a proper class constructor
vi.mock("google-auth-library", () => {
  return {
    OAuth2Client: class MockOAuth2Client {
      getAccessToken = mockGetAccessToken;
      getToken = mockGetToken;
      setCredentials = mockSetCredentials;
      on = mockOn;
    },
  };
});

// Mock global fetch
vi.stubGlobal("fetch", mockFetch);

import { readKeychain, writeKeychain } from "./keychain.js";
import { readFile } from "node:fs/promises";
import {
  loadOAuthCredentials,
  getOAuthScopes,
  resolveAuthOptional,
  completeOAuthFlow,
  fetchQuota,
} from "./auth.js";

const sampleTokens = {
  access_token: "ya29.test",
  refresh_token: "1//test-refresh",
  expiry_date: 1700000000000,
  token_type: "Bearer",
  scope: "openid",
};

function mockLoadProjectIdSuccess() {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ cloudaicompanionProject: "test-project" }),
  });
}

describe("loadOAuthCredentials", () => {
  it("returns clientId and clientSecret", () => {
    const creds = loadOAuthCredentials();
    expect(creds.clientId).toBeTruthy();
    expect(creds.clientSecret).toBeTruthy();
    expect(creds.clientId).toContain(".apps.googleusercontent.com");
  });
});

describe("getOAuthScopes", () => {
  it("returns 4 scopes", () => {
    const scopes = getOAuthScopes();
    expect(scopes).toHaveLength(4);
    expect(scopes).toContain("openid");
    expect(scopes).toContain(
      "https://www.googleapis.com/auth/cloud-platform",
    );
  });
});

describe("resolveAuthOptional", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue({ token: "mock-token" });
  });

  it("Keychain hit -> authenticated", async () => {
    vi.mocked(readKeychain).mockReturnValue(sampleTokens);
    mockLoadProjectIdSuccess();

    const state = await resolveAuthOptional();

    expect(state.status).toBe("authenticated");
    expect(state.projectId).toBe("test-project");
    expect(state.method).toBe("gemini-cli-oauth");
  });

  it("Keychain miss + file hit -> authenticated + migrates to Keychain", async () => {
    vi.mocked(readKeychain).mockReturnValue(null);
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(sampleTokens));
    mockLoadProjectIdSuccess();

    const state = await resolveAuthOptional();

    expect(state.status).toBe("authenticated");
    expect(writeKeychain).toHaveBeenCalled();
  });

  it("both miss -> unauthenticated (never throws)", async () => {
    vi.mocked(readKeychain).mockReturnValue(null);
    vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));

    const state = await resolveAuthOptional();

    expect(state.status).toBe("unauthenticated");
    expect(state.oauth2Client).toBeNull();
    expect(state.projectId).toBeNull();
    expect(state.method).toBe("none");
  });

  it("invalid Keychain + file miss -> unauthenticated", async () => {
    vi.mocked(readKeychain).mockReturnValue(sampleTokens);
    mockGetAccessToken.mockRejectedValue(new Error("Token expired"));
    vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));

    const state = await resolveAuthOptional();

    expect(state.status).toBe("unauthenticated");
    expect(state.method).toBe("none");
  });
});

describe("completeOAuthFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue({ token: "mock-token" });
  });

  it("exchanges code, stores tokens, returns authenticated", async () => {
    mockGetToken.mockResolvedValue({
      tokens: {
        access_token: "new-access",
        refresh_token: "new-refresh",
        expiry_date: 9999999999999,
        token_type: "Bearer",
        scope: "openid",
      },
    });
    mockLoadProjectIdSuccess();

    const state = await completeOAuthFlow(
      "auth-code",
      "http://127.0.0.1:7965/auth/callback",
    );

    expect(state.status).toBe("authenticated");
    expect(state.projectId).toBe("test-project");
    expect(state.method).toBe("gemini-cli-oauth");
    expect(writeKeychain).toHaveBeenCalled();
  });

  it("throws on missing refresh_token", async () => {
    mockGetToken.mockResolvedValue({
      tokens: {
        access_token: "new-access",
        // no refresh_token
      },
    });

    await expect(
      completeOAuthFlow("auth-code", "http://127.0.0.1:7965/auth/callback"),
    ).rejects.toThrow("refresh_token");
  });

  it("throws on loadProjectId failure (no partial storage)", async () => {
    mockGetToken.mockResolvedValue({
      tokens: {
        access_token: "new-access",
        refresh_token: "new-refresh",
        expiry_date: 9999999999999,
        token_type: "Bearer",
      },
    });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve("Forbidden"),
    });

    await expect(
      completeOAuthFlow("auth-code", "http://127.0.0.1:7965/auth/callback"),
    ).rejects.toThrow("loadCodeAssist failed");

    // writeKeychain should NOT have been called (project ID check happens first)
    expect(writeKeychain).not.toHaveBeenCalled();
  });
});

describe("fetchQuota", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue({ token: "mock-token" });
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

    const mockOAuth2Client = { getAccessToken: mockGetAccessToken } as any;
    const quotas = await fetchQuota(mockOAuth2Client, "test-project");

    expect(quotas).toHaveLength(2);
    const flash = quotas.find((q) => q.modelId === "gemini-2.5-flash");
    expect(flash?.percentLeft).toBe(50); // lowest fraction 0.5
    const pro = quotas.find((q) => q.modelId === "gemini-2.5-pro");
    expect(pro?.percentLeft).toBe(90);
  });

  it("skips _vertex duplicates", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          buckets: [
            {
              remainingFraction: 0.8,
              modelId: "gemini-2.5-flash",
            },
            {
              remainingFraction: 0.8,
              modelId: "gemini-2.5-flash_vertex",
            },
          ],
        }),
    });

    const mockOAuth2Client = { getAccessToken: mockGetAccessToken } as any;
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

    const mockOAuth2Client = { getAccessToken: mockGetAccessToken } as any;
    const quotas = await fetchQuota(mockOAuth2Client, "test-project");

    expect(quotas[0].resetDescription).toBe("Resets in 2h 30m");
  });

  it("returns empty array for no buckets", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ buckets: [] }),
    });

    const mockOAuth2Client = { getAccessToken: mockGetAccessToken } as any;
    const quotas = await fetchQuota(mockOAuth2Client, "test-project");

    expect(quotas).toEqual([]);
  });
});
