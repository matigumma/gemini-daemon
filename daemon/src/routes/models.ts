import { Hono } from "hono";

const AVAILABLE_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
];

export function modelsRoute(): Hono {
  const app = new Hono();

  app.get("/v1/models", (c) => {
    const data = AVAILABLE_MODELS.map((id) => ({
      id,
      object: "model",
      created: Math.floor(Date.now() / 1000),
      owned_by: "google",
    }));

    return c.json({ object: "list", data });
  });

  return app;
}
