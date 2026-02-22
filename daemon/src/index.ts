import { Command } from "commander";
import { serve } from "@hono/node-server";
import { resolveAuth } from "./services/auth.js";
import { getClient } from "./services/gemini-client.js";
import { createServer } from "./server.js";

const program = new Command();

program
  .name("gemini-daemon")
  .description("Persistent HTTP proxy for Gemini API with OpenAI-compatible interface")
  .version("0.1.0")
  .option("-p, --port <number>", "Port to listen on", "7965")
  .option("-H, --host <address>", "Host to bind to", "127.0.0.1")
  .option("-m, --model <name>", "Default model", "gemini-2.5-flash")
  .option("-v, --verbose", "Enable verbose logging")
  .action(async (opts) => {
    const port = parseInt(opts.port, 10);
    const host = opts.host;
    const verbose = !!opts.verbose;

    try {
      const auth = await resolveAuth();
      if (verbose) {
        console.log(`[auth] Using ${auth.method}`);
      }

      const client = getClient(auth, verbose);
      const app = createServer({
        client,
        auth,
        defaultModel: opts.model,
        verbose,
      });

      const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
        console.log(`[gemini-daemon] listening on http://${host}:${info.port}`);
        if (verbose) {
          console.log(`[config] model=${opts.model} auth=${auth.method}`);
        }
      });

      // Graceful shutdown
      const shutdown = () => {
        console.log("\n[gemini-daemon] shutting down...");
        server.close(() => {
          console.log("[gemini-daemon] stopped");
          process.exit(0);
        });
        // Force exit after 5s if connections don't close
        setTimeout(() => process.exit(1), 5000);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[gemini-daemon] fatal: ${message}`);
      process.exit(1);
    }
  });

program.parse();
