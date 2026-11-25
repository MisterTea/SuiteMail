import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  execute: vi.fn(),
  getSetting: vi.fn(),
  getVipSenders: vi.fn(),
  queueNewEmailNotification: vi.fn(),
  shouldNotifyForMessage: vi.fn(),
}));

vi.mock("../db/connection", () => ({
  getDb: async () => ({ select: mocks.select, execute: mocks.execute }),
  withTransaction: async (fn: (db: { select: typeof mocks.select; execute: typeof mocks.execute }) => Promise<void>) =>
    fn({ select: mocks.select, execute: mocks.execute }),
}));
vi.mock("../db/settings", () => ({ getSetting: mocks.getSetting }));
vi.mock("../db/notificationVips", () => ({ getVipSenders: mocks.getVipSenders }));
vi.mock("./notificationManager", () => ({
  queueNewEmailNotification: mocks.queueNewEmailNotification,
  shouldNotifyForMessage: mocks.shouldNotifyForMessage,
}));

import { notifyNewlySyncedMail } from "./newMail";

describe("notifyNewlySyncedMail", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSetting.mockResolvedValue(null);
    mocks.getVipSenders.mockResolvedValue(new Set<string>());
    mocks.shouldNotifyForMessage.mockReturnValue(true);
  });

  it("passes the email date when queueing a new mail notification", async () => {
    mocks.select.mockResolvedValue([
      {
        thread_id: "thread-42",
        from_name: "Alice",
        from_address: "alice@example.com",
        subject: "Dinner tonight",
        snippet: "Are we still on for 7pm?",
        date: 1704067200000,
        category: "Primary",
      },
    ]);

    await notifyNewlySyncedMail("account-1", 1704067000, true);

    expect(mocks.queueNewEmailNotification).toHaveBeenCalledExactlyOnceWith(
      "Alice",
      "Dinner tonight",
      "thread-42",
      "account-1",
      "alice@example.com",
      "Are we still on for 7pm?",
      1704067200000,
    );
  });
});
