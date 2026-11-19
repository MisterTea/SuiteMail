import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
  it("starts blank for any organization and waits for an application id", () => {
    render(
      <AddEwsAccount onClose={() => {}} onSuccess={() => {}} onBack={() => {}} />,
    );

    expect(screen.getByLabelText("Tenant ID")).toHaveValue("organizations");
    expect(screen.getByLabelText("Application (client) ID")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "UT Austin" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Exchange Web Services" })).toBeTruthy();
    expect(screen.getByText(/EWS\.AccessAsUser\.All/)).toBeTruthy();
    expect(screen.queryByText(/Mail\.ReadWrite/)).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in with Microsoft" })).toBeDisabled();
  });
});
