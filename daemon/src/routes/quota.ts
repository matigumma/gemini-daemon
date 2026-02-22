import { Hono } from "hono";
import type { AuthResult } from "../services/auth.js";
import { fetchQuota, type QuotaInfo } from "../services/auth.js";

export function quotaRoute(auth: AuthResult): Hono {
  const app = new Hono();
  let cache: { data: QuotaInfo[]; ts: number } | null = null;

  app.get("/quota", async (c) => {
    try {
      if (cache && Date.now() - cache.ts < 60_000) {
        return c.json({ quotas: cache.data });
      }
      const quotas = await fetchQuota(auth.oauth2Client, auth.projectId);
      cache = { data: quotas, ts: Date.now() };
      return c.json({ quotas });
    } catch (err) {
      return c.json({ quotas: [], error: String(err) }, 500);
    }
  });

  return app;
}
