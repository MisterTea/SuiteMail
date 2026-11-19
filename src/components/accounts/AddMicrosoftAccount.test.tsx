import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AddMicrosoftAccount } from "./AddMicrosoftAccount";

vi.mock("@/services/oauth/oauthFlow", () => ({
  startGraphDeviceCodeSignIn: vi.fn(),
}));

vi.mock("@/services/db/accounts", () => ({
  saveMsGraphAccount: vi.fn(),
}));

describe("AddMicrosoftAccount", () => {
  it("starts blank for any organization and waits for an application id", () => {
    render(
      <AddMicrosoftAccount onClose={() => {}} onSuccess={() => {}} onBack={() => {}} />,
    );

    expect(screen.getByLabelText("Tenant ID")).toHaveValue("organizations");
    expect(screen.getByLabelText("Application (client) ID")).toHaveValue("");
    expect(screen.queryByLabelText("Redirect URI")).toBeNull();
    expect(screen.queryByRole("button", { name: "UT Austin" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in with Microsoft" })).toBeDisabled();
  });
});
