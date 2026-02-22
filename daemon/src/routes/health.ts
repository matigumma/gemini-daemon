import { Hono } from "hono";
import type { AuthMethod } from "../services/auth.js";

const startTime = Date.now();

export function healthRoute(authMethod: AuthMethod): Hono {
  const app = new Hono();

  app.get("/health", (c) => {
    return c.json({
      status: "ok",
      uptime: Math.floor((Date.now() - startTime) / 1000),
      version: "0.1.0",
      auth_method: authMethod,
    });
  });

  return app;
}
