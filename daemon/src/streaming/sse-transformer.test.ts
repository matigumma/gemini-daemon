import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("uuid", () => ({
  v4: vi.fn().mockReturnValue("00000000-0000-0000-0000-000000000000"),
}));

import { createSSEStream } from "./sse-transformer.js";
import type { GeminiResponse } from "../services/gemini-client.js";

async function* mockStream(
  chunks: GeminiResponse[],
): AsyncGenerator<GeminiResponse> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

async function collectStream(stream: ReadableStream<string>): Promise<string[]> {
  const reader = stream.getReader();
  const chunks: string[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks;
}

function parseSSE(chunk: string): any {
  const match = chunk.match(/^data: (.+)\n\n$/);
  if (!match) return null;
  if (match[1] === "[DONE]") return "[DONE]";
  return JSON.parse(match[1]);
}

describe("createSSEStream", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
  });

  it("emits role: assistant on first chunk only", async () => {
    const chunks: GeminiResponse[] = [
      {
        candidates: [
          { content: { parts: [{ text: "Hello" }], role: "model" } },
        ],
      },
      {
        candidates: [
          { content: { parts: [{ text: " world" }], role: "model" } },
        ],
      },
    ];

    const stream = createSSEStream(mockStream(chunks), "test-model");
    const output = await collectStream(stream);

    const first = parseSSE(output[0]);
    expect(first.choices[0].delta.role).toBe("assistant");

    const second = parseSSE(output[1]);
    expect(second.choices[0].delta.role).toBeUndefined();
  });

  it("emits text content as SSE data lines", async () => {
    const chunks: GeminiResponse[] = [
      {
        candidates: [
          { content: { parts: [{ text: "Hello" }], role: "model" } },
        ],
      },
    ];

    const stream = createSSEStream(mockStream(chunks), "test-model");
    const output = await collectStream(stream);

    const parsed = parseSSE(output[0]);
    expect(parsed.choices[0].delta.content).toBe("Hello");
    expect(parsed.object).toBe("chat.completion.chunk");
    expect(parsed.model).toBe("test-model");
  });

  it("emits function call chunks", async () => {
    const chunks: GeminiResponse[] = [
      {
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
          },
        ],
      },
    ];

    const stream = createSSEStream(mockStream(chunks), "test-model");
    const output = await collectStream(stream);

    const parsed = parseSSE(output[0]);
    const toolCalls = parsed.choices[0].delta.tool_calls;
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.name).toBe("get_weather");
    expect(toolCalls[0].function.arguments).toBe('{"city":"London"}');
    expect(toolCalls[0].type).toBe("function");
  });

  it("emits finish reason chunk", async () => {
    const chunks: GeminiResponse[] = [
      {
        candidates: [
          {
            content: { parts: [{ text: "Done" }], role: "model" },
            finishReason: "STOP",
          },
        ],
      },
    ];

    const stream = createSSEStream(mockStream(chunks), "test-model");
    const output = await collectStream(stream);

    // Should have text chunk, finish chunk, and [DONE]
    const finishChunk = parseSSE(output[1]);
    expect(finishChunk.choices[0].finish_reason).toBe("stop");
    expect(finishChunk.choices[0].delta).toEqual({});
  });

  it("ends with data: [DONE]", async () => {
    const chunks: GeminiResponse[] = [
      {
        candidates: [
          { content: { parts: [{ text: "Hi" }], role: "model" } },
        ],
      },
    ];

    const stream = createSSEStream(mockStream(chunks), "test-model");
    const output = await collectStream(stream);

    const last = output[output.length - 1];
    expect(last).toBe("data: [DONE]\n\n");
  });

  it("handles empty stream gracefully", async () => {
    const stream = createSSEStream(mockStream([]), "test-model");
    const output = await collectStream(stream);
    expect(output).toEqual(["data: [DONE]\n\n"]);
  });

  it("uses tool_calls finish reason when function calls occurred", async () => {
    const chunks: GeminiResponse[] = [
      {
        candidates: [
          {
            content: {
              parts: [
                { functionCall: { name: "fn", args: {} } },
              ],
              role: "model",
            },
          },
        ],
      },
      {
        candidates: [
          {
            content: { parts: [], role: "model" },
            finishReason: "STOP",
          },
        ],
      },
    ];

    const stream = createSSEStream(mockStream(chunks), "test-model");
    const output = await collectStream(stream);

    const finishChunk = output.find((c) => {
      const p = parseSSE(c);
      return p && p !== "[DONE]" && p.choices?.[0]?.finish_reason;
    });
    const parsed = parseSSE(finishChunk!);
    expect(parsed.choices[0].finish_reason).toBe("tool_calls");
  });
});
