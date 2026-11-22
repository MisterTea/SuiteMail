import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  messageMatchesFilter,
  computeFilterActions,
  applyFiltersToMessages,
  addEmail,
  downloadEmail,
  prepareFilterBatch,
  retryUnfilteredEmails,
  isEmailFiltered,
  markEmailFiltered,
} from "./filterEngine";
import type { FilterCriteria, FilterActions } from "../db/filters";
import { createMockParsedMessage } from "@/test/mocks";
import type { ImapConfig } from "../imap/electronCommands";

const mockFilters = vi.fn();
const mockEmailActions = {
  addThreadLabel: vi.fn(),
  removeThreadLabel: vi.fn(),
  markThreadRead: vi.fn(),
  starThread: vi.fn(),
};
const mockCrdtDocs: Record<string, any> = {};
const mockEnsureMetadataDownloadedForEmail = vi.fn();
const mockPushSidecarMetadata = vi.fn();
const mockGetAccount = vi.fn();

vi.mock("../db/filters", () => ({
  getEnabledFiltersForAccount: vi.fn((accId) => mockFilters(accId)),
}));

vi.mock("../emailActions", () => ({
  addThreadLabel: vi.fn((...args) => mockEmailActions.addThreadLabel(...args)),
  removeThreadLabel: vi.fn((...args) => mockEmailActions.removeThreadLabel(...args)),
  markThreadRead: vi.fn((...args) => mockEmailActions.markThreadRead(...args)),
  starThread: vi.fn((...args) => mockEmailActions.starThread(...args)),
}));

vi.mock("../db/threadCrdtDocs", () => ({
  getThreadCrdtDoc: vi.fn(async (accountId, threadId, scope = "personal") => {
    return mockCrdtDocs[`${accountId}:${threadId}:${scope}`] || null;
  }),
  upsertThreadCrdtDoc: vi.fn(async (record) => {
    const scope = record.scope || "personal";
    mockCrdtDocs[`${record.account_id}:${record.thread_id}:${scope}`] = record;
  }),
}));

vi.mock("../imap/metadataSidecarSync", () => ({
  ensureMetadataDownloadedForEmail: vi.fn((...args) =>
    mockEnsureMetadataDownloadedForEmail(...args)
  ),
  pushSidecarMetadata: vi.fn((...args) => mockPushSidecarMetadata(...args)),
}));

vi.mock("../imap/settingsSidecarSync", () => ({
  syncFilterSettings: vi.fn().mockResolvedValue(null),
}));

vi.mock("../db/accounts", () => ({
  getAccount: vi.fn((...args) => mockGetAccount(...args)),
}));

const testImapConfig: ImapConfig = {
  host: "imap.example.com",
  port: 993,
  security: "tls",
  username: "user@example.com",
  password: "password",
  auth_method: "password",
};

