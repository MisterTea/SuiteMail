import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  it("starts blank for any organization and waits for an application id", () => {
    render(
      <AddEwsAccount onClose={() => {}} onSuccess={() => {}} onBack={() => {}} />,
    );

    expect(screen.getByLabelText("Tenant ID")).toHaveValue("");
    expect(screen.getByLabelText("Application (client) ID")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "UT Austin" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Exchange Web Services" })).toBeTruthy();
    expect(screen.getByText(/EWS\.AccessAsUser\.All/)).toBeTruthy();
    expect(screen.queryByText(/Mail\.ReadWrite/)).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in with Microsoft" })).toBeDisabled();
  });
});
