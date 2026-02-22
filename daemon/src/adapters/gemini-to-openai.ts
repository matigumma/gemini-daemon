import type { GeminiResponse, GeminiPart } from "../services/gemini-client.js";
import { v4 as uuidv4 } from "uuid";

// --- OpenAI Response Types ---

export interface OpenAIChatCompletion {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: OpenAIChatChoice[];
  usage?: OpenAIUsage;
}

export interface OpenAIChatChoice {
  index: number;
  message: OpenAIResponseMessage;
  finish_reason: string | null;
}

export interface OpenAIResponseMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: OpenAIResponseToolCall[];
}

export interface OpenAIResponseToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// --- Streaming Types ---

export interface OpenAIChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: OpenAIChatChunkChoice[];
}

export interface OpenAIChatChunkChoice {
  index: number;
  delta: OpenAIChunkDelta;
  finish_reason: string | null;
}

export interface OpenAIChunkDelta {
  role?: "assistant";
  content?: string | null;
  tool_calls?: OpenAIChunkToolCall[];
}

export interface OpenAIChunkToolCall {
  index: number;
  id?: string;
  type?: "function";
  function: {
    name?: string;
    arguments?: string;
  };
}

// --- Finish Reason Mapping ---

const FINISH_REASON_MAP: Record<string, string> = {
  STOP: "stop",
  MAX_TOKENS: "length",
  SAFETY: "content_filter",
  RECITATION: "content_filter",
  LANGUAGE: "content_filter",
  BLOCKLIST: "content_filter",
  PROHIBITED_CONTENT: "content_filter",
  SPII: "content_filter",
  MALFORMED_FUNCTION_CALL: "stop",
  OTHER: "stop",
};

function mapFinishReason(reason?: string): string | null {
  if (!reason) return null;
  return FINISH_REASON_MAP[reason] ?? "stop";
}

// --- Helper ---

function extractFunctionCalls(parts: GeminiPart[]): GeminiPart[] {
  return parts.filter((p) => p.functionCall !== undefined);
}

// --- Conversion ---

export function convertResponse(
  geminiResponse: GeminiResponse,
  model: string,
): OpenAIChatCompletion {
  const candidate = geminiResponse.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];

  const textParts = parts.filter((p) => p.text !== undefined);
  const functionCalls = extractFunctionCalls(parts);

  const message: OpenAIResponseMessage = {
    role: "assistant",
    content: textParts.length > 0 ? textParts.map((p) => p.text).join("") : null,
  };

  if (functionCalls.length > 0) {
    message.tool_calls = functionCalls.map((fc) => ({
      id: `call_${uuidv4().replace(/-/g, "").slice(0, 24)}`,
      type: "function" as const,
      function: {
        name: fc.functionCall!.name,
        arguments: JSON.stringify(fc.functionCall!.args ?? {}),
      },
    }));
    if (!message.content) message.content = null;
  }

  const usage = geminiResponse.usageMetadata;

  return {
    id: `chatcmpl-${uuidv4()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: functionCalls.length > 0
          ? "tool_calls"
          : mapFinishReason(candidate?.finishReason),
      },
    ],
    usage: usage
      ? {
          prompt_tokens: usage.promptTokenCount ?? 0,
          completion_tokens: usage.candidatesTokenCount ?? 0,
          total_tokens: usage.totalTokenCount ?? 0,
        }
      : undefined,
  };
}
