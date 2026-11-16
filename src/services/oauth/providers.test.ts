import { describe, it, expect } from "vitest";
import { getOAuthProvider, getAllOAuthProviders } from "./providers";

describe("getOAuthProvider", () => {
  it("returns google provider config", () => {
    const provider = getOAuthProvider("google");
    expect(provider).not.toBeNull();
    expect(provider!.id).toBe("google");
    expect(provider!.name).toBe("Google");
    expect(provider!.authUrl).toContain("accounts.google.com");
    expect(provider!.tokenUrl).toContain("oauth2.googleapis.com");
    expect(provider!.scopes).toContain("https://mail.google.com/");
    expect(provider!.scopes).toContain("openid");
    expect(provider!.scopes).toContain("https://www.googleapis.com/auth/userinfo.email");
    expect(provider!.scopes).toContain("https://www.googleapis.com/auth/userinfo.profile");
    expect(provider!.userInfoUrl).toContain("googleapis.com");
    expect(provider!.usePkce).toBe(true);
  });

  it("handles gmail alias for google provider", () => {
    const provider = getOAuthProvider("gmail");
    expect(provider).not.toBeNull();
    expect(provider!.id).toBe("google");
  });

  it("returns microsoft provider config", () => {
    const provider = getOAuthProvider("microsoft");
    expect(provider).not.toBeNull();
    expect(provider!.id).toBe("microsoft");
    expect(provider!.name).toBe("Microsoft");
    expect(provider!.authUrl).toContain("login.microsoftonline.com");
    expect(provider!.tokenUrl).toContain("login.microsoftonline.com");
    expect(provider!.scopes).toContain("https://outlook.office.com/IMAP.AccessAsUser.All");
    expect(provider!.scopes).toContain("https://outlook.office.com/SMTP.Send");
    expect(provider!.scopes).toContain("offline_access");
    expect(provider!.scopes).toContain("openid");
    expect(provider!.scopes).toContain("profile");
    expect(provider!.scopes).toContain("email");
    expect(provider!.userInfoUrl).toBeUndefined();
    expect(provider!.usePkce).toBe(true);
  });

  it("returns yahoo provider config", () => {
    const provider = getOAuthProvider("yahoo");
    expect(provider).not.toBeNull();
    expect(provider!.id).toBe("yahoo");
    expect(provider!.name).toBe("Yahoo");
    expect(provider!.authUrl).toContain("login.yahoo.com");
    expect(provider!.scopes).toContain("mail-r");
    expect(provider!.scopes).toContain("mail-w");
    expect(provider!.usePkce).toBe(true);
  });

  it("returns null for unknown provider", () => {
    expect(getOAuthProvider("unknown")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(getOAuthProvider("")).toBeNull();
  });
});

describe("getAllOAuthProviders", () => {
  it("returns all registered providers", () => {
    const providers = getAllOAuthProviders();
    expect(providers.length).toBeGreaterThanOrEqual(3);
    const ids = providers.map((p) => p.id);
    expect(ids).toContain("google");
    expect(ids).toContain("microsoft");
    expect(ids).toContain("yahoo");
  });
});
