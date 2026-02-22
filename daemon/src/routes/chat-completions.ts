import { Hono } from "hono";
import { stream as honoStream } from "hono/streaming";
import type { GeminiClient } from "../services/gemini-client.js";
import {
  buildRequestBody,
  type OpenAIChatRequest,
} from "../adapters/openai-to-gemini.js";
import { convertResponse } from "../adapters/gemini-to-openai.js";
import { createSSEStream } from "../streaming/sse-transformer.js";
import { resolveModel } from "../services/gemini-client.js";
import { formatErrorResponse } from "../errors.js";
import { recordRequest } from "../stats.js";

export function chatCompletionsRoute(
  client: GeminiClient,
  defaultModel?: string,
  verbose?: boolean,
): Hono {
  const app = new Hono();

  app.post("/v1/chat/completions", async (c) => {
    let body: OpenAIChatRequest;
    try {
      body = await c.req.json<OpenAIChatRequest>();
    } catch {
      return c.json(
        formatErrorResponse("Invalid JSON in request body", "invalid_request_error"),
        400,
      );
    }

    if (!body.messages || !Array.isArray(body.messages)) {
      return c.json(
        formatErrorResponse("'messages' is required and must be an array", "invalid_request_error"),
        400,
      );
    }

    const model = resolveModel(body.model, defaultModel);
    recordRequest(model);
    const requestBody = buildRequestBody(body);

    if (verbose) {
      console.log(`[request] model=${model} messages=${body.messages.length} stream=${!!body.stream}`);
    }

    try {
      if (body.stream) {
        const streamResult = client.generateContentStream(model, requestBody);

        const sseStream = createSSEStream(streamResult, model);

        c.header("Content-Type", "text/event-stream");
        c.header("Cache-Control", "no-cache");
        c.header("Connection", "keep-alive");

        return honoStream(c, async (stream) => {
          const reader = sseStream.getReader();
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              await stream.write(value);
            }
          } finally {
            reader.releaseLock();
          }
        });
      }

      // Non-streaming
      const result = await client.generateContent(model, requestBody);
      const response = convertResponse(result, model);

      if (verbose) {
        console.log(
          `[response] model=${model} finish=${response.choices[0]?.finish_reason} tokens=${response.usage?.total_tokens ?? "?"}`,
        );
      }

      return c.json(response);
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string; code?: number };
      const status = error.status ?? error.code ?? 500;
      const message = error.message ?? "Internal server error";

      if (verbose) {
        console.error(`[error] model=${model} status=${status} message=${message}`);
      }

      if (status === 429) {
        return c.json(formatErrorResponse(message, "rate_limit_error"), 429);
      }
      if (status === 401 || status === 403) {
        return c.json(formatErrorResponse(message, "authentication_error"), 401);
      }
      if (status === 400) {
        return c.json(formatErrorResponse(message, "invalid_request_error"), 400);
      }

      return c.json(formatErrorResponse(message, "server_error"), 500);
    }
  });

  return app;
}
