import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("uuid", () => ({
  v4: vi.fn().mockReturnValue("00000000-0000-0000-0000-000000000000"),
}));

import { convertResponse } from "./gemini-to-openai.js";
import type { GeminiResponse } from "../services/gemini-client.js";

describe("convertResponse", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
  });

  it("converts text response to correct OpenAI shape", () => {
    const gemini: GeminiResponse = {
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
    };

    const result = convertResponse(gemini, "gemini-2.5-flash");

    expect(result.id).toBe("chatcmpl-00000000-0000-0000-0000-000000000000");
    expect(result.object).toBe("chat.completion");
    expect(result.created).toBe(1700000000);
    expect(result.model).toBe("gemini-2.5-flash");
    expect(result.choices).toHaveLength(1);
    expect(result.choices[0].message.role).toBe("assistant");
    expect(result.choices[0].message.content).toBe("Hello!");
    expect(result.choices[0].finish_reason).toBe("stop");
    expect(result.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    });
  });

  it("converts function call to tool_calls with serialized args", () => {
    const gemini: GeminiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  name: "get_weather",
                  args: { city: "London" },
                },
              },
            ],
            role: "model",
          },
          finishReason: "STOP",
        },
      ],
    };

    const result = convertResponse(gemini, "gemini-2.5-flash");
    const msg = result.choices[0].message;

    expect(msg.content).toBeNull();
    expect(msg.tool_calls).toHaveLength(1);
    expect(msg.tool_calls![0].type).toBe("function");
    expect(msg.tool_calls![0].function.name).toBe("get_weather");
    expect(msg.tool_calls![0].function.arguments).toBe('{"city":"London"}');
    expect(result.choices[0].finish_reason).toBe("tool_calls");
  });

  it("handles mixed text and function calls", () => {
    const gemini: GeminiResponse = {
      candidates: [
        {
          content: {
            parts: [
              { text: "Let me check." },
              {
                functionCall: {
                  name: "search",
                  args: { q: "test" },
                },
              },
            ],
            role: "model",
          },
          finishReason: "STOP",
        },
      ],
    };

    const result = convertResponse(gemini, "gemini-2.5-flash");
    const msg = result.choices[0].message;

    expect(msg.content).toBe("Let me check.");
    expect(msg.tool_calls).toHaveLength(1);
    expect(result.choices[0].finish_reason).toBe("tool_calls");
  });

  it("maps finish reasons correctly", () => {
    const cases: [string, string][] = [
      ["STOP", "stop"],
      ["MAX_TOKENS", "length"],
      ["SAFETY", "content_filter"],
      ["RECITATION", "content_filter"],
      ["MALFORMED_FUNCTION_CALL", "stop"],
      ["OTHER", "stop"],
    ];

    for (const [geminiReason, expected] of cases) {
      const gemini: GeminiResponse = {
        candidates: [
          {
            content: { parts: [{ text: "hi" }], role: "model" },
            finishReason: geminiReason,
          },
        ],
      };
      const result = convertResponse(gemini, "test-model");
      expect(result.choices[0].finish_reason).toBe(expected);
    }
  });

  it("maps usage metadata correctly", () => {
    const gemini: GeminiResponse = {
      candidates: [
        {
          content: { parts: [{ text: "ok" }], role: "model" },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 50,
        totalTokenCount: 150,
      },
    };

    const result = convertResponse(gemini, "test-model");
    expect(result.usage).toEqual({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    });
  });

  it("handles empty candidates", () => {
    const gemini: GeminiResponse = { candidates: [] };
    const result = convertResponse(gemini, "test-model");
    expect(result.choices[0].message.content).toBeNull();
    expect(result.choices[0].finish_reason).toBeNull();
  });

  it("handles missing candidates", () => {
    const gemini: GeminiResponse = {};
    const result = convertResponse(gemini, "test-model");
    expect(result.choices[0].message.content).toBeNull();
    expect(result.choices[0].finish_reason).toBeNull();
    expect(result.usage).toBeUndefined();
  });
});
