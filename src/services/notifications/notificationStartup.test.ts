import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPlatform: vi.fn(),
  getSetting: vi.fn(),
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  addListener: vi.fn(),
  schedule: vi.fn(),
  start: vi.fn(),
  getThreadById: vi.fn(),
  isAiAvailable: vi.fn(),
  summarizeInboxThread: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: mocks.getPlatform } }));
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: {
  checkPermissions: mocks.checkPermissions,
  requestPermissions: mocks.requestPermissions,
  addListener: mocks.addListener,
  schedule: mocks.schedule,
} }));
vi.mock("../db/settings", () => ({ getSetting: mocks.getSetting, addSettingChangeListener: vi.fn() }));
vi.mock("../db/threads", () => ({ getThreadById: mocks.getThreadById }));
vi.mock("../ai/providerManager", () => ({ isAiAvailable: mocks.isAiAvailable }));
vi.mock("../ai/aiService", () => ({ summarizeInboxThread: mocks.summarizeInboxThread }));
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

describe("Android new mail notifications", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.checkPermissions.mockResolvedValue({ display: "granted" });
    mocks.getThreadById.mockResolvedValue({ subject: "Quick question", last_message_at: 123, message_count: 1 });
    mocks.isAiAvailable.mockResolvedValue(true);
  });

  afterEach(() => vi.useRealTimers());

  it("includes the inbox summary and preserves the notification's thread context", async () => {
    mocks.summarizeInboxThread.mockResolvedValue("Christian asks to meet on Tuesday.");
    const { queueNewEmailNotification } = await import("./notificationManager");

    queueNewEmailNotification("Christian", "Quick question", "thread-1", "account-1", "sender@example.com", "Hi, are you free Tuesday?");
    await vi.advanceTimersByTimeAsync(2000);
    await vi.dynamicImportSettled();

    expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith({ notifications: [expect.objectContaining({
      title: "Christian",
      body: "Quick question — Christian asks to meet on Tuesday.",
      largeBody: "Quick question\nChristian asks to meet on Tuesday.",
      extra: { threadId: "thread-1", accountId: "account-1", fromAddress: "sender@example.com", subject: "Quick question" },
    })] });
  });

  it("shows the message preview when the summary takes too long", async () => {
    mocks.summarizeInboxThread.mockImplementation(() => new Promise(() => {}));
    const { queueNewEmailNotification } = await import("./notificationManager");

    queueNewEmailNotification("Christian", "Quick question", "thread-1", "account-1", undefined, "  Hi,\nare you free Tuesday?  ");
    await vi.advanceTimersByTimeAsync(2000);
    await vi.dynamicImportSettled();
    expect(mocks.summarizeInboxThread).toHaveBeenCalledOnce();
    expect(mocks.schedule).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);

    expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith({ notifications: [expect.objectContaining({
      largeBody: "Quick question\nHi, are you free Tuesday?",
    })] });
  });
});
