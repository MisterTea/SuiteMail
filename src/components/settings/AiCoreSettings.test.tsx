import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { platformInvoke } from "@/platform";
import type { AiCoreStatus } from "@/services/ai/providers/aicoreProvider";
import { AiCoreSettings } from "./AiCoreSettings";
vi.mock("@/platform", () => ({ platformInvoke: vi.fn() }));
beforeEach(() => vi.mocked(platformInvoke).mockReset());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AiCore device setup", () => {
  it("downloads only when the user requests setup, then reports ready", async () => {
    vi.mocked(platformInvoke).mockResolvedValueOnce({ available: false, status: "downloadable", message: "Model download needed" });
    render(<AiCoreSettings />);
    const setup = await screen.findByRole("button", { name: "Set up AiCore" });
    expect(platformInvoke).toHaveBeenCalledTimes(1);
    vi.mocked(platformInvoke).mockResolvedValueOnce({ available: true, status: "available", message: "AiCore FULL is ready." });
    fireEvent.click(setup);
    await screen.findByText("AiCore FULL is ready.");
    expect(platformInvoke).toHaveBeenLastCalledWith("aicore_prepare", { allowMeteredDownload: false });
    expect(screen.queryByRole("button", { name: "Set up AiCore" })).toBeNull();
  });
  it("shows unsupported device status without offering a download", async () => {
    vi.mocked(platformInvoke).mockResolvedValue({ available: false, status: "unavailable", message: "Not supported on this device" });
    render(<AiCoreSettings />);
    await screen.findByText("Not supported on this device");
    expect(screen.queryByRole("button", { name: "Set up AiCore" })).toBeNull();
  });

  it("shows download percentages while setup runs and clears progress when ready", async () => {
    const invoke = vi.mocked(platformInvoke);
    invoke.mockResolvedValueOnce({ available: false, status: "downloadable" });
    render(<AiCoreSettings />);
    const setup = await screen.findByRole("button", { name: "Set up AiCore" });
    vi.useFakeTimers();

    let finish!: (status: AiCoreStatus) => void;
    invoke.mockReturnValueOnce(new Promise<AiCoreStatus>((resolve) => { finish = resolve; }));
    invoke.mockResolvedValueOnce({ available: false, status: "downloading", message: "Downloading the on-device model…", downloadPercentage: 25 });
    invoke.mockResolvedValueOnce({ available: false, status: "downloading", message: "Finishing AiCore setup…", downloadPercentage: 100 });

    fireEvent.click(setup);
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("value");
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(screen.getByRole("status")).toHaveTextContent("25%");
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "25");
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(screen.getByRole("status")).toHaveTextContent("Finishing AiCore setup… 100%");

    await act(async () => finish({ available: true, supported_models: ["full"], status: "available", message: "AiCore FULL is ready." }));
    expect(screen.getByRole("status")).toHaveTextContent("AiCore FULL is ready.");
    expect(screen.queryByRole("progressbar")).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(invoke).toHaveBeenCalledTimes(4);
  });

  it("tracks a download already running when the settings screen opens", async () => {
    const invoke = vi.mocked(platformInvoke);
    invoke.mockResolvedValueOnce({ available: false, status: "downloading", message: "Downloading the on-device model…", downloadedBytes: 5 * 1024 * 1024 });
    vi.useFakeTimers();
    const { unmount } = render(<AiCoreSettings />);
    await act(async () => {});
    expect(screen.getByRole("status")).toHaveTextContent("5 MiB downloaded.");
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("value");

    invoke.mockResolvedValueOnce({ available: true, status: "available", message: "AiCore FULL is ready." });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(screen.getByRole("status")).toHaveTextContent("AiCore FULL is ready.");
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(invoke.mock.calls).toEqual([["aicore_is_available"], ["aicore_is_available"]]);
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

  it("requests consent before retrying setup on a metered connection", async () => {
    const invoke = vi.mocked(platformInvoke);
    invoke.mockResolvedValueOnce({ available: false, status: "downloadable" });
    invoke.mockResolvedValueOnce({ available: false, status: "downloadable", downloadRequiresConsent: true });
    render(<AiCoreSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Set up AiCore" }));
    await screen.findByRole("dialog", { name: "Download AiCore using this connection?" });
    expect(invoke).toHaveBeenLastCalledWith("aicore_prepare", { allowMeteredDownload: false });

    invoke.mockResolvedValueOnce({ available: true, status: "available", message: "AiCore FULL is ready." });
    fireEvent.click(screen.getByRole("button", { name: "Download model" }));
    await screen.findByText("AiCore FULL is ready.");
    expect(invoke).toHaveBeenLastCalledWith("aicore_prepare", { allowMeteredDownload: true });
  });
});
