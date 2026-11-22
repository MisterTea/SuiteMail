import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { authorizeAndroidGoogle } from "@/services/gmail/androidGoogleAuth";
import { Capacitor } from "@capacitor/core";
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
  setSetting: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue(null),
  getSecureSetting: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/services/gmail/androidGoogleAuth", () => ({authorizeAndroidGoogle:vi.fn()}));

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


describe("Android Gmail entry", () => {
  it("uses native account authorization without desktop credentials or an app password", async () => {
    const previousMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()});
    const platform = vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");
    vi.mocked(authorizeAndroidGoogle).mockResolvedValue({
      tokens:{access_token:"native-token",expires_in:600,token_type:"Bearer",scope:"gmail.modify"},
      userInfo:{email:"native@gmail.com",name:"Native User",picture:""},
    });
    const success=vi.fn();
    try {
      render(<AddAccount onClose={() => {}} onSuccess={success} />);
      fireEvent.click(screen.getByRole("button", { name: /^Google \(Gmail\)/ }));
      await waitFor(()=>expect(success).toHaveBeenCalledOnce());
      expect(authorizeAndroidGoogle).toHaveBeenCalledOnce();
      const {saveGmailAccount}=await import("@/services/db/accounts");
      expect(saveGmailAccount).toHaveBeenCalledWith(expect.objectContaining({email:"native@gmail.com",accessToken:"native-token",refreshToken:""}));
      expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    } finally {
      platform.mockRestore();
      window.matchMedia = previousMatchMedia;
    }
  });
});
