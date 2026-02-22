import { Hono } from "hono";
import { cors } from "hono/cors";
import type { GeminiClient } from "./services/gemini-client.js";
import type { AuthResult } from "./services/auth.js";
import { chatCompletionsRoute } from "./routes/chat-completions.js";
import { modelsRoute } from "./routes/models.js";
import { healthRoute } from "./routes/health.js";
import { statsRoute } from "./routes/stats.js";
import { quotaRoute } from "./routes/quota.js";

export interface ServerOptions {
  client: GeminiClient;
  auth: AuthResult;
  defaultModel?: string;
  verbose?: boolean;
}

export function createServer(options: ServerOptions): Hono {
  const { client, auth, defaultModel, verbose } = options;
  const app = new Hono();

  app.use("*", cors());

  app.route("/", healthRoute(auth.method));
  app.route("/", modelsRoute());
  app.route("/", chatCompletionsRoute(client, defaultModel, verbose));
  app.route("/", statsRoute());
  app.route("/", quotaRoute(auth));

  return app;
}
