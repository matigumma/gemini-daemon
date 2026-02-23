import { describe, it, expect } from "vitest";
import { healthRoute } from "./health.js";

describe("healthRoute", () => {
  it("returns auth_method from constructor arg", async () => {
    const app = healthRoute("gemini-cli-oauth");
    const res = await app.request("/health");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.auth_method).toBe("gemini-cli-oauth");
    expect(body.version).toBe("0.1.0");
    expect(typeof body.uptime).toBe("number");
  });

  it("response includes status, uptime, version, auth_method", async () => {
    const app = healthRoute("gemini-cli-oauth");
    const res = await app.request("/health");
    const body = await res.json();

    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("uptime");
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("auth_method");
  });
});
