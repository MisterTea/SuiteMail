import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiCoreStartup } from "./AiCoreStartup";
import { platformInvoke } from "@/platform";
import { getActiveProviderName } from "@/services/ai/providerManager";
import { AICORE_READY_EVENT } from "@/services/ai/providers/aicoreProvider";
import { getSetting } from "@/services/db/settings";

vi.mock("@/platform", () => ({ platformInvoke: vi.fn() }));
vi.mock("@/services/ai/providerManager", () => ({ getActiveProviderName: vi.fn() }));
vi.mock("@/services/db/settings", () => ({ getSetting: vi.fn() }));

describe("Android startup setup", () => {
  const invoke = vi.mocked(platformInvoke);
  const consentRequired = { available: false, status: "downloadable", downloadRequiresConsent: true };

  beforeEach(() => {
    invoke.mockReset();
    vi.mocked(getSetting).mockResolvedValue(null);
    vi.mocked(getActiveProviderName).mockResolvedValue("aicore");
  });
  afterEach(cleanup);

  it("attempts setup without authorizing metered data and announces readiness", async () => {
    const ready = vi.fn();
    window.addEventListener(AICORE_READY_EVENT, ready, { once: true });
    invoke.mockResolvedValueOnce({ available: true, status: "available" });
    render(<AiCoreStartup canPrompt />);
    await waitFor(() => expect(ready).toHaveBeenCalledOnce());
    expect(invoke.mock.calls).toEqual([["aicore_prepare", { allowMeteredDownload: false }]]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("uses metered data only after the user confirms", async () => {
    invoke.mockResolvedValueOnce(consentRequired).mockResolvedValueOnce({ available: true, status: "available" });
    render(<AiCoreStartup canPrompt />);
    await screen.findByRole("dialog", { name: "Download AiCore using this connection?" });
    expect(invoke).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Download model" }));
    await waitFor(() => expect(invoke).toHaveBeenLastCalledWith("aicore_prepare", { allowMeteredDownload: true }));
  });

  it("skips the metered download when the user dismisses the prompt", async () => {
    invoke.mockResolvedValueOnce(consentRequired);
    render(<AiCoreStartup canPrompt />);
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it.each([["false", "aicore"], [null, "openai"]] as const)("skips setup with AI enabled %s and provider %s", async (enabled, provider) => {
    vi.mocked(getSetting).mockResolvedValue(enabled);
    vi.mocked(getActiveProviderName).mockResolvedValue(provider);
    render(<AiCoreStartup canPrompt />);
    await act(async () => {});
    expect(invoke).not.toHaveBeenCalled();
  });
});