describe("messageMatchesFilter", () => {
  it("matches from criteria (case-insensitive)", () => {
    const msg = createMockParsedMessage();
    const criteria: FilterCriteria = { from: "alice" };
    expect(messageMatchesFilter(msg, criteria)).toBe(true);
  });

  it("matches from name", () => {
    const msg = createMockParsedMessage();
    const criteria: FilterCriteria = { from: "Smith" };
    expect(messageMatchesFilter(msg, criteria)).toBe(true);
  });

  it("does not match wrong from", () => {
    const msg = createMockParsedMessage();
    const criteria: FilterCriteria = { from: "charlie" };
    expect(messageMatchesFilter(msg, criteria)).toBe(false);
  });

  it("matches to criteria", () => {
    const msg = createMockParsedMessage();
    const criteria: FilterCriteria = { to: "bob" };
    expect(messageMatchesFilter(msg, criteria)).toBe(true);
  });

  it("does not match wrong to", () => {
    const msg = createMockParsedMessage();
    const criteria: FilterCriteria = { to: "charlie" };
    expect(messageMatchesFilter(msg, criteria)).toBe(false);
  });

  it("matches subject criteria", () => {
    const msg = createMockParsedMessage();
    const criteria: FilterCriteria = { subject: "project" };
    expect(messageMatchesFilter(msg, criteria)).toBe(true);
  });

  it("does not match wrong subject", () => {
    const msg = createMockParsedMessage();
    const criteria: FilterCriteria = { subject: "invoice" };
    expect(messageMatchesFilter(msg, criteria)).toBe(false);
  });

  it("matches body criteria in text", () => {
    const msg = createMockParsedMessage();
    const criteria: FilterCriteria = { body: "hello from" };
    expect(messageMatchesFilter(msg, criteria)).toBe(true);
  });

  it("matches hasAttachment criteria", () => {
    const msg = createMockParsedMessage({ hasAttachments: true });
    const criteria: FilterCriteria = { hasAttachment: true };
    expect(messageMatchesFilter(msg, criteria)).toBe(true);
  });

  it("does not match hasAttachment when no attachments", () => {
    const msg = createMockParsedMessage({ hasAttachments: false });
    const criteria: FilterCriteria = { hasAttachment: true };
    expect(messageMatchesFilter(msg, criteria)).toBe(false);
  });

  it("ANDs multiple criteria together", () => {
    const msg = createMockParsedMessage();
    const criteria: FilterCriteria = { from: "alice", subject: "project" };
    expect(messageMatchesFilter(msg, criteria)).toBe(true);
  });

  it("fails AND when one criterion misses", () => {
    const msg = createMockParsedMessage();
    const criteria: FilterCriteria = { from: "alice", subject: "invoice" };
    expect(messageMatchesFilter(msg, criteria)).toBe(false);
  });

  it("matches with empty criteria (matches everything)", () => {
    const msg = createMockParsedMessage();
    const criteria: FilterCriteria = {};
    expect(messageMatchesFilter(msg, criteria)).toBe(true);
  });

  it("handles null fromAddress gracefully", () => {
    const msg = createMockParsedMessage({ fromAddress: null, fromName: null });
    const criteria: FilterCriteria = { from: "alice" };
    expect(messageMatchesFilter(msg, criteria)).toBe(false);
  });

  it("handles null toAddresses gracefully", () => {
    const msg = createMockParsedMessage({ toAddresses: null });
    const criteria: FilterCriteria = { to: "bob" };
    expect(messageMatchesFilter(msg, criteria)).toBe(false);
  });
});

describe("computeFilterActions", () => {
  it("returns empty result for empty actions", () => {
    const result = computeFilterActions({});
    expect(result.addLabelIds).toEqual([]);
    expect(result.removeLabelIds).toEqual([]);
    expect(result.markRead).toBe(false);
    expect(result.star).toBe(false);
  });

  it("adds label", () => {
    const actions: FilterActions = { applyLabel: "Label_123" };
    const result = computeFilterActions(actions);
    expect(result.addLabelIds).toContain("Label_123");
  });

  it("archives (removes INBOX)", () => {
    const actions: FilterActions = { archive: true };
    const result = computeFilterActions(actions);
    expect(result.removeLabelIds).toContain("INBOX");
  });

  it("trashes (adds TRASH, removes INBOX)", () => {
    const actions: FilterActions = { trash: true };
    const result = computeFilterActions(actions);
    expect(result.addLabelIds).toContain("TRASH");
    expect(result.removeLabelIds).toContain("INBOX");
  });

  it("stars (adds STARRED)", () => {
    const actions: FilterActions = { star: true };
    const result = computeFilterActions(actions);
    expect(result.addLabelIds).toContain("STARRED");
    expect(result.star).toBe(true);
  });

  it("marks as read", () => {
    const actions: FilterActions = { markRead: true };
    const result = computeFilterActions(actions);
    expect(result.markRead).toBe(true);
  });

  it("combines multiple actions", () => {
    const actions: FilterActions = {
      applyLabel: "Label_1",
      archive: true,
      star: true,
      markRead: true,
    };
    const result = computeFilterActions(actions);
    expect(result.addLabelIds).toContain("Label_1");
    expect(result.addLabelIds).toContain("STARRED");
    expect(result.removeLabelIds).toContain("INBOX");
    expect(result.markRead).toBe(true);
    expect(result.star).toBe(true);
  });
});

