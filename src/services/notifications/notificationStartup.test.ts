import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPlatform: vi.fn(),
  registerPlugin: vi.fn(),
  showNotification: vi.fn(),
  addMailNotificationListener: vi.fn(),
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

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: mocks.getPlatform },
  registerPlugin: mocks.registerPlugin,
}));
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
  mocks.registerPlugin.mockReturnValue({
    showNotification: mocks.showNotification,
    addListener: mocks.addMailNotificationListener,
  });
  mocks.showNotification.mockResolvedValue(undefined);
  mocks.addMailNotificationListener.mockResolvedValue({ remove: vi.fn() });
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
    expect(mocks.addMailNotificationListener).toHaveBeenCalledWith("mailNotificationOpened", expect.any(Function));
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

  it("includes the inbox summary, email timestamp, and thread context", async () => {
    mocks.summarizeInboxThread.mockResolvedValue("Christian asks to meet on Tuesday.");
    const { queueNewEmailNotification } = await import("./notificationManager");
    const emailTime = 1704067200000;

    queueNewEmailNotification("Christian", "Quick question", "thread-1", "account-1", "sender@example.com", "Hi, are you free Tuesday?", emailTime);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.dynamicImportSettled();

    expect(mocks.showNotification).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      title: "Christian",
      body: "Quick question — Christian asks to meet on Tuesday.",
      largeBody: "Quick question\nChristian asks to meet on Tuesday.",
      timestamp: emailTime,
      extra: { threadId: "thread-1", accountId: "account-1", fromAddress: "sender@example.com", subject: "Quick question" },
    }));
  });

  it("shows the message preview when the summary takes too long", async () => {
    mocks.summarizeInboxThread.mockImplementation(() => new Promise(() => {}));
    const { queueNewEmailNotification } = await import("./notificationManager");

    queueNewEmailNotification("Christian", "Quick question", "thread-1", "account-1", undefined, "  Hi,\nare you free Tuesday?  ", 1704067200);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.dynamicImportSettled();
    expect(mocks.summarizeInboxThread).toHaveBeenCalledOnce();
    expect(mocks.showNotification).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);

    expect(mocks.showNotification).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      largeBody: "Quick question\nHi, are you free Tuesday?",
      timestamp: 1704067200000,
    }));
  });

  it("uses the latest email timestamp for batched Android notifications", async () => {
    const { queueNewEmailNotification } = await import("./notificationManager");

    queueNewEmailNotification("Alice", "First", "thread-1", "account-1", "alice@example.com", "One", 1704067200000);
    queueNewEmailNotification("Bob", "Second", "thread-2", "account-1", "bob@example.com", "Two", 1704067800000);
    await vi.advanceTimersByTimeAsync(2000);

    expect(mocks.showNotification).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      title: "SuiteMail",
      body: "2 new emails",
      timestamp: 1704067800000,
    }));
  });

  it("sets desktop notification timestamp to match the email time", async () => {
    mocks.getPlatform.mockReturnValue("web");
    const notificationCtor = vi.fn();
    function MockNotification(this: { onclick?: () => void }, title: string, options?: NotificationOptions) {
      notificationCtor(title, options);
    }
    MockNotification.permission = "granted";
    vi.stubGlobal("Notification", MockNotification);

    const { queueNewEmailNotification } = await import("./notificationManager");
    queueNewEmailNotification("Christian", "Quick question", "thread-1", "account-1", "sender@example.com", "Hi", 1704067200000);
    await vi.advanceTimersByTimeAsync(2000);

    expect(notificationCtor).toHaveBeenCalledExactlyOnceWith("Christian", {
      body: "Quick question",
      timestamp: 1704067200000,
    });
  });
});
