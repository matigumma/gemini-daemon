import type { GeminiResponse, GeminiPart } from "../services/gemini-client.js";
import { v4 as uuidv4 } from "uuid";
import type {
  OpenAIChatCompletionChunk,
  OpenAIChunkToolCall,
} from "../adapters/gemini-to-openai.js";

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

function extractFunctionCalls(parts: GeminiPart[]): GeminiPart[] {
  return parts.filter((p) => p.functionCall !== undefined);
}

export function createSSEStream(
  stream: AsyncGenerator<GeminiResponse>,
  model: string,
): ReadableStream<string> {
  const completionId = `chatcmpl-${uuidv4()}`;
  const created = Math.floor(Date.now() / 1000);
  let sentRole = false;
  let toolCallIndex = 0;

  return new ReadableStream<string>({
    async pull(controller) {
      try {
        const { value: chunk, done } = await stream.next();

        if (done) {
          controller.enqueue("data: [DONE]\n\n");
          controller.close();
          return;
        }

        const candidate = chunk.candidates?.[0];
        const parts = candidate?.content?.parts ?? [];

        // Check for function calls
        const functionCalls = extractFunctionCalls(parts);
        if (functionCalls.length > 0) {
          const toolCalls: OpenAIChunkToolCall[] = functionCalls.map((fc, i) => ({
            index: toolCallIndex + i,
            id: `call_${uuidv4().replace(/-/g, "").slice(0, 24)}`,
            type: "function" as const,
            function: {
              name: fc.functionCall!.name,
              arguments: JSON.stringify(fc.functionCall!.args ?? {}),
            },
          }));
          toolCallIndex += functionCalls.length;

          const chunkData: OpenAIChatCompletionChunk = {
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [
              {
                index: 0,
                delta: {
                  ...(sentRole ? {} : { role: "assistant" }),
                  tool_calls: toolCalls,
                },
                finish_reason: null,
              },
            ],
          };
          sentRole = true;
          controller.enqueue(`data: ${JSON.stringify(chunkData)}\n\n`);
          return;
        }

        // Text content
        const text = parts
          .filter((p) => p.text !== undefined)
          .map((p) => p.text)
          .join("");

        if (text) {
          const chunkData: OpenAIChatCompletionChunk = {
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [
              {
                index: 0,
                delta: {
                  ...(sentRole ? {} : { role: "assistant" }),
                  content: text,
                },
                finish_reason: null,
              },
            ],
          };
          sentRole = true;
          controller.enqueue(`data: ${JSON.stringify(chunkData)}\n\n`);
        }

        // Check for finish reason
        const finishReason = mapFinishReason(candidate?.finishReason);
        if (finishReason) {
          const finishChunk: OpenAIChatCompletionChunk = {
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: toolCallIndex > 0 ? "tool_calls" : finishReason,
              },
            ],
          };
          controller.enqueue(`data: ${JSON.stringify(finishChunk)}\n\n`);
        }
      } catch (err) {
        controller.error(err);
      }
    },
  });
}
