import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveModel, getClient } from "./gemini-client.js";
import type { AuthResult } from "./auth.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeAuth(): AuthResult {
  return {
    oauth2Client: {
      getAccessToken: vi.fn().mockResolvedValue({ token: "test-token" }),
    } as any,
    projectId: "test-project",
    method: "gemini-cli-oauth",
  };
}

describe("resolveModel", () => {
  it("maps 'pro' alias to gemini-2.5-pro", () => {
    expect(resolveModel("pro")).toBe("gemini-2.5-pro");
  });

  it("maps 'flash' alias to gemini-2.5-flash", () => {
    expect(resolveModel("flash")).toBe("gemini-2.5-flash");
  });

  it("maps '3-pro' alias to gemini-3-pro", () => {
    expect(resolveModel("3-pro")).toBe("gemini-3-pro");
  });

  it("maps '3-flash' alias to gemini-3-flash", () => {
    expect(resolveModel("3-flash")).toBe("gemini-3-flash");
  });

  it("passes through unknown model names", () => {
    expect(resolveModel("gemini-2.5-flash")).toBe("gemini-2.5-flash");
    expect(resolveModel("custom-model")).toBe("custom-model");
  });

  it("uses default when model is empty", () => {
    expect(resolveModel(undefined)).toBe("gemini-2.5-flash");
    expect(resolveModel("")).toBe("gemini-2.5-flash");
  });

  it("uses provided default model", () => {
    expect(resolveModel(undefined, "gemini-2.5-pro")).toBe("gemini-2.5-pro");
  });
});

describe("getClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("makes correct API call shape (wrapped request)", async () => {
    const auth = makeAuth();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          response: {
            candidates: [
              {
                content: { parts: [{ text: "Hello" }], role: "model" },
                finishReason: "STOP",
              },
            ],
          },
        }),
    });

    const client = getClient(auth);
    const result = await client.generateContent("gemini-2.5-flash", {
      contents: [{ role: "user", parts: [{ text: "Hi" }] }],
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain(":generateContent");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("gemini-2.5-flash");
    expect(body.project).toBe("test-project");
    expect(body.request).toEqual({
      contents: [{ role: "user", parts: [{ text: "Hi" }] }],
    });
    expect(init.headers.Authorization).toBe("Bearer test-token");
    expect(result.candidates![0].content!.parts![0].text).toBe("Hello");
  });

  it("retries on 429 and succeeds", async () => {
    const auth = makeAuth();

    mockFetch
      .mockResolvedValueOnce({
        status: 429,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              error: { details: [{ retryDelay: "0.001s" }] },
            }),
          ),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            response: {
              candidates: [
                {
                  content: { parts: [{ text: "OK" }], role: "model" },
                  finishReason: "STOP",
                },
              ],
            },
          }),
      });

    const client = getClient(auth);
    const result = await client.generateContent("test-model", {});

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.candidates![0].content!.parts![0].text).toBe("OK");
  });

  it("stops after MAX_RETRIES on persistent 429", async () => {
    const auth = makeAuth();

    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 429,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              error: { details: [{ retryDelay: "0.001s" }] },
            }),
          ),
      }),
    );

    const client = getClient(auth);

    await expect(
      client.generateContent("test-model", {}),
    ).rejects.toThrow("Gemini API error 429");
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});
