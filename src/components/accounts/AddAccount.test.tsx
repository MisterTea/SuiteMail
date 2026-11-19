import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AddAccount } from "./AddAccount";
import * as auth from "@/services/gmail/auth";
import * as tokenManager from "@/services/gmail/tokenManager";

vi.mock("@/services/gmail/auth", () => ({
  startOAuthFlow: vi.fn(),
}));

vi.mock("@/services/db/accounts", () => ({
  saveGmailAccount: vi.fn().mockResolvedValue("account-1"),
}));

vi.mock("@/services/db/settings", () => ({
  getSetting: vi.fn().mockResolvedValue(null),
  getSecureSetting: vi.fn().mockResolvedValue(null),
}));

describe("AddAccount - Gmail Flow", () => {
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

  it("does not prompt user to enter client id when GMAIL_OAUTH_CLIENT_ID is in .env and goes directly to authenticating", async () => {
    process.env.GMAIL_OAUTH_CLIENT_ID = "env-client-id-12345.apps.googleusercontent.com";
    process.env.GMAIL_OAUTH_CLIENT_SECRET = "env-client-secret";

    // Return a pending promise so it stays in "authenticating" state
    vi.mocked(auth.startOAuthFlow).mockReturnValue(new Promise(() => {}));

    render(<AddAccount onClose={() => {}} onSuccess={() => {}} />);

    // Click Google (Gmail)
    const gmailButton = screen.getByText("Google (Gmail)");
    fireEvent.click(gmailButton);

    // Verify it called startOAuthFlow with the env client ID and secret
    await waitFor(() => {
      expect(auth.startOAuthFlow).toHaveBeenCalledWith(
        "env-client-id-12345.apps.googleusercontent.com",
        "env-client-secret",
      );
    });

    // Verify SetupClientId prompt is NOT shown
    expect(screen.queryByText("Google API Setup")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Paste your Client ID here...")).not.toBeInTheDocument();

    // Verify it transitioned directly to the waiting for sign-in state
    expect(screen.getByText("Waiting for Google sign-in...")).toBeInTheDocument();
  });

  it("prompts the user with SetupClientId when no client ID is configured", async () => {
    // Neither env var nor DB setting configured
    vi.spyOn(tokenManager, "getClientId").mockRejectedValue(
      new Error("Client ID not configured"),
    );

    render(<AddAccount onClose={() => {}} onSuccess={() => {}} />);

    // Click Google (Gmail)
    const gmailButton = screen.getByText("Google (Gmail)");
    fireEvent.click(gmailButton);

    // Await state update
    const setupTitle = await screen.findByText("Google API Setup");
    expect(setupTitle).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Paste your Client ID here...")).toBeInTheDocument();
  });
});
