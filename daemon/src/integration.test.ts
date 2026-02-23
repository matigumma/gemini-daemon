/**
 * Integration test: exercises the full Hono app through the principal user flow.
 * The repo version assumes auth is resolved at startup (no auth routes, no AuthContainer).
 */
import { describe, it, expect, vi } from "vitest";
import { createServer } from "./server.js";
import type { AuthResult } from "./services/auth.js";
import type { GeminiClient } from "./services/gemini-client.js";

function makeAuth(): AuthResult {
  return {
    oauth2Client: {
      getAccessToken: vi.fn().mockResolvedValue({ token: "int-test-token" }),
    } as any,
    projectId: "integration-project",
    method: "gemini-cli-oauth",
  };
}

function makeMockClient(): GeminiClient {
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
  } as GeminiClient;
}

// Mock fetchQuota used by quota route
vi.mock("./services/auth.js", () => ({
  fetchQuota: vi.fn().mockResolvedValue([
    {
      modelId: "gemini-2.5-flash",
      percentLeft: 75,
      resetTime: null,
      resetDescription: "—",
    },
  ]),
}));

describe("integration: full app flow", () => {
  const auth = makeAuth();
  const client = makeMockClient();
  const app = createServer({
    client,
    auth,
    defaultModel: "gemini-2.5-flash",
  });

  it("GET /health → 200 with status ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBe("0.1.0");
    expect(body.auth_method).toBe("gemini-cli-oauth");
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

  it("GET /stats → returns stats object", async () => {
    const res = await app.request("/stats");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("requests_by_model");
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
});
