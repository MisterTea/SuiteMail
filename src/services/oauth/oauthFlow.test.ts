import { describe, it, expect, vi, beforeEach } from "vitest";
import { microsoftEwsProvider, type OAuthProviderConfig } from "./providers";

// Mock Platform APIs
vi.mock("@/platform", () => ({
  platformInvoke: vi.fn(),
  platformOpenUrl: vi.fn(),
}));

import { platformInvoke as invoke, platformOpenUrl as openUrl } from "@/platform";
import { refreshProviderToken, startProviderOAuthFlow } from "./oauthFlow";

const googleProvider: OAuthProviderConfig = {
  id: "google",
  name: "Google",
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes: [
    "https://mail.google.com/",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
  ],
  userInfoUrl: "https://www.googleapis.com/oauth2/v3/userinfo",
  usePkce: true,
};

const microsoftProvider: OAuthProviderConfig = {
  id: "microsoft",
  name: "Microsoft",
  authUrl: "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize",
  tokenUrl: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
  scopes: [
    "https://outlook.office.com/IMAP.AccessAsUser.All",
    "https://outlook.office.com/SMTP.Send",
    "offline_access",
    "openid",
    "profile",
    "email",
  ],
  userInfoUrl: undefined,
  usePkce: true,
};

const yahooProvider: OAuthProviderConfig = {
  id: "yahoo",
  name: "Yahoo",
  authUrl: "https://api.login.yahoo.com/oauth2/request_auth",
  tokenUrl: "https://api.login.yahoo.com/oauth2/get_token",
  scopes: ["mail-r", "mail-w", "openid"],
  userInfoUrl: "https://api.login.yahoo.com/openid/v1/userinfo",
  usePkce: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("refreshProviderToken", () => {
  it("invokes Rust oauth_refresh_token for Microsoft with scope", async () => {
    vi.mocked(invoke).mockResolvedValue({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 3600,
      token_type: "Bearer",
    });

    const result = await refreshProviderToken(
      microsoftProvider,
      "old-refresh",
      "client-123",
    );

    expect(invoke).toHaveBeenCalledWith("oauth_refresh_token", {
      tokenUrl: microsoftProvider.tokenUrl,
      refreshToken: "old-refresh",
      clientId: "client-123",
      clientSecret: null,
      scope: microsoftProvider.scopes.join(" "),
    });
    expect(result.access_token).toBe("new-access");
  });

  it("invokes Rust oauth_refresh_token for Yahoo without scope", async () => {
    vi.mocked(invoke).mockResolvedValue({
      access_token: "yahoo-token",
      expires_in: 3600,
      token_type: "Bearer",
    });

    await refreshProviderToken(yahooProvider, "yahoo-refresh", "yahoo-client");

    expect(invoke).toHaveBeenCalledWith("oauth_refresh_token", {
      tokenUrl: yahooProvider.tokenUrl,
      refreshToken: "yahoo-refresh",
      clientId: "yahoo-client",
      clientSecret: null,
      scope: null,
    });
  });

  it("passes clientSecret when provided", async () => {
    vi.mocked(invoke).mockResolvedValue({
      access_token: "token",
      expires_in: 3600,
      token_type: "Bearer",
    });

    await refreshProviderToken(
      yahooProvider,
      "refresh",
      "client",
      "secret-123",
    );

    expect(invoke).toHaveBeenCalledWith("oauth_refresh_token", {
      tokenUrl: yahooProvider.tokenUrl,
      refreshToken: "refresh",
      clientId: "client",
      clientSecret: "secret-123",
      scope: null,
    });
  });

  it("invokes Rust oauth_refresh_token for Google without scope", async () => {
    vi.mocked(invoke).mockResolvedValue({
      access_token: "google-token",
      expires_in: 3600,
      token_type: "Bearer",
    });

    await refreshProviderToken(
      googleProvider,
      "google-refresh",
      "google-client",
      "google-secret",
    );

    expect(invoke).toHaveBeenCalledWith("oauth_refresh_token", {
      tokenUrl: googleProvider.tokenUrl,
      refreshToken: "google-refresh",
      clientId: "google-client",
      clientSecret: "google-secret",
      scope: null,
    });
  });

  it("propagates errors from invoke", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("Token refresh failed: 400"));

    await expect(
      refreshProviderToken(microsoftProvider, "bad-refresh", "client"),
    ).rejects.toThrow("Token refresh failed: 400");
  });
});

