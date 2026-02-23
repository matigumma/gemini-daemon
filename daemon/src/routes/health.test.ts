import { describe, it, expect } from "vitest";
import { healthRoute } from "./health.js";
import type { AuthContainer } from "../services/auth.js";

describe("healthRoute", () => {
  it("returns authenticated: true and auth_method when authenticated", async () => {
    const authContainer: AuthContainer = {
      current: {
        status: "authenticated",
        oauth2Client: {} as any,
        projectId: "test-project",
        method: "gemini-cli-oauth",
      },
    };

    const app = healthRoute(authContainer);
    const res = await app.request("/health");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.authenticated).toBe(true);
    expect(body.auth_method).toBe("gemini-cli-oauth");
    expect(body.version).toBe("0.1.0");
    expect(typeof body.uptime).toBe("number");
  });

  it("returns authenticated: false and 'none' when unauthenticated", async () => {
    const authContainer: AuthContainer = {
      current: {
        status: "unauthenticated",
        oauth2Client: null,
        projectId: null,
        method: "none",
      },
    };

    const app = healthRoute(authContainer);
    const res = await app.request("/health");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.authenticated).toBe(false);
    expect(body.auth_method).toBe("none");
  });

  it("response includes status, uptime, version", async () => {
    const authContainer: AuthContainer = {
      current: {
        status: "unauthenticated",
        oauth2Client: null,
        projectId: null,
        method: "none",
      },
    };

    const app = healthRoute(authContainer);
    const res = await app.request("/health");
    const body = await res.json();

    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("uptime");
    expect(body).toHaveProperty("version");
  });
});
