import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInvoke = vi.fn();
const mockOn = vi.fn();
(globalThis as unknown as { window?: { supermail?: unknown } }).window = {
  supermail: {
    invoke: mockInvoke,
    on: mockOn,
  },
};

import {
  checkForUpdateNow,
  installUpdate,
  getAvailableUpdate,
  setUpdateCallback,
  startUpdateChecker,
  _resetForTesting,
} from "./updateManager";

describe("updateManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTesting();
  });

  it("checks for updates and returns null when no update", async () => {
    mockInvoke.mockResolvedValue(null);
    const result = await checkForUpdateNow();
    expect(result).toBeNull();
    expect(getAvailableUpdate()).toBeNull();
  });

  it("detects and stores available update", async () => {
    mockInvoke.mockResolvedValue({
      version: "0.5.0",
      body: "Bug fixes",
    });

    const cb = vi.fn();
    setUpdateCallback(cb);

    const result = await checkForUpdateNow();
    expect(result).toEqual({ version: "0.5.0", body: "Bug fixes" });
    expect(getAvailableUpdate()).toEqual({ version: "0.5.0", body: "Bug fixes" });
    expect(cb).toHaveBeenCalledWith({ version: "0.5.0", body: "Bug fixes" });
  });

  it("throws error when installing without available update", async () => {
    await expect(installUpdate()).rejects.toThrow("No update available");
  });

  it("installs update when available", async () => {
    mockInvoke.mockResolvedValueOnce({
      version: "0.5.0",
      body: "Bug fixes",
    });
    mockInvoke.mockResolvedValueOnce(undefined);

    await checkForUpdateNow();
    await installUpdate();

    expect(mockInvoke).toHaveBeenCalledWith("install_update");
  });

  it("handles push update events from electron-updater", () => {
    let eventHandler: ((data: unknown) => void) | undefined;
    mockOn.mockImplementation((channel: string, handler: (data: unknown) => void) => {
      if (channel === "supermail:update-available") {
        eventHandler = handler;
      }
      return () => {};
    });

    const cb = vi.fn();
    setUpdateCallback(cb);
    startUpdateChecker();

    expect(mockOn).toHaveBeenCalledWith("supermail:update-available", expect.any(Function));
    expect(eventHandler).toBeDefined();

    eventHandler!({ version: "0.6.0", body: "New features" });

    expect(getAvailableUpdate()).toEqual({ version: "0.6.0", body: "New features" });
    expect(cb).toHaveBeenCalledWith({ version: "0.6.0", body: "New features" });
  });
});
