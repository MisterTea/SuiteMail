import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPlatform: vi.fn(),
  getSetting: vi.fn(),
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  addListener: vi.fn(),
  start: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: mocks.getPlatform } }));
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: {
  checkPermissions: mocks.checkPermissions,
  requestPermissions: mocks.requestPermissions,
  addListener: mocks.addListener,
} }));
vi.mock("../db/settings", () => ({ getSetting: mocks.getSetting, addSettingChangeListener: vi.fn() }));
vi.mock("../backgroundCheckers", () => ({ createBackgroundChecker: () => ({ start: mocks.start }) }));
vi.mock("../../router/navigate", () => ({ navigateToLabel: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.getPlatform.mockReturnValue("android");
  mocks.getSetting.mockResolvedValue(null);
  mocks.checkPermissions.mockResolvedValue({ display: "prompt" });
  mocks.requestPermissions.mockResolvedValue({ display: "granted" });
  mocks.addListener.mockResolvedValue({ remove: vi.fn() });
});

afterEach(() => vi.unstubAllGlobals());

describe("notification startup", () => {
  it("requests Android notification permission once during startup", async () => {
    const { initNotifications } = await import("./notificationManager");
    await initNotifications();
    await initNotifications();

    expect(mocks.requestPermissions).toHaveBeenCalledOnce();
    expect(mocks.addListener).toHaveBeenCalledWith("localNotificationActionPerformed", expect.any(Function));
    expect(mocks.start).toHaveBeenCalledOnce();
  });

  it("does not request Android permission when already granted", async () => {
    mocks.checkPermissions.mockResolvedValue({ display: "granted" });
    const { initNotifications } = await import("./notificationManager");
    await initNotifications();

    expect(mocks.checkPermissions).toHaveBeenCalledOnce();
    expect(mocks.requestPermissions).not.toHaveBeenCalled();
  });

  it("does not request permission when notifications are disabled", async () => {
    mocks.getSetting.mockResolvedValue("false");
    const { initNotifications } = await import("./notificationManager");
    await initNotifications();

    expect(mocks.checkPermissions).not.toHaveBeenCalled();
    expect(mocks.requestPermissions).not.toHaveBeenCalled();
  });

  it("continues startup if requesting permission fails", async () => {
    mocks.requestPermissions.mockRejectedValue(new Error("Permission request unavailable"));
    const { initNotifications } = await import("./notificationManager");
    await expect(initNotifications()).resolves.toBeUndefined();
    await vi.waitFor(() => expect(mocks.requestPermissions).toHaveBeenCalledOnce());

    expect(mocks.start).toHaveBeenCalledOnce();
  });

  it("still requests desktop notification permission during startup", async () => {
    mocks.getPlatform.mockReturnValue("web");
    const requestPermission = vi.fn().mockResolvedValue("granted");
    vi.stubGlobal("Notification", { permission: "default", requestPermission });
    const { initNotifications } = await import("./notificationManager");
    await initNotifications();

    expect(requestPermission).toHaveBeenCalledOnce();
    expect(mocks.requestPermissions).not.toHaveBeenCalled();
  });
});
