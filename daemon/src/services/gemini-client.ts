import type { OAuth2Client } from "google-auth-library";
import type { AuthResult } from "./auth.js";

const CODE_ASSIST_BASE = "https://cloudcode-pa.googleapis.com/v1internal";

const MODEL_ALIASES: Record<string, string> = {
  pro: "gemini-2.5-pro",
  flash: "gemini-2.5-flash",
  "3-pro": "gemini-3-pro",
  "3-flash": "gemini-3-flash",
};

const DEFAULT_MODEL = "gemini-2.5-flash";

export interface GeminiClient {
  generateContent(
    model: string,
    body: Record<string, unknown>,
  ): Promise<GeminiResponse>;
  generateContentStream(
    model: string,
    body: Record<string, unknown>,
  ): AsyncGenerator<GeminiResponse>;
}

export interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export interface GeminiCandidate {
  content?: {
    parts?: GeminiPart[];
    role?: string;
  };
  finishReason?: string;
}

export interface GeminiPart {
  text?: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
}

// Cloudcode API wraps the response
interface CloudCodeResponse {
  response: GeminiResponse;
  traceId?: string;
}

async function getAuthHeaders(oauth2Client: OAuth2Client): Promise<Record<string, string>> {
  const tokenRes = await oauth2Client.getAccessToken();
  const token = tokenRes.token;
  if (!token) {
    throw new Error("Failed to obtain access token");
  }
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function wrapRequest(
  model: string,
  projectId: string,
  innerRequest: Record<string, unknown>,
): Record<string, unknown> {
  return {
    model,
    project: projectId,
    request: innerRequest,
  };
}

const MAX_RETRIES = 3;

function parseRetryDelay(responseBody: string): number | null {
  try {
    const json = JSON.parse(responseBody);
    const details = json?.error?.details;
    if (!Array.isArray(details)) return null;
    for (const d of details) {
      if (d?.retryDelay) {
        // Format: "0.594048652s" or "3.168331203s"
        const match = d.retryDelay.match(/^([\d.]+)s$/);
        if (match) return Math.ceil(parseFloat(match[1]) * 1000);
      }
    }
  } catch {}
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  verbose?: boolean,
): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, init);

    if (res.status !== 429 || attempt === MAX_RETRIES) {
      return res;
    }

    const text = await res.text();
    const delayMs = parseRetryDelay(text) ?? 1000 * (attempt + 1);

    if (verbose) {
      console.log(`[retry] 429 received, retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
    }

    await sleep(delayMs);
  }

  // Unreachable, but TypeScript needs it
  throw new Error("Retry loop exhausted");
}

function sanitizeApiError(status: number): string {
  switch (status) {
    case 400: return "Bad request to upstream API";
    case 401:
    case 403: return "Authentication failed with upstream API";
    case 404: return "Model not found";
    case 429: return "Rate limit exceeded";
    default: return `Upstream API error (${status})`;
  }
}

export function getClient(auth: AuthResult, verbose?: boolean): GeminiClient {
  const { oauth2Client, projectId } = auth;

  return {
    async generateContent(model, body) {
      const url = `${CODE_ASSIST_BASE}:generateContent`;
      const headers = await getAuthHeaders(oauth2Client);
      const wrapped = wrapRequest(model, projectId, body);

      const res = await fetchWithRetry(
        url,
        { method: "POST", headers, body: JSON.stringify(wrapped) },
        verbose,
      );

      if (!res.ok) {
        const text = await res.text();
        if (verbose) console.error(`[gemini] API error ${res.status}: ${text}`);
        const error: any = new Error(sanitizeApiError(res.status));
        error.status = res.status;
        throw error;
      }

      const data = (await res.json()) as CloudCodeResponse;
      return data.response;
    },

    async *generateContentStream(model, body) {
      const url = `${CODE_ASSIST_BASE}:streamGenerateContent?alt=sse`;
      const headers = await getAuthHeaders(oauth2Client);
      const wrapped = wrapRequest(model, projectId, body);

      const res = await fetchWithRetry(
        url,
        { method: "POST", headers, body: JSON.stringify(wrapped) },
        verbose,
      );

      if (!res.ok) {
        const text = await res.text();
        if (verbose) console.error(`[gemini] API error ${res.status}: ${text}`);
        const error: any = new Error(sanitizeApiError(res.status));
        error.status = res.status;
        throw error;
      }

      if (!res.body) {
        throw new Error("No response body for streaming request");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          // Keep the last (potentially incomplete) line in the buffer
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("data: ")) {
              const data = trimmed.slice(6);
              if (data === "[DONE]") return;
              try {
                const parsed = JSON.parse(data) as CloudCodeResponse;
                yield parsed.response;
              } catch {
                // Skip unparseable lines
              }
            }
          }
        }

        // Process any remaining data in the buffer
        if (buffer.trim().startsWith("data: ")) {
          const data = buffer.trim().slice(6);
          if (data !== "[DONE]") {
            try {
              const parsed = JSON.parse(data) as CloudCodeResponse;
              yield parsed.response;
            } catch {
              // Skip
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}

export function resolveModel(model?: string, defaultModel?: string): string {
  const m = model || defaultModel || DEFAULT_MODEL;
  return MODEL_ALIASES[m] ?? m;
}
