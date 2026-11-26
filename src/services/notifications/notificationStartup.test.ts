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
vi.mock("../db/settings", () => ({
  getSetting: mocks.getSetting,
  setSetting: vi.fn(async () => {}),
  addSettingChangeListener: vi.fn(),
}));
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

  it("requests iOS notification permission and schedules local notifications on iOS", async () => {
    mocks.getPlatform.mockReturnValue("ios");
    const { initNotifications, sendEmailNotification } = await import("./notificationManager");
    await initNotifications();

    expect(mocks.requestPermissions).toHaveBeenCalledOnce();
    expect(mocks.addListener).toHaveBeenCalledWith("localNotificationActionPerformed", expect.any(Function));

    mocks.checkPermissions.mockResolvedValue({ display: "granted" });
    await sendEmailNotification("Brian Baraty", "Happy Thanksgiving", { accountId: "account-1", threadId: "thread-1" });
    expect(mocks.schedule).toHaveBeenCalledOnce();
    expect(mocks.showNotification).not.toHaveBeenCalled();
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
      group: "mailbox:account-1",
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

  it("batches mail by account and keeps each account's newest timestamp", async () => {
    const { queueNewEmailNotification } = await import("./notificationManager");
    const { useAccountStore } = await import("../../stores/accountStore");
    useAccountStore.setState({
      accounts: [
        { id: "account-1", email: "personal@example.com", displayName: null, avatarUrl: null, isActive: true },
        { id: "account-2", email: "work@example.com", displayName: null, avatarUrl: null, isActive: true },
      ],
    });

    queueNewEmailNotification("Carol", "Work mail", "thread-1", "account-2", "carol@example.com", "", 1704068400000);
    await vi.advanceTimersByTimeAsync(500);
    queueNewEmailNotification("Bob", "Second", "thread-2", "account-1", "bob@example.com", "Two", 1704067800000);
    queueNewEmailNotification("Alice", "First", "thread-1", "account-1", "alice@example.com", "One", 1704067200000);
    await vi.advanceTimersByTimeAsync(1500);

    expect(mocks.showNotification).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      title: "Carol",
      body: "Work mail",
      timestamp: 1704068400000,
      group: "mailbox:account-2",
      groupTitle: "work@example.com",
      extra: expect.objectContaining({ accountId: "account-2", threadId: "thread-1" }),
    }));

    await vi.advanceTimersByTimeAsync(500);

    expect(mocks.showNotification).toHaveBeenCalledTimes(2);
    expect(mocks.showNotification).toHaveBeenLastCalledWith(expect.objectContaining({
      title: "personal@example.com",
      body: "2 new emails",
      timestamp: 1704067800000,
      group: "mailbox:account-1",
      groupTitle: "personal@example.com",
      extra: { accountId: "account-1" },
    }));
  });

  it("keeps the email timestamp when desktop native grouping is unavailable", async () => {
    mocks.getPlatform.mockReturnValue("web");
    const invoke = vi.fn().mockResolvedValue(false);
    vi.stubGlobal("supermail", { isElectron: true, invoke, on: vi.fn() });
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

  it("opens the grouped desktop notification in its mailbox", async () => {
    mocks.getPlatform.mockReturnValue("web");
    const invoke = vi.fn().mockResolvedValue(true);
    const on = vi.fn();
    vi.stubGlobal("supermail", { isElectron: true, invoke, on });
    const notificationCtor = vi.fn();
    vi.stubGlobal("Notification", Object.assign(notificationCtor, { permission: "granted" }));

    const { initNotifications, sendEmailNotification } = await import("./notificationManager");
    const { useAccountStore } = await import("../../stores/accountStore");
    const { navigateToLabel } = await import("../../router/navigate");
    useAccountStore.setState({
      accounts: [{ id: "account-2", email: "work@example.com", displayName: null, avatarUrl: null, isActive: true }],
    });
    await initNotifications();
    await sendEmailNotification("Work mail", "2 new emails", { accountId: "account-2" });

    expect(invoke).toHaveBeenCalledExactlyOnceWith("show_grouped_mail_notification", {
      title: "Work mail",
      body: "2 new emails",
      group: "mailbox:account-2",
      groupTitle: "work@example.com",
      accountId: "account-2",
      threadId: undefined,
    });
    expect(notificationCtor).not.toHaveBeenCalled();
    expect(on).toHaveBeenCalledExactlyOnceWith("supermail:mail-notification-opened", expect.any(Function));
    on.mock.calls[0][1]({ accountId: "account-2" });
    expect(invoke).toHaveBeenLastCalledWith("show_main_window");
    expect(useAccountStore.getState().activeAccountId).toBe("account-2");
    expect(navigateToLabel).toHaveBeenCalledExactlyOnceWith("inbox");
  });
});
