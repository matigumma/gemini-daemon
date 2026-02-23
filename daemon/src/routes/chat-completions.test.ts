import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../services/gemini-client.js", () => ({
  getClient: vi.fn(),
  resolveModel: vi.fn((model?: string) => model || "gemini-2.5-flash"),
}));

// Mock stats to avoid module state issues
vi.mock("../stats.js", () => ({
  recordRequest: vi.fn(),
}));

import { chatCompletionsRoute } from "./chat-completions.js";
import { getClient } from "../services/gemini-client.js";
import type { AuthContainer } from "../services/auth.js";

function makeAuthContainer(authenticated = false): AuthContainer {
  if (authenticated) {
    return {
      current: {
        status: "authenticated",
        oauth2Client: {} as any,
        projectId: "test-project",
        method: "gemini-cli-oauth",
      },
    };
  }
  return {
    current: {
      status: "unauthenticated",
      oauth2Client: null,
      projectId: null,
      method: "none",
    },
  };
}

function postJSON(app: any, body: any) {
  return app.request("/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("chatCompletionsRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    const app = chatCompletionsRoute(makeAuthContainer(false));
    const res = await postJSON(app, {
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.type).toBe("authentication_error");
  });

  it("returns 400 on invalid JSON", async () => {
    const app = chatCompletionsRoute(makeAuthContainer(true));
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      body: "not json{{{",
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.type).toBe("invalid_request_error");
  });

  it("returns 400 when messages missing", async () => {
    const app = chatCompletionsRoute(makeAuthContainer(true));
    const res = await postJSON(app, { model: "gemini-2.5-flash" });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.message).toContain("messages");
  });

  it("calls client and returns OpenAI response when authenticated", async () => {
    const mockClient = {
      generateContent: vi.fn().mockResolvedValue({
        candidates: [
          {
            content: { parts: [{ text: "Hello!" }], role: "model" },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      }),
      generateContentStream: vi.fn(),
    };
    vi.mocked(getClient).mockReturnValue(mockClient as any);

    const app = chatCompletionsRoute(makeAuthContainer(true));
    const res = await postJSON(app, {
      model: "gemini-2.5-flash",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0].message.content).toBe("Hello!");
    expect(body.choices[0].finish_reason).toBe("stop");
    expect(mockClient.generateContent).toHaveBeenCalledTimes(1);
  });

  it("maps 429 upstream error to rate_limit_error", async () => {
    const error: any = new Error("Rate limited");
    error.status = 429;
    const mockClient = {
      generateContent: vi.fn().mockRejectedValue(error),
      generateContentStream: vi.fn(),
    };
    vi.mocked(getClient).mockReturnValue(mockClient as any);

    const app = chatCompletionsRoute(makeAuthContainer(true));
    const res = await postJSON(app, {
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.type).toBe("rate_limit_error");
  });

  it("maps 401 upstream error to authentication_error", async () => {
    const error: any = new Error("Unauthorized");
    error.status = 401;
    const mockClient = {
      generateContent: vi.fn().mockRejectedValue(error),
      generateContentStream: vi.fn(),
    };
    vi.mocked(getClient).mockReturnValue(mockClient as any);

    const app = chatCompletionsRoute(makeAuthContainer(true));
    const res = await postJSON(app, {
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.type).toBe("authentication_error");
  });

  it("maps 500 upstream error to server_error", async () => {
    const error: any = new Error("Internal error");
    error.status = 500;
    const mockClient = {
      generateContent: vi.fn().mockRejectedValue(error),
      generateContentStream: vi.fn(),
    };
    vi.mocked(getClient).mockReturnValue(mockClient as any);

    const app = chatCompletionsRoute(makeAuthContainer(true));
    const res = await postJSON(app, {
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.type).toBe("server_error");
  });
});
