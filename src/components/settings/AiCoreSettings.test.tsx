import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { platformInvoke } from "@/platform";
import { AiCoreSettings } from "./AiCoreSettings";
vi.mock("@/platform", () => ({ platformInvoke: vi.fn() }));
beforeEach(() => vi.mocked(platformInvoke).mockReset());
afterEach(cleanup);

describe("AiCore device setup", () => {
  it("downloads only when the user requests setup, then reports ready", async () => {
    vi.mocked(platformInvoke).mockResolvedValueOnce({ available: false, status: "downloadable", message: "Model download needed" });
    render(<AiCoreSettings />);
    const setup = await screen.findByRole("button", { name: "Set up AiCore" });
    expect(platformInvoke).toHaveBeenCalledTimes(1);
    vi.mocked(platformInvoke).mockResolvedValueOnce({ available: true, status: "available", message: "AiCore FULL is ready." });
    fireEvent.click(setup);
    await screen.findByText("AiCore FULL is ready.");
    expect(platformInvoke).toHaveBeenLastCalledWith("aicore_prepare");
    expect(screen.queryByRole("button", { name: "Set up AiCore" })).toBeNull();
  });
  it("shows unsupported device status without offering a download", async () => {
    vi.mocked(platformInvoke).mockResolvedValue({ available: false, status: "unavailable", message: "Not supported on this device" });
    render(<AiCoreSettings />);
    await screen.findByText("Not supported on this device");
    expect(screen.queryByRole("button", { name: "Set up AiCore" })).toBeNull();
  });
  it("shows setup failures and permits a retry", async () => {
    vi.mocked(platformInvoke).mockResolvedValueOnce({ available: false, status: "downloadable", message: "Download needed" });
    render(<AiCoreSettings />);
    const setup = await screen.findByRole("button", { name: "Set up AiCore" });
    vi.mocked(platformInvoke).mockRejectedValueOnce(new Error("Download failed"));
    fireEvent.click(setup);
    await screen.findByText("Download failed");
    await waitFor(() => expect(setup).not.toBeDisabled());
  });
});
