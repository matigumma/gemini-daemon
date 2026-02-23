/**
 * Integration test: exercises the full Hono app through the principal user flow.
 *
 * Unauthenticated flow  → health, models, auth status, 401 on protected routes
 * Authenticated flow    → chat completion (mocked Gemini API), stats, quota
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createServer } from "./server.js";
import type { AuthContainer, AuthState } from "./services/auth.js";

// Mock gemini-client so no real API calls are made
vi.mock("./services/gemini-client.js", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    getClient: vi.fn((authContainer: AuthContainer) => {
      if (authContainer.current.status !== "authenticated") {
        throw new Error("Not authenticated");
      }
      return {
        generateContent: vi.fn().mockResolvedValue({
          candidates: [
            {
              content: {
                parts: [{ text: "Hello from integration test!" }],
                role: "model",
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 8,
            candidatesTokenCount: 6,
            totalTokenCount: 14,
          },
        }),
        generateContentStream: vi.fn(),
      };
    }),
  };
});

// Mock auth service for quota
vi.mock("./services/auth.js", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    // loadOAuthCredentials and getOAuthScopes are used by auth routes
    loadOAuthCredentials: actual.loadOAuthCredentials,
    getOAuthScopes: actual.getOAuthScopes,
    completeOAuthFlow: vi.fn().mockResolvedValue({
      status: "authenticated",
      oauth2Client: { getAccessToken: vi.fn() },
      projectId: "integration-project",
      method: "gemini-cli-oauth",
    }),
    fetchQuota: vi.fn().mockResolvedValue([
      {
        modelId: "gemini-2.5-flash",
        percentLeft: 75,
        resetTime: null,
        resetDescription: "—",
      },
    ]),
  };
});

// Mock keychain (avoid real Keychain access)
vi.mock("./services/keychain.js", () => ({
  readKeychain: vi.fn(),
  writeKeychain: vi.fn(),
  deleteKeychain: vi.fn(),
}));

function makeUnauthenticated(): AuthState {
  return {
    status: "unauthenticated",
    oauth2Client: null,
    projectId: null,
    method: "none",
  };
}

function makeAuthenticated(): AuthState {
  return {
    status: "authenticated",
    oauth2Client: {
      getAccessToken: vi.fn().mockResolvedValue({ token: "int-test-token" }),
    } as any,
    projectId: "integration-project",
    method: "gemini-cli-oauth",
  };
}

describe("integration: unauthenticated flow", () => {
  const authContainer: AuthContainer = { current: makeUnauthenticated() };
  const app = createServer({
    authContainer,
    port: 7965,
    defaultModel: "gemini-2.5-flash",
  });

  it("GET /health → 200 with status ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBe("0.1.0");
    expect(body.authenticated).toBe(false);
    expect(body.auth_method).toBe("none");
    expect(typeof body.uptime).toBe("number");
  });

  it("GET /v1/models → 200 with model list", async () => {
    const res = await app.request("/v1/models");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.object).toBe("list");
    expect(body.data.length).toBeGreaterThan(0);

    const ids = body.data.map((m: any) => m.id);
    expect(ids).toContain("gemini-2.5-flash");
    expect(ids).toContain("gemini-2.5-pro");
  });

  it("GET /auth/status → unauthenticated", async () => {
    const res = await app.request("/auth/status");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.authenticated).toBe(false);
    expect(body.method).toBe("none");
  });

  it("GET /stats → empty stats", async () => {
    const res = await app.request("/stats");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("requests_by_model");
  });

  it("POST /v1/chat/completions → 401", async () => {
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hi" }],
      }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error.type).toBe("authentication_error");
  });

  it("GET /quota → 401", async () => {
    const res = await app.request("/quota");
    expect(res.status).toBe(401);
  });

  it("GET /auth/start → returns auth URL", async () => {
    const res = await app.request("/auth/start");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.auth_url).toContain("accounts.google.com");
    expect(body.state).toBeTruthy();
  });
});

describe("integration: authenticated flow", () => {
  const authContainer: AuthContainer = { current: makeAuthenticated() };
  const app = createServer({
    authContainer,
    port: 7965,
    defaultModel: "gemini-2.5-flash",
  });

  it("GET /health → authenticated", async () => {
    const res = await app.request("/health");
    const body = await res.json();

    expect(body.authenticated).toBe(true);
    expect(body.auth_method).toBe("gemini-cli-oauth");
  });

  it("POST /v1/chat/completions → 200 with OpenAI response", async () => {
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: "Hello" }],
      }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.object).toBe("chat.completion");
    expect(body.choices).toHaveLength(1);
    expect(body.choices[0].message.role).toBe("assistant");
    expect(body.choices[0].message.content).toBe(
      "Hello from integration test!",
    );
    expect(body.choices[0].finish_reason).toBe("stop");
    expect(body.usage.total_tokens).toBe(14);
  });

  it("POST /v1/chat/completions → 400 on invalid body", async () => {
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "gemini-2.5-flash" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error.type).toBe("invalid_request_error");
  });

  it("GET /quota → 200 with quota data", async () => {
    const res = await app.request("/quota");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.quotas).toHaveLength(1);
    expect(body.quotas[0].modelId).toBe("gemini-2.5-flash");
    expect(body.quotas[0].percentLeft).toBe(75);
  });

  it("GET /auth/status → authenticated", async () => {
    const res = await app.request("/auth/status");
    const body = await res.json();

    expect(body.authenticated).toBe(true);
    expect(body.method).toBe("gemini-cli-oauth");
  });

  it("POST /auth/logout → resets to unauthenticated", async () => {
    // Create a separate container so we don't affect other tests
    const container: AuthContainer = { current: makeAuthenticated() };
    const logoutApp = createServer({
      authContainer: container,
      port: 7965,
    });

    const res = await logoutApp.request("/auth/logout", { method: "POST" });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(container.current.status).toBe("unauthenticated");

    // Subsequent chat completion should fail
    const chatRes = await logoutApp.request("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hi" }],
      }),
      headers: { "Content-Type": "application/json" },
    });
    expect(chatRes.status).toBe(401);
  });
});
