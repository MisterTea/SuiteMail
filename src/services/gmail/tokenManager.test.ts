import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getClientId, getEnvGmailClientId } from "./tokenManager";
import { getSetting } from "../db/settings";

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

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GMAIL_OAUTH_CLIENT_ID;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.GMAIL_OAUTH_CLIENT_ID = originalEnv;
    } else {
      delete process.env.GMAIL_OAUTH_CLIENT_ID;
    }
  });

  it("returns GMAIL_OAUTH_CLIENT_ID from environment if present", async () => {
    process.env.GMAIL_OAUTH_CLIENT_ID = "env-client-id-12345.apps.googleusercontent.com";

    const clientId = await getClientId();
    expect(clientId).toBe("env-client-id-12345.apps.googleusercontent.com");
    // Should not need to check settings when env var is present
    expect(getSetting).not.toHaveBeenCalled();
  });

  it("prioritizes GMAIL_OAUTH_CLIENT_ID from environment over database setting", async () => {
    process.env.GMAIL_OAUTH_CLIENT_ID = "env-priority-client-id";
    vi.mocked(getSetting).mockResolvedValue("db-client-id");

    const clientId = await getClientId();
    expect(clientId).toBe("env-priority-client-id");
  });

  it("falls back to google_client_id setting when env var is absent", async () => {
    vi.mocked(getSetting).mockResolvedValue("fallback-db-client-id");

    const clientId = await getClientId();
    expect(clientId).toBe("fallback-db-client-id");
    expect(getSetting).toHaveBeenCalledWith("google_client_id");
  });

  it("throws error when both env var and database setting are absent", async () => {
    vi.mocked(getSetting).mockResolvedValue(null);

    await expect(getClientId()).rejects.toThrow(
      "Google Client ID not configured. Go to Settings to set it up.",
    );
  });
});