describe("applyFiltersToMessages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureMetadataDownloadedForEmail.mockReset();
    mockFilters.mockResolvedValue([]);
  });

  it("does nothing when account has no enabled filters", async () => {
    mockFilters.mockResolvedValueOnce([]);
    const msg = createMockParsedMessage({ threadId: "t-1" });
    await applyFiltersToMessages("acc-1", [msg]);
    expect(mockEmailActions.addThreadLabel).not.toHaveBeenCalled();
  });

  it("applies matched filter actions to threads", async () => {
    mockFilters.mockResolvedValueOnce([
      {
        id: "f-1",
        account_id: "acc-1",
        criteria_json: JSON.stringify({ from: "alice" }),
        actions_json: JSON.stringify({ applyLabel: "VIP", star: true }),
        is_enabled: 1,
      },
    ]);
    const msg = createMockParsedMessage({
      threadId: "t-100",
      fromAddress: "alice@example.com",
    });
    await applyFiltersToMessages("acc-1", [msg]);
    expect(mockEmailActions.addThreadLabel).toHaveBeenCalledWith(
      "acc-1",
      "t-100",
      "VIP",
    );
    expect(mockEmailActions.starThread).toHaveBeenCalledWith(
      "acc-1",
      "t-100",
      [],
      true,
    );
  });
});

describe("addEmail with client-side filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureMetadataDownloadedForEmail.mockReset();
    mockFilters.mockReset();
    mockFilters.mockResolvedValue([]);
    for (const k of Object.keys(mockCrdtDocs)) delete mockCrdtDocs[k];
    mockGetAccount.mockResolvedValue({
      id: "acc-1",
      provider: "imap",
      email: "user@example.com",
    });
  });

  it("applies filter rules and marks email as filtered when adding an unfiltered email", async () => {
    mockFilters.mockResolvedValueOnce([
      {
        id: "f-1",
        account_id: "acc-1",
        criteria_json: JSON.stringify({ from: "boss" }),
        actions_json: JSON.stringify({ applyLabel: "Urgent", star: true }),
        is_enabled: 1,
      },
    ]);

    const msg = createMockParsedMessage({
      threadId: "thread-unfiltered-1",
      fromAddress: "boss@work.com",
    });

    expect(await isEmailFiltered("acc-1", "thread-unfiltered-1")).toBe(false);

    const result = await addEmail(
      "acc-1",
      "thread-unfiltered-1",
      [msg],
      testImapConfig,
    );
    expect(result.filtered).toBe(true);

    // Verify filter actions were applied
    expect(mockEmailActions.addThreadLabel).toHaveBeenCalledWith(
      "acc-1",
      "thread-unfiltered-1",
      "Urgent",
    );
    expect(mockEmailActions.starThread).toHaveBeenCalledWith(
      "acc-1",
      "thread-unfiltered-1",
      [],
      true,
    );

    // Verify email is now marked as filtered in metadata
    expect(await isEmailFiltered("acc-1", "thread-unfiltered-1")).toBe(true);

    // Verify sidecar metadata was pushed
    expect(mockPushSidecarMetadata).toHaveBeenCalledWith(
      testImapConfig,
      "user@example.com",
      expect.objectContaining({
        conversationId: "thread-unfiltered-1",
        isFiltered: true,
      }),
    );
  });

  it("skips filter rules when adding an email that is already marked as filtered in metadata", async () => {
    mockFilters.mockResolvedValue([
      {
        id: "f-1",
        account_id: "acc-1",
        criteria_json: JSON.stringify({ from: "boss" }),
        actions_json: JSON.stringify({ applyLabel: "Urgent" }),
        is_enabled: 1,
      },
    ]);

    // Pre-mark email as filtered in metadata
    await markEmailFiltered("acc-1", "thread-already-filtered", true);
    expect(await isEmailFiltered("acc-1", "thread-already-filtered")).toBe(true);

    const msg = createMockParsedMessage({
      threadId: "thread-already-filtered",
      fromAddress: "boss@work.com",
    });

    const result = await addEmail(
      "acc-1",
      "thread-already-filtered",
      [msg],
      testImapConfig,
    );
    expect(result.filtered).toBe(false);

    // Verify filter actions were NOT applied
    expect(mockEmailActions.addThreadLabel).not.toHaveBeenCalled();
    expect(mockFilters).not.toHaveBeenCalled();
  });
});

