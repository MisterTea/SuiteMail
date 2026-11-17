import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  startAccountIdle,
  stopAccountIdle,
  startAllIdle,
  stopAllIdle,
  onMailboxChange,
} from "./idleManager";
import type { DbAccount } from "../db/accounts";

const mockTriggerSync = vi.fn();

vi.mock("../gmail/syncManager", () => ({
  triggerSync: (...args: unknown[]) => mockTriggerSync(...args),
}));

describe("idleManager", () => {
  const dummyImapAccount: DbAccount = {
    id: "acc-imap-1",
    email: "user@fastmail.com",
    displayName: "Fastmail User",
    avatarUrl: null,
    historyId: null,
    provider: "imap",
    imap_host: "imap.fastmail.com",
    imap_port: 993,
    imap_security: "ssl",
    imap_username: null,
    imap_password: "enc-password",
    smtp_host: "smtp.fastmail.com",
    smtp_port: 465,
    smtp_security: "ssl",
    auth_method: "password",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    stopAllIdle();
  });

  it("triggers sync when onMailboxChange is called", async () => {
    mockTriggerSync.mockResolvedValue(undefined);
    await onMailboxChange("acc-imap-1");
    expect(mockTriggerSync).toHaveBeenCalledWith(["acc-imap-1"]);
  });

  it("starts and stops an idle session for an IMAP account", () => {
    const session = startAccountIdle(dummyImapAccount);
    expect(session.active).toBe(true);
    expect(session.accountId).toBe("acc-imap-1");

    stopAccountIdle("acc-imap-1");
  });

  it("starts idle sessions for all IMAP accounts and ignores non-IMAP", () => {
    const dummyGmailAccount: DbAccount = {
      ...dummyImapAccount,
      id: "acc-gmail-1",
      provider: "gmail_api",
    };

    startAllIdle([dummyImapAccount, dummyGmailAccount]);
    stopAllIdle();
  });
});
