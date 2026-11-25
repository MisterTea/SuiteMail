import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { platformInvoke } from "@/platform";
import { StartupTelemetryPopover } from "./StartupTelemetryPopover";

vi.mock("@/platform", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/platform")>(),
  platformInvoke: vi.fn(),
}));

describe("StartupTelemetryPopover", () => {
  const invoke = vi.mocked(platformInvoke);

  afterEach(() => {
    cleanup();
    invoke.mockReset();
  });

  it.each([
    ["Yes, share diagnostics", true],
    ["No thanks", false],
  ])("saves the preference after %s", async (label, enabled) => {
    const onClose = vi.fn();
    invoke.mockResolvedValueOnce(enabled);
    render(<StartupTelemetryPopover onClose={onClose} />);

    expect(screen.getByText("We never include any content from your emails.")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: label }));

    expect(invoke).toHaveBeenCalledWith("set_startup_telemetry", { enabled });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("dismisses without saving a choice on Escape", () => {
    const onClose = vi.fn();
    render(<StartupTelemetryPopover onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps the prompt open when the choice could not be saved", async () => {
    const onClose = vi.fn();
    invoke.mockRejectedValueOnce(new Error("Unable to save"));
    render(<StartupTelemetryPopover onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "No thanks" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save your choice.");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "No thanks" })).toBeEnabled();
  });
});
