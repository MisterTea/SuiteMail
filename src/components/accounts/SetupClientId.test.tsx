import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SetupClientId } from "./SetupClientId";
import { setSetting } from "@/services/db/settings";

vi.mock("@/services/db/settings", () => ({
  setSetting: vi.fn().mockResolvedValue(undefined),
}));

describe("SetupClientId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("disables Save button when client ID is empty", () => {
    render(<SetupClientId onComplete={() => {}} onCancel={() => {}} />);
    const saveButton = screen.getByText("Save & Continue");
    expect(saveButton).toBeDisabled();
  });

  it("enables Save button when client ID is provided without needing client secret", () => {
    render(<SetupClientId onComplete={() => {}} onCancel={() => {}} />);
    const clientIdInput = screen.getByPlaceholderText(
      "Paste your Client ID here...",
    );
    fireEvent.change(clientIdInput, { target: { value: "my-desktop-client-id" } });

    const saveButton = screen.getByText("Save & Continue");
    expect(saveButton).not.toBeDisabled();
  });

  it("saves client ID and calls onComplete on submit", async () => {
    const onComplete = vi.fn();
    render(<SetupClientId onComplete={onComplete} onCancel={() => {}} />);
    const clientIdInput = screen.getByPlaceholderText(
      "Paste your Client ID here...",
    );
    fireEvent.change(clientIdInput, { target: { value: "my-desktop-client-id" } });

    const saveButton = screen.getByText("Save & Continue");
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(setSetting).toHaveBeenCalledWith("google_client_id", "my-desktop-client-id");
      expect(onComplete).toHaveBeenCalled();
    });
  });

  it("shows helper text about desktop credentials not requiring a client secret", () => {
    render(<SetupClientId onComplete={() => {}} onCancel={() => {}} />);
    expect(
      screen.getByText("Desktop application credentials use PKCE and do not require a client secret."),
    ).toBeInTheDocument();
  });

  it("explains Desktop app type in instructions", () => {
    render(<SetupClientId onComplete={() => {}} onCancel={() => {}} />);
    expect(
      screen.getByText("Create OAuth 2.0 credentials (Desktop app type)"),
    ).toBeInTheDocument();
  });

  it("calls onCancel when Cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(<SetupClientId onComplete={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });
});
