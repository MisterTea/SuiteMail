import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPlatform: vi.fn(),
  registerPlugin: vi.fn(),
  showNotification: vi.fn(),
  addMailNotificationListener: vi.fn(),
  getPendingNotificationActions: vi.fn(),
  acknowledgeNotificationAction: vi.fn(),
  getSetting: vi.fn(),
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  addListener: vi.fn(),
  schedule: vi.fn(),
  start: vi.fn(),
  getThreadById: vi.fn(),
  getMessagesForThread: vi.fn(),
  isAiAvailable: vi.fn(),
  summarizeInboxThread: vi.fn(),
  generateSmartReplies: vi.fn(),
  archiveThread: vi.fn(),
  markThreadRead: vi.fn(),
  sendEmail: vi.fn(),
  getDefaultSignature: vi.fn(),
  upsertContact: vi.fn(),
  getAllAccounts: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: mocks.getPlatform },
  registerPlugin: mocks.registerPlugin,
}));
vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: {
    checkPermissions: mocks.checkPermissions,
    requestPermissions: mocks.requestPermissions,
    addListener: mocks.addListener,
    schedule: mocks.schedule,
  },
}));
vi.mock("../db/settings", () => ({
  getSetting: mocks.getSetting,
  setSetting: vi.fn(async () => {}),
  addSettingChangeListener: vi.fn(),
}));
vi.mock("../db/threads", () => ({ getThreadById: mocks.getThreadById }));
vi.mock("../db/messages", () => ({ getMessagesForThread: mocks.getMessagesForThread }));
vi.mock("../db/signatures", () => ({ getDefaultSignature: mocks.getDefaultSignature }));
vi.mock("../db/contacts", () => ({ upsertContact: mocks.upsertContact }));
vi.mock("../db/accounts", () => ({ getAllAccounts: mocks.getAllAccounts }));
vi.mock("../ai/providerManager", () => ({ isAiAvailable: mocks.isAiAvailable }));
vi.mock("../ai/aiService", () => ({
  summarizeInboxThread: mocks.summarizeInboxThread,
  generateSmartReplies: mocks.generateSmartReplies,
}));
vi.mock("../emailActions", () => ({
  archiveThread: mocks.archiveThread,
  markThreadRead: mocks.markThreadRead,
  sendEmail: mocks.sendEmail,
}));
vi.mock("../backgroundCheckers", () => ({ createBackgroundChecker: () => ({ start: mocks.start }) }));
vi.mock("../../router/navigate", () => ({ navigateToLabel: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.getPlatform.mockReturnValue("android");
  mocks.registerPlugin.mockReturnValue({
    showNotification: mocks.showNotification,
    addListener: mocks.addMailNotificationListener,
    getPendingNotificationActions: mocks.getPendingNotificationActions,
    acknowledgeNotificationAction: mocks.acknowledgeNotificationAction,
  });
  mocks.showNotification.mockResolvedValue(undefined);
  mocks.addMailNotificationListener.mockResolvedValue({ remove: vi.fn() });
  mocks.getPendingNotificationActions.mockResolvedValue({ actions: [] });
  mocks.acknowledgeNotificationAction.mockResolvedValue(undefined);
  mocks.getSetting.mockResolvedValue(null);
  mocks.checkPermissions.mockResolvedValue({ display: "granted" });
  mocks.requestPermissions.mockResolvedValue({ display: "granted" });
  mocks.addListener.mockResolvedValue({ remove: vi.fn() });
  mocks.getThreadById.mockResolvedValue({ subject: "Happy Thanksgiving", last_message_at: 123, message_count: 1 });
  mocks.getMessagesForThread.mockResolvedValue([
    {
      id: "msg-1",
      account_id: "account-1",
      thread_id: "thread-1",
      from_address: "brian@example.com",
      from_name: "Brian Baraty",
      reply_to: null,
      subject: "Happy Thanksgiving",
      snippet: "Wishing you and your family a restful holiday.",
      body_text: "Wishing you and your family a restful holiday.",
      message_id_header: "<msg-1@example.com>",
      references_header: null,
    },
  ]);
  mocks.isAiAvailable.mockResolvedValue(true);
  mocks.summarizeInboxThread.mockResolvedValue("Brian wishes you a Happy Thanksgiving.");
  mocks.generateSmartReplies.mockResolvedValue([
    "Happy Thanksgiving to you too!",
    "Thanks Brian, have a great holiday!",
    "Thanks, looking forward to the on-site!",
  ]);
  mocks.archiveThread.mockResolvedValue({ success: true });
  mocks.markThreadRead.mockResolvedValue({ success: true });
  mocks.sendEmail.mockResolvedValue({ success: true });
  mocks.getDefaultSignature.mockResolvedValue(null);
  mocks.upsertContact.mockResolvedValue(undefined);
  mocks.getAllAccounts.mockResolvedValue([
    { id: "account-1", email: "jason@example.com" },
  ]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Android notification actions and AI quick replies", () => {
  it("attaches AI-generated smart replies to Android notifications", async () => {
    vi.useFakeTimers();
    const { queueNewEmailNotification } = await import("./notificationManager");

    queueNewEmailNotification(
      "Brian Baraty",
      "Happy Thanksgiving",
      "thread-1",
      "account-1",
      "brian@example.com",
      "Wishing you a restful holiday.",
      1704067200000,
    );
    await vi.advanceTimersByTimeAsync(2000);
    await vi.dynamicImportSettled();

    expect(mocks.generateSmartReplies).toHaveBeenCalledWith(
      "thread-1",
      "account-1",
      expect.arrayContaining([expect.objectContaining({ id: "msg-1" })]),
    );
    expect(mocks.showNotification).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      title: "Brian Baraty",
      smartReplies: [
        "Happy Thanksgiving to you too!",
        "Thanks Brian, have a great holiday!",
        "Thanks, looking forward to the on-site!",
      ],
    }));
  });

  it("skips AI smart replies for no-reply senders", async () => {
    vi.useFakeTimers();
    const { queueNewEmailNotification } = await import("./notificationManager");

    queueNewEmailNotification(
      "Vercel",
      "Your Vercel security code: 489208",
      "thread-1",
      "account-1",
      "no-reply@vercel.com",
      "Security code 489208",
      1704067200000,
    );
    await vi.advanceTimersByTimeAsync(2000);
    await vi.dynamicImportSettled();

    expect(mocks.generateSmartReplies).not.toHaveBeenCalled();
    expect(mocks.showNotification).toHaveBeenCalledExactlyOnceWith(expect.not.objectContaining({
      smartReplies: expect.anything(),
    }));
  });

  it("archives, marks as read, and sends replies from Android notification actions", async () => {
    const { initNotifications, handleAndroidNotificationAction } = await import("./notificationManager");
    const { useAccountStore } = await import("../../stores/accountStore");
    useAccountStore.setState({
      accounts: [{ id: "account-1", email: "jason@example.com", displayName: "Jason", avatarUrl: null, isActive: true }],
    });

    await initNotifications();
    expect(mocks.addMailNotificationListener).toHaveBeenCalledWith("mailNotificationAction", expect.any(Function));

    await handleAndroidNotificationAction({
      id: "act-1",
      action: "archive",
      context: { accountId: "account-1", threadId: "thread-1" },
    });
    expect(mocks.archiveThread).toHaveBeenCalledExactlyOnceWith("account-1", "thread-1", ["msg-1"]);
    expect(mocks.acknowledgeNotificationAction).toHaveBeenCalledWith({ id: "act-1" });

    // Duplicate action ID should be ignored
    await handleAndroidNotificationAction({
      id: "act-1",
      action: "archive",
      context: { accountId: "account-1", threadId: "thread-1" },
    });
    expect(mocks.archiveThread).toHaveBeenCalledOnce();

    await handleAndroidNotificationAction({
      id: "act-2",
      action: "mark_read",
      context: { accountId: "account-1", threadId: "thread-1" },
    });
    expect(mocks.markThreadRead).toHaveBeenCalledExactlyOnceWith("account-1", "thread-1", ["msg-1"], true);
    expect(mocks.acknowledgeNotificationAction).toHaveBeenCalledWith({ id: "act-2" });

    await handleAndroidNotificationAction({
      id: "act-3",
      action: "reply",
      replyText: "Happy Thanksgiving to you too!",
      context: { accountId: "account-1", threadId: "thread-1", fromAddress: "brian@example.com", subject: "Happy Thanksgiving" },
    });
    expect(mocks.sendEmail).toHaveBeenCalledExactlyOnceWith("account-1", expect.any(String), "thread-1");
    const rawBase64Url = mocks.sendEmail.mock.calls[0]?.[1] as string;
    const decoded = Buffer.from(rawBase64Url.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    expect(decoded).toContain("From: jason@example.com");
    expect(decoded).toContain("To: brian@example.com");
    expect(decoded).toContain("Subject: Re: Happy Thanksgiving");
    expect(decoded).toContain("In-Reply-To: <msg-1@example.com>");
    expect(decoded).toContain("Happy Thanksgiving to you too!");
    expect(mocks.markThreadRead).toHaveBeenCalledTimes(2);
    expect(mocks.upsertContact).toHaveBeenCalledWith("brian@example.com", null);
    expect(mocks.acknowledgeNotificationAction).toHaveBeenCalledWith({ id: "act-3" });
  });

  it("drains pending notification actions on startup", async () => {
    mocks.getPendingNotificationActions.mockResolvedValue({
      actions: [
        {
          id: "pending-1",
          action: "mark_read",
          context: { accountId: "account-1", threadId: "thread-1" },
        },
      ],
    });
    const { initNotifications } = await import("./notificationManager");
    await initNotifications();
    await vi.waitFor(() => {
      expect(mocks.markThreadRead).toHaveBeenCalledExactlyOnceWith("account-1", "thread-1", ["msg-1"], true);
    });
    expect(mocks.acknowledgeNotificationAction).toHaveBeenCalledWith({ id: "pending-1" });
  });
});
