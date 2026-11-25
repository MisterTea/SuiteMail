import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { saveEwsAccount } from "@/services/db/accounts";
import { EWS_DEFAULT_CLIENT_ID } from "@/services/microsoft/constants";
import { startProviderOAuthFlow } from "@/services/oauth/oauthFlow";
import { AddEwsAccount } from "./AddEwsAccount";

vi.mock("@/services/oauth/oauthFlow", () => ({
  startProviderOAuthFlow: vi.fn(),
}));

vi.mock("@/services/db/accounts", () => ({
  saveEwsAccount: vi.fn(),
}));

vi.mock("@/services/microsoft/ewsCommands", () => ({
  ewsPing: vi.fn(),
}));

describe("AddEwsAccount", () => {
  beforeEach(() => vi.stubEnv("EWS_OAUTH_CLIENT_ID", ""));
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("prefills the environment application id and lets the user override or clear it", () => {
    vi.stubEnv("EWS_OAUTH_CLIENT_ID", "  configured-ews-client  ");
    render(<AddEwsAccount onClose={() => {}} onSuccess={() => {}} onBack={() => {}} />);
    const clientId = screen.getByLabelText("Application (client) ID");
    expect(clientId).toHaveValue("configured-ews-client");
    expect(screen.getByLabelText("Tenant ID")).toHaveValue("");
    fireEvent.change(clientId, { target: { value: "user-override" } });
    expect(clientId).toHaveValue("user-override");
    fireEvent.change(clientId, { target: { value: "" } });
    expect(clientId).toHaveValue("");
    expect(screen.getByRole("button", { name: "Sign in with Microsoft" })).toBeDisabled();
  });
  it("signs in and saves the account using the shared application id by default", async () => {
    vi.mocked(startProviderOAuthFlow).mockResolvedValueOnce({
      tokens: { access_token: "access", refresh_token: "refresh", expires_in: 3600, token_type: "Bearer" },
      userInfo: { email: "mailbox@example.com", name: "Mailbox" },
    });
    vi.mocked(saveEwsAccount).mockResolvedValueOnce("account-id");
    render(
      <AddEwsAccount onClose={() => {}} onSuccess={() => {}} onBack={() => {}} />,
    );

    expect(screen.getByLabelText("Tenant ID")).toHaveValue("");
    expect(screen.getByLabelText("Application (client) ID")).toHaveValue(EWS_DEFAULT_CLIENT_ID);
    expect(screen.queryByRole("button", { name: "UT Austin" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Exchange Web Services" })).toBeTruthy();
    expect(screen.getByText(/EWS\.AccessAsUser\.All/)).toBeTruthy();
    expect(screen.queryByText(/Mail\.ReadWrite/)).toBeNull();
    const signIn = screen.getByRole("button", { name: "Sign in with Microsoft" });
    expect(signIn).toBeEnabled();
    fireEvent.click(signIn);

    expect(startProviderOAuthFlow).toHaveBeenCalledWith(expect.objectContaining({ id: "microsoft_ews" }), EWS_DEFAULT_CLIENT_ID);
    await waitFor(() => expect(saveEwsAccount).toHaveBeenCalledWith(expect.objectContaining({
      oauthClientId: EWS_DEFAULT_CLIENT_ID,
    })));
  });
});
