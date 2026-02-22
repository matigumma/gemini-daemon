import { Hono } from "hono";
import { getStats } from "../stats.js";

export function statsRoute(): Hono {
  const app = new Hono();

  app.get("/stats", (c) => {
    return c.json(getStats());
  });

  return app;
}
