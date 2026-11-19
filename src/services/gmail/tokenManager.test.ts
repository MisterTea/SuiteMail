import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getClientId, getClientSecret } from "./tokenManager";
import { getSecureSetting, getSetting } from "../db/settings";

vi.mock("../db/settings", () => ({
  getSetting: vi.fn(),
  getSecureSetting: vi.fn(),
}));

vi.mock("../db/accounts", () => ({
  getAllAccounts: vi.fn().mockResolvedValue([]),
  getAccount: vi.fn(),
  updateAccountAllTokens: vi.fn(),
}));

describe("tokenManager - getClientId with GMAIL_OAUTH_CLIENT_ID", () => {
  const originalEnv = process.env.GMAIL_OAUTH_CLIENT_ID;
  const originalSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GMAIL_OAUTH_CLIENT_ID;
    delete process.env.GMAIL_OAUTH_CLIENT_SECRET;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.GMAIL_OAUTH_CLIENT_ID = originalEnv;
    } else {
      delete process.env.GMAIL_OAUTH_CLIENT_ID;
    }
    if (originalSecret !== undefined) {
      process.env.GMAIL_OAUTH_CLIENT_SECRET = originalSecret;
    } else {
      delete process.env.GMAIL_OAUTH_CLIENT_SECRET;
    }
  });

  it("returns the .env client id and secret together", async () => {
    process.env.GMAIL_OAUTH_CLIENT_ID = "env-client-id-12345.apps.googleusercontent.com";
    process.env.GMAIL_OAUTH_CLIENT_SECRET = "env-client-secret";

    await expect(getClientId()).resolves.toBe("env-client-id-12345.apps.googleusercontent.com");
    await expect(getClientSecret()).resolves.toBe("env-client-secret");
    expect(getSetting).not.toHaveBeenCalled();
    expect(getSecureSetting).not.toHaveBeenCalled();
  });

  it("prioritizes the .env pair over database settings", async () => {
    process.env.GMAIL_OAUTH_CLIENT_ID = "env-priority-client-id";
    process.env.GMAIL_OAUTH_CLIENT_SECRET = "env-priority-secret";
    vi.mocked(getSetting).mockResolvedValue("db-client-id");
    vi.mocked(getSecureSetting).mockResolvedValue("db-client-secret");

    await expect(getClientId()).resolves.toBe("env-priority-client-id");
    await expect(getClientSecret()).resolves.toBe("env-priority-secret");
  });

  it("throws when only one of the .env credentials is set", async () => {
    process.env.GMAIL_OAUTH_CLIENT_ID = "env-client-id-only";

    await expect(getClientId()).rejects.toThrow(
      "GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET must both be set in .env.",
    );
    await expect(getClientSecret()).rejects.toThrow(
      "GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET must both be set in .env.",
    );
  });

  it("falls back to google_client_id setting when env var is absent", async () => {
    vi.mocked(getSetting).mockResolvedValue("fallback-db-client-id");
    vi.mocked(getSecureSetting).mockResolvedValue("fallback-db-secret");

    const clientId = await getClientId();
    expect(clientId).toBe("fallback-db-client-id");
    await expect(getClientSecret()).resolves.toBe("fallback-db-secret");
    expect(getSetting).toHaveBeenCalledWith("google_client_id");
  });

  it("throws error when both env var and database setting are absent", async () => {
    vi.mocked(getSetting).mockResolvedValue(null);

    await expect(getClientId()).rejects.toThrow(
      "Google Client ID not configured. Go to Settings to set it up.",
    );
  });
});
