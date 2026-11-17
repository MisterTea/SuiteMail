import { describe, it, expect, vi, beforeEach } from "vitest";
import { startOAuthFlow } from "./auth";
import * as platform from "@/platform";

vi.mock("@/platform", () => ({
  platformInvoke: vi.fn(),
  platformOpenUrl: vi.fn(),
}));

describe("startOAuthFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when client ID is undefined or empty string", async () => {
    await expect(startOAuthFlow("")).rejects.toThrow(
      "Client ID is not configured. Go to Settings → Google API to add it.",
    );
  });

  it("throws when client ID is whitespace only", async () => {
    await expect(startOAuthFlow("   ")).rejects.toThrow(
      "Client ID is not configured. Go to Settings → Google API to add it.",
    );
  });

  it("succeeds with desktop OAuth (no client secret) using PKCE and loopback redirect URI", async () => {
    let capturedState: string | undefined;

    vi.mocked(platform.platformInvoke).mockImplementation(async (cmd: string, args: unknown) => {
      if (cmd === "start_oauth_server") {
        const payload = args as { port: number; state: string };
        capturedState = payload.state;
        return { code: "mock-auth-code", state: payload.state };
      }
      return undefined;
    });

    vi.mocked(platform.platformOpenUrl).mockResolvedValue(undefined);

    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "https://oauth2.googleapis.com/token") {
        const body = init?.body?.toString() ?? "";
        // Verify no client_secret is sent for desktop oauth
        expect(body).not.toContain("client_secret");
        expect(body).toContain("code=mock-auth-code");
        expect(body).toContain("client_id=desktop-client-id");
        expect(body).toContain("code_verifier=");
        expect(body).toContain("redirect_uri=http%3A%2F%2F127.0.0.1%3A17248");
        return {
          ok: true,
          json: async () => ({
            access_token: "mock-access-token",
            refresh_token: "mock-refresh-token",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "email profile",
          }),
        };
      }

      if (url === "https://www.googleapis.com/oauth2/v2/userinfo") {
        return {
          ok: true,
          json: async () => ({
            email: "user@example.com",
            name: "Test User",
            picture: "https://example.com/avatar.png",
          }),
        };
      }

      return { ok: false, text: async () => "Not Found" };
    });

    vi.stubGlobal("fetch", mockFetch);

    const result = await startOAuthFlow("desktop-client-id");

    expect(result.tokens.access_token).toBe("mock-access-token");
    expect(result.userInfo.email).toBe("user@example.com");

    // Verify browser opened Google OAuth with PKCE parameters
    expect(platform.platformOpenUrl).toHaveBeenCalledTimes(1);
    const openedUrl = vi.mocked(platform.platformOpenUrl).mock.calls[0][0] as string;
    expect(openedUrl).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(openedUrl).toContain("client_id=desktop-client-id");
    expect(openedUrl).toContain("redirect_uri=http%3A%2F%2F127.0.0.1%3A17248");
    expect(openedUrl).toContain("code_challenge=");
    expect(openedUrl).toContain("code_challenge_method=S256");
    expect(openedUrl).toContain(`state=${capturedState}`);
  });

  it("passes client secret when optionally provided", async () => {
    vi.mocked(platform.platformInvoke).mockImplementation(async (cmd: string, args: unknown) => {
      if (cmd === "start_oauth_server") {
        const payload = args as { port: number; state: string };
        return { code: "mock-auth-code", state: payload.state };
      }
      return undefined;
    });

    vi.mocked(platform.platformOpenUrl).mockResolvedValue(undefined);

    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "https://oauth2.googleapis.com/token") {
        const body = init?.body?.toString() ?? "";
        expect(body).toContain("client_secret=custom-secret");
        return {
          ok: true,
          json: async () => ({
            access_token: "mock-token",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "email",
          }),
        };
      }
      if (url === "https://www.googleapis.com/oauth2/v2/userinfo") {
        return {
          ok: true,
          json: async () => ({
            email: "user@example.com",
            name: "Test User",
            picture: "",
          }),
        };
      }
      return { ok: false, text: async () => "Not Found" };
    });

    vi.stubGlobal("fetch", mockFetch);

    const result = await startOAuthFlow("desktop-client-id", "custom-secret");
    expect(result.tokens.access_token).toBe("mock-token");
  });
});
