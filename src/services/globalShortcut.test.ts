import { vi, beforeEach, describe, it, expect } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), get: vi.fn(), set: vi.fn(), compose: vi.fn() }));
vi.mock("@/platform", () => ({ isElectron: () => true, platformInvoke: mocks.invoke }));
vi.mock("./db/settings", () => ({ getSetting: mocks.get, setSetting: mocks.set }));
vi.mock("../stores/composerStore", () => ({ useComposerStore: { getState: () => ({ openComposer: mocks.compose }) } }));
import { initGlobalShortcut, registerComposeShortcut, unregisterComposeShortcut, getCurrentShortcut, getComposeShortcutError } from "./globalShortcut";

describe("native compose shortcut", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.invoke.mockResolvedValue(undefined); mocks.get.mockResolvedValue(null); mocks.set.mockResolvedValue(undefined); });
  it("registers with Electron and opens compose on a native event", async () => {
    let listener: (() => void) | undefined;
    const cleanup = vi.fn();
    window.supermail = { on: (_channel, callback) => { listener = callback; return cleanup; } };
    await initGlobalShortcut();
    expect(mocks.invoke).toHaveBeenCalledWith("register_compose_shortcut", { shortcut: "CmdOrCtrl+Shift+M" });
    listener?.();
    expect(mocks.compose).toHaveBeenCalledOnce();
    await unregisterComposeShortcut();
    expect(cleanup).toHaveBeenCalledOnce();
  });
  it("does not save a shortcut rejected by the OS", async () => {
    await registerComposeShortcut("Control+M");
    mocks.set.mockClear();
    mocks.invoke.mockRejectedValueOnce(new Error("Shortcut taken"));
    await expect(registerComposeShortcut("Control+N")).rejects.toThrow("Shortcut taken");
    expect(getCurrentShortcut()).toBe("Control+M");
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("exposes startup registration failures without preventing app initialization", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("Global shortcut portal unavailable"));
    await initGlobalShortcut();
    expect(getCurrentShortcut()).toBeNull();
    expect(getComposeShortcutError()).toBe("Global shortcut portal unavailable");
    await registerComposeShortcut("Control+N");
    expect(getComposeShortcutError()).toBeNull();
  });
  it("restores the old native binding if saving the preference fails", async () => {
    await registerComposeShortcut("Control+M");
    mocks.invoke.mockClear();
    mocks.set.mockRejectedValueOnce(new Error("Database unavailable"));
    await expect(registerComposeShortcut("Control+N")).rejects.toThrow("Database unavailable");
    expect(mocks.invoke.mock.calls).toEqual([
      ["register_compose_shortcut", { shortcut: "Control+N" }],
      ["register_compose_shortcut", { shortcut: "Control+M" }],
    ]);
    expect(getCurrentShortcut()).toBe("Control+M");
  });
});
