import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../services/auth.js", () => ({
  loadOAuthCredentials: vi.fn().mockReturnValue({
    clientId: "test-client-id.apps.googleusercontent.com",
    clientSecret: "test-secret",
  }),
  getOAuthScopes: vi
    .fn()
    .mockReturnValue(["openid", "cloud-platform", "email", "profile"]),
  completeOAuthFlow: vi.fn(),
}));

vi.mock("../services/keychain.js", () => ({
  deleteKeychain: vi.fn(),
}));

import { authRoutes } from "./auth.js";
import {
  loadOAuthCredentials,
  completeOAuthFlow,
} from "../services/auth.js";
import { deleteKeychain } from "../services/keychain.js";
import type { AuthContainer } from "../services/auth.js";

function makeAuthContainer(authenticated = false): AuthContainer {
  if (authenticated) {
    return {
      current: {
        status: "authenticated",
        oauth2Client: {} as any,
        projectId: "test-project",
        method: "gemini-cli-oauth",
      },
    };
  }
  return {
    current: {
      status: "unauthenticated",
      oauth2Client: null,
      projectId: null,
      method: "none",
    },
  };
}

describe("auth routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /auth/start", () => {
    it("returns auth_url with correct OAuth params and state token", async () => {
      const app = authRoutes(makeAuthContainer(), 7965);
      const res = await app.request("/auth/start");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.auth_url).toBeTruthy();
      expect(body.state).toBeTruthy();
      expect(body.state.length).toBe(64); // 32 bytes hex

      const url = new URL(body.auth_url);
      expect(url.hostname).toBe("accounts.google.com");
      expect(url.searchParams.get("client_id")).toBe(
        "test-client-id.apps.googleusercontent.com",
      );
      expect(url.searchParams.get("redirect_uri")).toBe(
        "http://127.0.0.1:7965/auth/callback",
      );
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("access_type")).toBe("offline");
      expect(url.searchParams.get("prompt")).toBe("consent");
      expect(url.searchParams.get("state")).toBe(body.state);
    });
  });

  describe("GET /auth/callback", () => {
    it("valid state+code -> updates authContainer + success HTML", async () => {
      const authContainer = makeAuthContainer();
      const app = authRoutes(authContainer, 7965);

      // First, get a valid state
      const startRes = await app.request("/auth/start");
      const { state } = await startRes.json();

      vi.mocked(completeOAuthFlow).mockResolvedValue({
        status: "authenticated",
        oauth2Client: {} as any,
        projectId: "test-project",
        method: "gemini-cli-oauth",
      });

      const res = await app.request(
        `/auth/callback?code=test_code&state=${state}`,
      );
      expect(res.status).toBe(200);

      const html = await res.text();
      expect(html).toContain("Authenticated successfully");
      expect(authContainer.current.status).toBe("authenticated");
    });

    it("invalid state -> 400", async () => {
      const app = authRoutes(makeAuthContainer(), 7965);
      const res = await app.request(
        "/auth/callback?code=test_code&state=invalid_state",
      );
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain("Invalid or expired state");
    });

    it("missing code -> 400", async () => {
      const app = authRoutes(makeAuthContainer(), 7965);
      const res = await app.request("/auth/callback?state=some_state");
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain("Missing code or state");
    });

    it("error param -> 400", async () => {
      const app = authRoutes(makeAuthContainer(), 7965);
      const res = await app.request(
        "/auth/callback?error=access_denied",
      );
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain("access_denied");
    });

    it("completeOAuthFlow throws -> 500", async () => {
      const authContainer = makeAuthContainer();
      const app = authRoutes(authContainer, 7965);

      const startRes = await app.request("/auth/start");
      const { state } = await startRes.json();

      vi.mocked(completeOAuthFlow).mockRejectedValue(
        new Error("OAuth exchange failed"),
      );

      const res = await app.request(
        `/auth/callback?code=test_code&state=${state}`,
      );
      expect(res.status).toBe(500);
      const html = await res.text();
      expect(html).toContain("OAuth exchange failed");
    });
  });

  describe("GET /auth/status", () => {
    it("reflects authContainer state when authenticated", async () => {
      const app = authRoutes(makeAuthContainer(true), 7965);
      const res = await app.request("/auth/status");
      const body = await res.json();

      expect(body.authenticated).toBe(true);
      expect(body.method).toBe("gemini-cli-oauth");
    });

    it("reflects authContainer state when unauthenticated", async () => {
      const app = authRoutes(makeAuthContainer(false), 7965);
      const res = await app.request("/auth/status");
      const body = await res.json();

      expect(body.authenticated).toBe(false);
      expect(body.method).toBe("none");
    });
  });

  describe("POST /auth/logout", () => {
    it("clears Keychain and resets authContainer", async () => {
      const authContainer = makeAuthContainer(true);
      const app = authRoutes(authContainer, 7965);

      const res = await app.request("/auth/logout", { method: "POST" });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(deleteKeychain).toHaveBeenCalled();
      expect(authContainer.current.status).toBe("unauthenticated");
      expect(authContainer.current.method).toBe("none");
    });
  });
});