describe("downloadEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureMetadataDownloadedForEmail.mockReset();
    mockFilters.mockReset();
    mockFilters.mockResolvedValue([]);
    for (const k of Object.keys(mockCrdtDocs)) delete mockCrdtDocs[k];
    mockGetAccount.mockResolvedValue({
      id: "acc-1",
      provider: "imap",
      email: "user@example.com",
    });
  });

  it("makes sure pending metadata is downloaded before adding/assuming an empty metadata item", async () => {
    mockFilters.mockResolvedValue([
      {
        id: "f-1",
        account_id: "acc-1",
        criteria_json: JSON.stringify({ from: "newsletter" }),
        actions_json: JSON.stringify({ applyLabel: "Newsletters" }),
        is_enabled: 1,
      },
    ]);

    // Simulate that when ensureMetadataDownloadedForEmail runs, it downloads remote metadata
    // that already marked this email as filtered on another client
    mockEnsureMetadataDownloadedForEmail.mockImplementationOnce(
      async (accId: string, _config: any, tId: string) => {
        await markEmailFiltered(accId, tId, true);
        return 1;
      },
    );

    const msg = createMockParsedMessage({
      threadId: "thread-pending-meta",
      fromAddress: "newsletter@site.com",
    });

    const result = await downloadEmail(
      "acc-1",
      "thread-pending-meta",
      [msg],
      testImapConfig,
    );

    // 1. Made sure pending metadata was checked/downloaded first
    expect(mockEnsureMetadataDownloadedForEmail).toHaveBeenCalledWith(
      "acc-1",
      testImapConfig,
      "thread-pending-meta",
    );

    // 2. Because remote metadata was downloaded and marked it as filtered,
    // it did NOT assume an empty metadata item or apply filters again
    expect(result.filtered).toBe(false);
    expect(mockEmailActions.addThreadLabel).not.toHaveBeenCalled();
  });

  it("refreshes once per batch and rechecks remote completion markers", async () => {
    mockEnsureMetadataDownloadedForEmail.mockImplementationOnce(async () => {
      await markEmailFiltered("acc-1", "remote-complete", true);
    });
    const filter = await prepareFilterBatch("acc-1", testImapConfig);
    expect((await filter("remote-complete", createMockParsedMessage({ threadId: "remote-complete" }))).filtered).toBe(false);
    await filter("new-in-batch", createMockParsedMessage({ threadId: "new-in-batch" }));
    expect(mockEnsureMetadataDownloadedForEmail).toHaveBeenCalledTimes(1);
  });

  it("does not run filters if refreshing rules fails", async () => {
    const { syncFilterSettings } = await import("../imap/settingsSidecarSync");
    vi.mocked(syncFilterSettings).mockRejectedValueOnce(new Error("rules unavailable"));
    await expect(prepareFilterBatch("acc-1", testImapConfig)).rejects.toThrow("rules unavailable");
    expect(mockFilters).not.toHaveBeenCalled();
    expect(mockEnsureMetadataDownloadedForEmail).not.toHaveBeenCalled();
  });

  it("retries saved unfiltered mail without requiring newly downloaded mail", async () => {
    const connection = await import("../db/connection");
    const messagesDb = await import("../db/messages");
    const operations = await import("../db/pendingOperations");
    const select = vi.fn().mockResolvedValueOnce([{ id: "saved-thread" }]).mockResolvedValue([]);
    const dbSpy = vi.spyOn(connection, "getDb").mockResolvedValue({ select, execute: vi.fn().mockResolvedValue({}) } as any);
    const messagesSpy = vi.spyOn(messagesDb, "getMessagesForThread").mockResolvedValue([{
      id: "saved-message", thread_id: "saved-thread", account_id: "acc-1", date: 123,
      subject: "Saved mail", is_read: 0, is_starred: 0,
    } as any]);
    const opsSpy = vi.spyOn(operations, "getPendingOpsForResource").mockResolvedValue([]);
    try {
      await retryUnfilteredEmails("acc-1", testImapConfig);
      expect(messagesSpy).toHaveBeenCalledWith("acc-1", "saved-thread");
      expect(await isEmailFiltered("acc-1", "saved-thread")).toBe(true);
      expect(mockPushSidecarMetadata).toHaveBeenCalled();
    } finally {
      dbSpy.mockRestore();
      messagesSpy.mockRestore();
      opsSpy.mockRestore();
    }
  });

  it("defers filtering when metadata refresh fails", async () => {
    mockEnsureMetadataDownloadedForEmail.mockRejectedValueOnce(new Error("offline"));
    await expect(downloadEmail("acc-1", "deferred", createMockParsedMessage({ threadId: "deferred" }), testImapConfig)).rejects.toThrow("offline");
    expect(mockFilters).not.toHaveBeenCalled();
    expect(await isEmailFiltered("acc-1", "deferred")).toBe(false);
    expect(mockPushSidecarMetadata).not.toHaveBeenCalled();
  });

  it("leaves failed actions unfiltered and retries successfully", async () => {
    mockFilters.mockResolvedValue([{ criteria_json: '{}', actions_json: '{"applyLabel":"VIP"}' }]);
    mockEmailActions.addThreadLabel.mockRejectedValueOnce(new Error("provider unavailable"));
    const msg = createMockParsedMessage({ threadId: "retry-actions" });
    await expect(downloadEmail("acc-1", msg.threadId, msg, testImapConfig)).rejects.toThrow("provider unavailable");
    expect(await isEmailFiltered("acc-1", msg.threadId)).toBe(false);
    expect(mockPushSidecarMetadata).not.toHaveBeenCalled();
    await downloadEmail("acc-1", msg.threadId, msg, testImapConfig);
    expect(await isEmailFiltered("acc-1", msg.threadId)).toBe(true);
  });

  it("applies filter rules and marks metadata when no remote metadata exists to download", async () => {
    mockFilters.mockResolvedValue([
      {
        id: "f-1",
        account_id: "acc-1",
        criteria_json: JSON.stringify({ from: "invoice" }),
        actions_json: JSON.stringify({ applyLabel: "Finance" }),
        is_enabled: 1,
      },
    ]);

    // No pending metadata on server
    mockEnsureMetadataDownloadedForEmail.mockResolvedValueOnce(0);

    const msg = createMockParsedMessage({
      threadId: "thread-new-download",
      fromAddress: "invoice@billing.com",
    });

    const result = await downloadEmail(
      "acc-1",
      "thread-new-download",
      [msg],
      testImapConfig,
    );

    // 1. Verified pending metadata was checked first
    expect(mockEnsureMetadataDownloadedForEmail).toHaveBeenCalledWith(
      "acc-1",
      testImapConfig,
      "thread-new-download",
    );

    // 2. Added email, applied filter rules, and set metadata
    expect(result.filtered).toBe(true);
    expect(mockEmailActions.addThreadLabel).toHaveBeenCalledWith(
      "acc-1",
      "thread-new-download",
      "Finance",
    );
    expect(await isEmailFiltered("acc-1", "thread-new-download")).toBe(true);
  });
});
