import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AddImapAccount } from "./AddImapAccount";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("@/services/db/settings", () => ({
  getSetting: vi.fn().mockImplementation((key: string) => {
    if (key === "google_client_id") return Promise.resolve("saved-google-client-id");
    return Promise.resolve(null);
  }),
  getSecureSetting: vi.fn().mockImplementation((key: string) => {
    if (key === "google_client_secret") return Promise.resolve("saved-google-client-secret");
    return Promise.resolve(null);
  }),
  setSetting: vi.fn().mockResolvedValue(undefined),
  setSecureSetting: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/db/accounts", () => ({
  insertImapAccount: vi.fn().mockResolvedValue(undefined),
  insertOAuthImapAccount: vi.fn().mockResolvedValue(undefined),
}));

describe("AddImapAccount with Gmail support", () => {
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

  it("auto-discovers Gmail settings with OAuth2 when typing a gmail.com address", async () => {
    render(<AddImapAccount onClose={() => {}} onSuccess={() => {}} onBack={() => {}} />);

    const emailInput = screen.getByLabelText("Email Address");
    fireEvent.change(emailInput, { target: { value: "user@gmail.com" } });
    fireEvent.blur(emailInput);

    await waitFor(() => {
      expect(screen.getByText("OAuth2")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /password/i })).toBeInTheDocument();
    });

    // Should pre-fill saved Google client ID and secret from settings
    const clientIdInput = screen.getByLabelText("Client ID") as HTMLInputElement;
    expect(clientIdInput.value).toBe("saved-google-client-id");

    // Should render guidance with 127.0.0.1:17248 redirect URI
    expect(screen.getByText(/Register at the Google Cloud Console with redirect URI/i)).toBeInTheDocument();
    expect(screen.getByText("http://127.0.0.1:17248")).toBeInTheDocument();

    // Should have Sign in with Google button
    expect(screen.getByRole("button", { name: /Sign in with Google/i })).toBeInTheDocument();

    // Switching to password shows App Password guidance
    fireEvent.click(screen.getByRole("button", { name: /password/i }));
    expect(screen.getByText(/App Password generated at myaccount\.google\.com\/apppasswords/i)).toBeInTheDocument();
  });

  it("uses the .env client id and secret instead of saved settings", async () => {
    process.env.GMAIL_OAUTH_CLIENT_ID = "env-client-id-12345.apps.googleusercontent.com";
    process.env.GMAIL_OAUTH_CLIENT_SECRET = "env-client-secret";

    render(<AddImapAccount onClose={() => {}} onSuccess={() => {}} onBack={() => {}} />);

    const emailInput = screen.getByLabelText("Email Address");
    fireEvent.change(emailInput, { target: { value: "user@gmail.com" } });
    fireEvent.blur(emailInput);

    await waitFor(() => {
      expect((screen.getByLabelText("Client ID") as HTMLInputElement).value).toBe(
        "env-client-id-12345.apps.googleusercontent.com",
      );
    });
    expect((screen.getByLabelText("Client Secret (optional)") as HTMLInputElement).value).toBe(
      "env-client-secret",
    );
  });

  it("handles googlemail.com alias", async () => {
    render(<AddImapAccount onClose={() => {}} onSuccess={() => {}} onBack={() => {}} />);

    const emailInput = screen.getByLabelText("Email Address");
    fireEvent.change(emailInput, { target: { value: "user@googlemail.com" } });
    fireEvent.blur(emailInput);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Sign in with Google/i })).toBeInTheDocument();
    });
  });

  it("allows selecting Google OAuth for custom domains without auto-discovery", async () => {
    render(<AddImapAccount onClose={() => {}} onSuccess={() => {}} onBack={() => {}} />);

    const emailInput = screen.getByLabelText("Email Address");
    fireEvent.change(emailInput, { target: { value: "user@customdomain.com" } });
    fireEvent.blur(emailInput);

    await waitFor(() => {
      expect(screen.getByLabelText("Password")).toBeInTheDocument();
    });

    // Switch to OAuth2
    const oauthButton = screen.getByRole("button", { name: /OAuth2/i });
    fireEvent.click(oauthButton);

    // Dropdown to select provider should be visible
    const providerSelect = screen.getByLabelText("OAuth Provider");
    expect(providerSelect).toBeInTheDocument();

    fireEvent.change(providerSelect, { target: { value: "google" } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Sign in with Google/i })).toBeInTheDocument();
    });
  });
});
