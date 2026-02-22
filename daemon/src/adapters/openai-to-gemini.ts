import type { GeminiPart } from "../services/gemini-client.js";

// --- Gemini API Types (local definitions) ---

interface GeminiContent {
  role: string;
  parts: GeminiPart[];
}

interface GeminiFunctionDeclaration {
  name: string;
  description?: string;
  parametersJsonSchema?: Record<string, unknown>;
}

interface GeminiTool {
  functionDeclarations: GeminiFunctionDeclaration[];
}

interface GeminiToolConfig {
  functionCallingConfig: {
    mode: string;
    allowedFunctionNames?: string[];
  };
}

export interface GeminiRequestBody {
  contents: GeminiContent[];
  systemInstruction?: { parts: [{ text: string }] };
  generationConfig?: Record<string, unknown>;
  tools?: GeminiTool[];
  toolConfig?: GeminiToolConfig;
}

// --- OpenAI Request Types ---

interface OpenAIContentPart {
  type: string;
  text?: string;
  image_url?: { url: string };
}

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | OpenAIContentPart[] | null;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

/** Extract plain text from OpenAI content (string or array of parts). */
function extractText(content: string | OpenAIContentPart[] | null | undefined): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text!)
      .join("\n");
  }
  return String(content);
}

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface OpenAIChatRequest {
  model?: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string | string[];
  tools?: OpenAITool[];
  tool_choice?: "none" | "auto" | "required" | { type: "function"; function: { name: string } };
}

// --- Conversion ---

export function convertMessages(messages: OpenAIMessage[]): {
  systemInstruction?: string;
  contents: GeminiContent[];
} {
  let systemInstruction: string | undefined;
  const contents: GeminiContent[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      const text = extractText(msg.content);
      systemInstruction = systemInstruction
        ? systemInstruction + "\n" + text
        : text;
      continue;
    }

    if (msg.role === "user") {
      contents.push({
        role: "user",
        parts: [{ text: extractText(msg.content) }],
      });
      continue;
    }

    if (msg.role === "assistant") {
      const parts: GeminiPart[] = [];

      const text = extractText(msg.content);
      if (text) {
        parts.push({ text });
      }

      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          parts.push({
            functionCall: {
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments),
            },
          });
        }
      }

      if (parts.length > 0) {
        contents.push({ role: "model", parts });
      }
      continue;
    }

    if (msg.role === "tool") {
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: msg.name ?? "unknown",
              response: safeParseJson(extractText(msg.content)),
            },
          },
        ],
      });
      continue;
    }
  }

  return { systemInstruction, contents };
}

function safeParseJson(str: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(str);
    if (typeof parsed === "object" && parsed !== null) return parsed;
    return { result: parsed };
  } catch {
    return { result: str };
  }
}

export function convertTools(tools?: OpenAITool[]): GeminiTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;

  const declarations: GeminiFunctionDeclaration[] = tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    parametersJsonSchema: t.function.parameters,
  }));

  return [{ functionDeclarations: declarations }];
}

export function convertToolChoice(
  toolChoice?: OpenAIChatRequest["tool_choice"],
): GeminiToolConfig | undefined {
  if (!toolChoice) return undefined;

  if (toolChoice === "none") {
    return { functionCallingConfig: { mode: "NONE" } };
  }
  if (toolChoice === "auto") {
    return { functionCallingConfig: { mode: "AUTO" } };
  }
  if (toolChoice === "required") {
    return { functionCallingConfig: { mode: "ANY" } };
  }
  if (typeof toolChoice === "object" && toolChoice.type === "function") {
    return {
      functionCallingConfig: {
        mode: "ANY",
        allowedFunctionNames: [toolChoice.function.name],
      },
    };
  }
  return undefined;
}

export function buildRequestBody(req: OpenAIChatRequest): GeminiRequestBody {
  const { systemInstruction, contents } = convertMessages(req.messages);

  const body: GeminiRequestBody = { contents };

  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const generationConfig: Record<string, unknown> = {};
  if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
  if (req.max_tokens !== undefined) generationConfig.maxOutputTokens = req.max_tokens;
  if (req.top_p !== undefined) generationConfig.topP = req.top_p;
  if (req.stop !== undefined) {
    generationConfig.stopSequences = Array.isArray(req.stop) ? req.stop : [req.stop];
  }
  if (Object.keys(generationConfig).length > 0) {
    body.generationConfig = generationConfig;
  }

  const geminiTools = convertTools(req.tools);
  if (geminiTools) body.tools = geminiTools;

  const toolConfig = convertToolChoice(req.tool_choice);
  if (toolConfig) body.toolConfig = toolConfig;

  return body;
}