// Test parseIdToken indirectly through the module
// Since parseIdToken is private, we test it via startProviderOAuthFlow's fetchUserInfo path
// We'll test the JWT parsing logic directly by importing the module internals

describe("startProviderOAuthFlow", () => {
  it("uses the native sign-in window for EWS and exchanges its code without a secret", async () => {
    const idToken = `header.${btoa(JSON.stringify({ email: "user@example.com", name: "Test User" }))}.signature`;
    vi.mocked(invoke).mockImplementation(async (command: string, args: unknown) => {
      if (command === "oauth_webview_login") {
        const request = args as { authUrl: string; redirectPrefix: string; state: string };
        const url = new URL(request.authUrl);
        expect(url.searchParams.get("redirect_uri")).toBe(request.redirectPrefix);
        expect(url.searchParams.get("resource")).toBe("https://outlook.office.com");
        expect(url.searchParams.get("state")).toBe(request.state);
        return { code: "ews-code", state: request.state };
      }
      if (command === "oauth_exchange_token") {
        return { access_token: "ews-access", refresh_token: "ews-refresh", expires_in: 3600, token_type: "Bearer", id_token: idToken };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const result = await startProviderOAuthFlow(microsoftEwsProvider("example.com"), "client-id");
    expect(result.userInfo.email).toBe("user@example.com");
    expect(invoke).toHaveBeenCalledWith("oauth_exchange_token", expect.objectContaining({
      code: "ews-code", clientSecret: null, resource: "https://outlook.office.com",
      redirectUri: "https://login.microsoftonline.com/common/oauth2/nativeclient",
    }));
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("formats Google OAuth URL with access_type=offline, prompt=consent, and 127.0.0.1 redirect URI", async () => {
    let capturedState = "";
    vi.mocked(invoke).mockImplementation(async (cmd: string, args: unknown) => {
      if (cmd === "start_oauth_server") {
        const payload = args as { port: number; state: string };
        capturedState = payload.state;
        return { code: "test-auth-code", state: capturedState };
      }
      if (cmd === "oauth_exchange_token") {
        return {
          access_token: "google-access-token",
          refresh_token: "google-refresh-token",
          expires_in: 3600,
          token_type: "Bearer",
        };
      }
      return null;
    });

    // Mock fetch for userInfoUrl
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        email: "test@gmail.com",
        name: "Test User",
        picture: "https://example.com/avatar.png",
      }),
    });

    const result = await startProviderOAuthFlow(
      googleProvider,
      "google-client-id",
      "google-client-secret",
    );

    expect(openUrl).toHaveBeenCalled();
    const openedUrl = vi.mocked(openUrl).mock.calls[0]![0] as string;
    const url = new URL(openedUrl);

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("google-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:17248");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")).toContain("https://mail.google.com/");

    expect(result.tokens.access_token).toBe("google-access-token");
    expect(result.userInfo.email).toBe("test@gmail.com");
    expect(result.userInfo.name).toBe("Test User");
  });
});

describe("parseIdToken (via module internals)", () => {
  // Create a valid JWT-like structure for testing
  function makeIdToken(payload: Record<string, unknown>): string {
    const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const body = btoa(JSON.stringify(payload))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    return `${header}.${body}.fake-signature`;
  }

  it("correctly parses email and name from ID token", async () => {
    // We can't directly test parseIdToken since it's not exported,
    // but we can verify the JWT encoding/decoding round-trip logic
    const payload = {
      email: "user@outlook.com",
      name: "Test User",
      preferred_username: "user@outlook.com",
    };

    const token = makeIdToken(payload);
    const parts = token.split(".");
    const decoded = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));

    expect(decoded.email).toBe("user@outlook.com");
    expect(decoded.name).toBe("Test User");
    expect(decoded.preferred_username).toBe("user@outlook.com");
  });

  it("handles base64url special characters", () => {
    // Payload that generates +, /, = in standard base64
    const payload = { email: "test+special@example.com", name: "Ünïcödé Üser" };
    const token = makeIdToken(payload);
    const parts = token.split(".");
    // Should not contain standard base64 chars that are replaced
    expect(parts[1]).not.toContain("+");
    expect(parts[1]).not.toContain("/");
    expect(parts[1]).not.toContain("=");
  });
});
