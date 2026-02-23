import { describe, it, expect } from "vitest";
import {
  convertMessages,
  convertTools,
  convertToolChoice,
  buildRequestBody,
  type OpenAIMessage,
  type OpenAITool,
  type OpenAIChatRequest,
} from "./openai-to-gemini.js";

describe("convertMessages", () => {
  it("converts system message to systemInstruction", () => {
    const messages: OpenAIMessage[] = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello" },
    ];
    const result = convertMessages(messages);
    expect(result.systemInstruction).toBe("You are a helpful assistant.");
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]).toEqual({
      role: "user",
      parts: [{ text: "Hello" }],
    });
  });

  it("converts user message to user content", () => {
    const messages: OpenAIMessage[] = [{ role: "user", content: "Hi there" }];
    const result = convertMessages(messages);
    expect(result.contents).toEqual([
      { role: "user", parts: [{ text: "Hi there" }] },
    ]);
    expect(result.systemInstruction).toBeUndefined();
  });

  it("converts assistant text to model content", () => {
    const messages: OpenAIMessage[] = [
      { role: "assistant", content: "I can help with that." },
    ];
    const result = convertMessages(messages);
    expect(result.contents).toEqual([
      { role: "model", parts: [{ text: "I can help with that." }] },
    ]);
  });

  it("converts assistant with tool_calls to model with functionCall parts", () => {
    const messages: OpenAIMessage[] = [
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_123",
            type: "function",
            function: {
              name: "get_weather",
              arguments: '{"city":"London"}',
            },
          },
        ],
      },
    ];
    const result = convertMessages(messages);
    expect(result.contents).toEqual([
      {
        role: "model",
        parts: [
          {
            functionCall: {
              name: "get_weather",
              args: { city: "London" },
            },
          },
        ],
      },
    ]);
  });

  it("converts tool role to user with functionResponse", () => {
    const messages: OpenAIMessage[] = [
      {
        role: "tool",
        name: "get_weather",
        content: '{"temp":22}',
        tool_call_id: "call_123",
      },
    ];
    const result = convertMessages(messages);
    expect(result.contents).toEqual([
      {
        role: "user",
        parts: [
          {
            functionResponse: {
              name: "get_weather",
              response: { temp: 22 },
            },
          },
        ],
      },
    ]);
  });

  it("concatenates multiple system messages", () => {
    const messages: OpenAIMessage[] = [
      { role: "system", content: "You are helpful." },
      { role: "system", content: "Be concise." },
      { role: "user", content: "Hi" },
    ];
    const result = convertMessages(messages);
    expect(result.systemInstruction).toBe("You are helpful.\nBe concise.");
  });

  it("handles tool message with non-JSON content", () => {
    const messages: OpenAIMessage[] = [
      {
        role: "tool",
        name: "some_tool",
        content: "plain text result",
        tool_call_id: "call_1",
      },
    ];
    const result = convertMessages(messages);
    expect(result.contents[0].parts[0]).toEqual({
      functionResponse: {
        name: "some_tool",
        response: { result: "plain text result" },
      },
    });
  });

  it("handles assistant with both text and tool_calls", () => {
    const messages: OpenAIMessage[] = [
      {
        role: "assistant",
        content: "Let me check that.",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "search", arguments: '{"q":"test"}' },
          },
        ],
      },
    ];
    const result = convertMessages(messages);
    expect(result.contents[0].parts).toHaveLength(2);
    expect(result.contents[0].parts[0]).toEqual({
      text: "Let me check that.",
    });
    expect(result.contents[0].parts[1]).toEqual({
      functionCall: { name: "search", args: { q: "test" } },
    });
  });
});

describe("convertTools", () => {
  it("maps to Gemini functionDeclarations", () => {
    const tools: OpenAITool[] = [
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather info",
          parameters: {
            type: "object",
            properties: { city: { type: "string" } },
          },
        },
      },
    ];
    const result = convertTools(tools);
    expect(result).toEqual([
      {
        functionDeclarations: [
          {
            name: "get_weather",
            description: "Get weather info",
            parametersJsonSchema: {
              type: "object",
              properties: { city: { type: "string" } },
            },
          },
        ],
      },
    ]);
  });

  it("returns undefined for empty array", () => {
    expect(convertTools([])).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(convertTools(undefined)).toBeUndefined();
  });
});

describe("convertToolChoice", () => {
  it("maps 'none' to NONE", () => {
    expect(convertToolChoice("none")).toEqual({
      functionCallingConfig: { mode: "NONE" },
    });
  });

  it("maps 'auto' to AUTO", () => {
    expect(convertToolChoice("auto")).toEqual({
      functionCallingConfig: { mode: "AUTO" },
    });
  });

  it("maps 'required' to ANY", () => {
    expect(convertToolChoice("required")).toEqual({
      functionCallingConfig: { mode: "ANY" },
    });
  });

  it("maps object to ANY with allowedFunctionNames", () => {
    expect(
      convertToolChoice({
        type: "function",
        function: { name: "get_weather" },
      }),
    ).toEqual({
      functionCallingConfig: {
        mode: "ANY",
        allowedFunctionNames: ["get_weather"],
      },
    });
  });

  it("returns undefined for undefined", () => {
    expect(convertToolChoice(undefined)).toBeUndefined();
  });
});

describe("buildRequestBody", () => {
  it("assembles generationConfig with temperature, max_tokens, top_p, stop", () => {
    const req: OpenAIChatRequest = {
      messages: [{ role: "user", content: "Hi" }],
      temperature: 0.7,
      max_tokens: 1000,
      top_p: 0.9,
      stop: ["END"],
    };
    const body = buildRequestBody(req);
    expect(body.generationConfig).toEqual({
      temperature: 0.7,
      maxOutputTokens: 1000,
      topP: 0.9,
      stopSequences: ["END"],
    });
  });

  it("converts stop string to array", () => {
    const req: OpenAIChatRequest = {
      messages: [{ role: "user", content: "Hi" }],
      stop: "STOP",
    };
    const body = buildRequestBody(req);
    expect(body.generationConfig?.stopSequences).toEqual(["STOP"]);
  });

  it("omits generationConfig when no params set", () => {
    const req: OpenAIChatRequest = {
      messages: [{ role: "user", content: "Hi" }],
    };
    const body = buildRequestBody(req);
    expect(body.generationConfig).toBeUndefined();
  });

  it("includes systemInstruction when present", () => {
    const req: OpenAIChatRequest = {
      messages: [
        { role: "system", content: "Be helpful" },
        { role: "user", content: "Hi" },
      ],
    };
    const body = buildRequestBody(req);
    expect(body.systemInstruction).toEqual({
      parts: [{ text: "Be helpful" }],
    });
  });

  it("includes tools and toolConfig", () => {
    const req: OpenAIChatRequest = {
      messages: [{ role: "user", content: "Hi" }],
      tools: [
        {
          type: "function",
          function: { name: "fn1", description: "desc" },
        },
      ],
      tool_choice: "auto",
    };
    const body = buildRequestBody(req);
    expect(body.tools).toBeDefined();
    expect(body.toolConfig).toEqual({
      functionCallingConfig: { mode: "AUTO" },
    });
  });
});
