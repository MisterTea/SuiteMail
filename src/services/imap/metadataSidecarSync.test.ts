// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ensureSidecarFolder,
  buildSidecarEmail,
  pushSidecarMetadata,
  syncSidecarMetadata,
  hasPendingMetadata,
  ensureMetadataDownloadedForEmail,
  syncBatchConversationLabelsToRemote,
  buildLedgerEmail,
  appendLedgerEntriesToRemote,
  parseMetadataLines,
  type SidecarPayload,
  type MetadataLedgerEntry,
} from "./metadataSidecarSync";
import type { ImapConfig, ImapFolder, ImapFetchResult } from "./electronCommands";

const mockCommands = {
  imapListFolders: vi.fn(),
  imapCreateFolder: vi.fn(),
  imapAppendMessage: vi.fn(),
  imapSearchAllUids: vi.fn(),
  imapFetchMessages: vi.fn(),
  imapGetFolderStatus: vi.fn(),
};

vi.mock("./electronCommands", () => ({
  imapListFolders: vi.fn((config) => mockCommands.imapListFolders(config)),
  imapCreateFolder: vi.fn((config, folder) => mockCommands.imapCreateFolder(config, folder)),
  imapAppendMessage: vi.fn((config, folder, raw, flags) =>
    mockCommands.imapAppendMessage(config, folder, raw, flags)
  ),
  imapSearchAllUids: vi.fn((config, folder) => mockCommands.imapSearchAllUids(config, folder)),
  imapFetchMessages: vi.fn((config, folder, uids) => mockCommands.imapFetchMessages(config, folder, uids)),
  imapGetFolderStatus: vi.fn((config, folder) => mockCommands.imapGetFolderStatus(config, folder)),
}));

const mockFolderSyncState: Record<string, any> = {};
const mockCategories: Record<string, any> = {};
const mockReminders: Record<string, any> = {};
const mockCrdtDocs: Record<string, any> = {};

vi.mock("../db/folderSyncState", () => ({
  getFolderSyncState: vi.fn(async (accId, folder) => mockFolderSyncState[`${accId}:${folder}`] || null),
  upsertFolderSyncState: vi.fn(async (st) => {
    mockFolderSyncState[`${st.account_id}:${st.folder_path}`] = st;
  }),
}));

vi.mock("../db/threadCategories", () => ({
  setThreadCategory: vi.fn(async (accountId, threadId, category, isManual) => {
    mockCategories[threadId] = { accountId, threadId, category, isManual };
  }),
}));

vi.mock("../db/followUpReminders", () => ({
  insertFollowUpReminder: vi.fn(async (accountId, threadId, messageId, remindAt) => {
    mockReminders[threadId] = { accountId, threadId, messageId, remindAt };
  }),
  cancelFollowUpForThread: vi.fn(async () => {}),
}));

vi.mock("../db/threadCrdtDocs", () => ({
  getThreadCrdtDoc: vi.fn(async (accId, tId, scope = "personal") => mockCrdtDocs[`${accId}:${tId}:${scope}`] || null),
  upsertThreadCrdtDoc: vi.fn(async (doc) => {
    const scope = doc.scope || "personal";
    mockCrdtDocs[`${doc.account_id}:${doc.thread_id}:${scope}`] = doc;
  }),
}));

vi.mock("../db/metadataHistory", () => ({
  recordMetadataChange: vi.fn(async () => ({})),
  recordMetadataLedgerEntry: vi.fn(async () => {}),
  markMetadataChangeReverted: vi.fn(async () => {}),
}));

vi.mock("../crdt/metadataCrdt", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../crdt/metadataCrdt")>();
  return {
    ...actual,
    setConversationMetadataLabels: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../db/accounts", () => ({
  getAccount: vi.fn(async () => ({
    id: "acc-1",
    email: "user@example.com",
    provider: "imap",
  })),
}));

vi.mock("../sync/outgoingSyncGuard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sync/outgoingSyncGuard")>();
  return {
    ...actual,
    checkOutgoingSyncAllowed: vi.fn().mockResolvedValue(true),
  };
});

import { checkOutgoingSyncAllowed } from "../sync/outgoingSyncGuard";
import { setConversationMetadataLabels } from "../crdt/metadataCrdt";

const testConfig: ImapConfig = {
  host: "imap.example.com",
  port: 993,
  security: "tls",
  username: "user@example.com",
  password: "password",
  auth_method: "password",
};

describe("metadataSidecarSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(mockFolderSyncState)) delete mockFolderSyncState[k];
    for (const k of Object.keys(mockCategories)) delete mockCategories[k];
    for (const k of Object.keys(mockReminders)) delete mockReminders[k];
    for (const k of Object.keys(mockCrdtDocs)) delete mockCrdtDocs[k];
  });

  it("ensures the sidecar folder exists or creates it", async () => {
    // 1. When folder already exists
    mockCommands.imapListFolders.mockResolvedValueOnce([
      { path: "INBOX", name: "INBOX", raw_path: "INBOX" },
      { path: ".metadata", name: ".metadata", raw_path: ".metadata" },
    ]);

    const folder1 = await ensureSidecarFolder(testConfig);
    expect(folder1).toBe(".metadata");
    expect(mockCommands.imapCreateFolder).not.toHaveBeenCalled();

    // 2. When folder does not exist
    mockCommands.imapListFolders.mockResolvedValueOnce([
      { path: "INBOX", name: "INBOX", raw_path: "INBOX" },
    ]);
    mockCommands.imapCreateFolder.mockResolvedValueOnce(undefined);

    const folder2 = await ensureSidecarFolder(testConfig);
    expect(folder2).toBe(".metadata");
    expect(mockCommands.imapCreateFolder).toHaveBeenCalledWith(testConfig, ".metadata");
  });

  it("builds and pushes a sidecar metadata RFC 822 email to IMAP", async () => {
    mockCommands.imapListFolders.mockResolvedValueOnce([
      { path: ".metadata", name: ".metadata", raw_path: ".metadata" },
    ]);
    mockCommands.imapAppendMessage.mockResolvedValueOnce(undefined);

    const payload: SidecarPayload = {
      conversationId: "thread-456",
      type: "conversation",
      updatedAt: 1710000000,
      categories: ["Work"],
      followUpAt: 1715000000,
    };

    await pushSidecarMetadata(testConfig, "user@example.com", payload);

    expect(mockCommands.imapAppendMessage).toHaveBeenCalledTimes(1);
    const [configArg, folderArg, rawB64Arg, flagsArg] = mockCommands.imapAppendMessage.mock.calls[0];
    expect(configArg).toEqual(testConfig);
    expect(folderArg).toBe(".metadata");
    expect(flagsArg).toBe("(\\Seen)");
    expect(typeof rawB64Arg).toBe("string");

    // Also test buildSidecarEmail headers directly
    const emailStr = buildSidecarEmail("user@example.com", "thread-456", payload);
    expect(emailStr).toContain("Subject: SuperMail-Personal-Metadata: thread-456");
    expect(emailStr).toContain("X-SuperMail-Sidecar: true");
    expect(emailStr).toContain("X-SuperMail-Metadata-Scope: personal");
    expect(emailStr).toContain("X-SuperMail-Conversation-Id: thread-456");
  });

  it("syncs sidecar metadata from server and reconciles into local database", async () => {
    mockCommands.imapListFolders.mockResolvedValueOnce([
      { path: ".metadata", name: ".metadata", raw_path: ".metadata" },
    ]);
    mockCommands.imapGetFolderStatus.mockResolvedValueOnce({
      uidvalidity: 1,
      uidnext: 10,
      exists: 1,
      unseen: 0,
      highest_modseq: null,
    });
    mockCommands.imapSearchAllUids.mockResolvedValueOnce([1]);

    const sidecarPayload: SidecarPayload = {
      conversationId: "thread-789",
      type: "conversation",
      updatedAt: 1720000000,
      categories: ["Personal"],
      followUpAt: 1725000000,
    };

    mockCommands.imapFetchMessages.mockResolvedValueOnce({
      messages: [
        {
          uid: 1,
          folder: ".metadata",
          body_text: JSON.stringify(sidecarPayload),
          body_html: null,
          date: 1720000000,
          is_read: true,
          is_starred: false,
          is_draft: false,
          attachments: [],
        },
      ],
      folder_status: {
        uidvalidity: 1,
        uidnext: 10,
        exists: 1,
        unseen: 0,
        highest_modseq: null,
      },
    });

    const synced = await syncSidecarMetadata("acc-1", testConfig);
    expect(synced).toBe(1);

    expect(mockCategories["thread-789"]?.category).toBe("Personal");
    expect(mockReminders["thread-789"]?.remindAt).toBe(1725000000);
    expect(mockFolderSyncState["acc-1:.metadata"]?.last_uid).toBe(1);
  });

  it("syncs sidecar metadata with isFiltered field and updates personal doc", async () => {
    mockCommands.imapListFolders.mockResolvedValueOnce([
      { path: ".metadata", name: ".metadata", raw_path: ".metadata" },
    ]);
    mockCommands.imapGetFolderStatus.mockResolvedValueOnce({
      uidvalidity: 1,
      uidnext: 10,
      exists: 1,
      unseen: 0,
      highest_modseq: null,
    });
    mockCommands.imapSearchAllUids.mockResolvedValueOnce([105]);

    const sidecarPayload: SidecarPayload = {
      conversationId: "thread-filter-1",
      type: "personal",
      updatedAt: 1720000000,
      isFiltered: true,
    };

    mockCommands.imapFetchMessages.mockResolvedValueOnce({
      messages: [
        {
          uid: 105,
          folder: ".metadata",
          body_text: JSON.stringify(sidecarPayload),
          body_html: null,
          date: 1720000000,
          is_read: true,
          is_starred: false,
          is_draft: false,
          attachments: [],
        },
      ],
      folder_status: {
        uidvalidity: 1,
        uidnext: 106,
        exists: 1,
        unseen: 0,
        highest_modseq: null,
      },
    });

    const synced = await syncSidecarMetadata("acc-1", testConfig);
    expect(synced).toBe(1);

    const crdtDoc = mockCrdtDocs["acc-1:thread-filter-1:personal"];
    expect(crdtDoc).toBeDefined();
    expect(crdtDoc.doc_base64).toBeDefined();
  });

  describe("hasPendingMetadata & ensureMetadataDownloadedForEmail", () => {
    it("returns false if sidecar folder does not exist", async () => {
      mockCommands.imapListFolders.mockResolvedValueOnce([
        { path: "INBOX", name: "INBOX" },
      ]);
      const pending = await hasPendingMetadata("acc-1", testConfig);
      expect(pending).toBe(false);
    });

    it("returns true if there are UIDs higher than last_uid", async () => {
      mockCommands.imapListFolders.mockResolvedValueOnce([
        { path: ".metadata", name: ".metadata", raw_path: ".metadata" },
      ]);
      mockFolderSyncState["acc-1:.metadata"] = { last_uid: 5 };
      mockCommands.imapSearchAllUids.mockResolvedValueOnce([1, 2, 3, 4, 5, 6]);

      const pending = await hasPendingMetadata("acc-1", testConfig);
      expect(pending).toBe(true);
    });

    it("returns false if all UIDs are <= last_uid", async () => {
      mockCommands.imapListFolders.mockResolvedValueOnce([
        { path: ".metadata", name: ".metadata", raw_path: ".metadata" },
      ]);
      mockFolderSyncState["acc-1:.metadata"] = { last_uid: 6 };
      mockCommands.imapSearchAllUids.mockResolvedValueOnce([1, 2, 3, 4, 5, 6]);

      const pending = await hasPendingMetadata("acc-1", testConfig);
      expect(pending).toBe(false);
    });

    it("ensureMetadataDownloadedForEmail syncs when pending exists", async () => {
      mockFolderSyncState["acc-1:.metadata"] = { last_uid: 10, uidvalidity: 1 };
      // syncSidecarMetadata calls:
      mockCommands.imapListFolders.mockResolvedValueOnce([
        { path: ".metadata", name: ".metadata", raw_path: ".metadata" },
      ]);
      mockCommands.imapGetFolderStatus.mockResolvedValueOnce({
        uidvalidity: 1,
        uidnext: 12,
        exists: 1,
        unseen: 0,
        highest_modseq: null,
      });
      mockCommands.imapSearchAllUids.mockResolvedValueOnce([11]);
      mockCommands.imapFetchMessages.mockResolvedValueOnce({
        messages: [
          {
            uid: 11,
            folder: ".metadata",
            body_text: JSON.stringify({
              conversationId: "thread-dl-check",
              type: "personal",
              updatedAt: 1720000000,
              isFiltered: true,
            }),
            body_html: null,
            date: 1720000000,
            is_read: true,
            is_starred: false,
            is_draft: false,
            attachments: [],
          },
        ],
        folder_status: {
          uidvalidity: 1,
          uidnext: 12,
          exists: 1,
          unseen: 0,
          highest_modseq: null,
        },
      });

      const count = await ensureMetadataDownloadedForEmail("acc-1", testConfig, "thread-dl-check");
      expect(count).toBe(1);
    });

    it("ensureMetadataDownloadedForEmail returns 0 when no pending metadata", async () => {
      mockCommands.imapListFolders.mockResolvedValueOnce([
        { path: ".metadata", name: ".metadata", raw_path: ".metadata" },
      ]);
      mockFolderSyncState["acc-1:.metadata"] = { last_uid: 20, uidvalidity: 1 };
      mockCommands.imapGetFolderStatus.mockResolvedValueOnce({ uidvalidity: 1 });
      mockCommands.imapSearchAllUids.mockResolvedValueOnce([15, 20]);

      const count = await ensureMetadataDownloadedForEmail("acc-1", testConfig, "thread-dl-check");
      expect(count).toBe(0);
    });
  });

  it("does not advance the checkpoint after an incomplete metadata fetch", async () => {
    mockCommands.imapListFolders.mockResolvedValueOnce([{ path: ".metadata", name: ".metadata", raw_path: ".metadata" }]);
    mockFolderSyncState["acc-1:.metadata"] = { last_uid: 10, uidvalidity: 1 };
    mockCommands.imapGetFolderStatus.mockResolvedValueOnce({ uidvalidity: 1 });
    mockCommands.imapSearchAllUids.mockResolvedValueOnce([11, 12]);
    mockCommands.imapFetchMessages.mockResolvedValueOnce({ messages: [{ uid: 11, body_text: '{}' }] });
    await expect(syncSidecarMetadata("acc-1", testConfig)).rejects.toThrow("Incomplete metadata download");
    expect(mockFolderSyncState["acc-1:.metadata"].last_uid).toBe(10);
  });

  it("fetches metadata again when the server resets UID validity", async () => {
    mockCommands.imapListFolders.mockResolvedValueOnce([{ path: ".metadata", name: ".metadata", raw_path: ".metadata" }]);
    mockFolderSyncState["acc-1:.metadata"] = { last_uid: 100, uidvalidity: 1 };
    mockCommands.imapGetFolderStatus.mockResolvedValueOnce({ uidvalidity: 2 });
    mockCommands.imapSearchAllUids.mockResolvedValueOnce([1]);
    mockCommands.imapFetchMessages.mockResolvedValueOnce({ messages: [{ uid: 1, body_text: '{"conversationId":"reset-thread","type":"personal","isFiltered":true}' }] });
    await syncSidecarMetadata("acc-1", testConfig);
    expect(mockFolderSyncState["acc-1:.metadata"].last_uid).toBe(1);
    expect(mockFolderSyncState["acc-1:.metadata"].uidvalidity).toBe(2);
  });

  describe("syncBatchConversationLabelsToRemote", () => {
    it("updates local metadata and checks outgoing confirmation before pushing to remote", async () => {
      mockCommands.imapListFolders.mockResolvedValue([
        { path: ".metadata", name: ".metadata", raw_path: ".metadata" },
      ]);
      mockCommands.imapAppendMessage.mockResolvedValue(undefined);
      vi.mocked(checkOutgoingSyncAllowed).mockResolvedValueOnce(true);

      const updates = [
        { threadId: "t1", labels: ["INBOX", "Work"], subject: "Subject 1" },
        { threadId: "t2", labels: ["archive"], subject: "Subject 2" },
      ];

      const result = await syncBatchConversationLabelsToRemote("acc-1", updates, {
        isFirstSync: true,
        config: testConfig,
      });

      expect(setConversationMetadataLabels).toHaveBeenCalledWith("acc-1", "t1", ["INBOX", "Work"]);
      expect(setConversationMetadataLabels).toHaveBeenCalledWith("acc-1", "t2", ["archive"]);
      expect(checkOutgoingSyncAllowed).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "acc-1",
          isFirstSync: true,
          items: expect.arrayContaining([
            expect.objectContaining({ id: "t1" }),
            expect.objectContaining({ id: "t2" }),
          ]),
        }),
      );
      expect(result.confirmed).toBe(true);
      expect(result.synced).toBe(2);
      expect(mockCommands.imapAppendMessage).toHaveBeenCalledTimes(2);
    });

    it("cancels remote push when user declines confirmation popover", async () => {
      mockCommands.imapAppendMessage.mockResolvedValue(undefined);
      vi.mocked(checkOutgoingSyncAllowed).mockResolvedValueOnce(false);

      const updates = [
        { threadId: "t1", labels: ["INBOX"], subject: "Subject 1" },
      ];

      const result = await syncBatchConversationLabelsToRemote("acc-1", updates, {
        isFirstSync: true,
        config: testConfig,
      });

      // Local metadata was updated
      expect(setConversationMetadataLabels).toHaveBeenCalledWith("acc-1", "t1", ["INBOX"]);
      // But remote push was NOT performed
      expect(result.confirmed).toBe(false);
      expect(result.synced).toBe(0);
      expect(mockCommands.imapAppendMessage).not.toHaveBeenCalled();
    });
  });

  describe("JSONL Ledger on IMAP", () => {
    it("builds an RFC 822 email containing JSONL ledger lines", () => {
      const entries: MetadataLedgerEntry[] = [
        {
          id: "entry-1",
          conversationId: "thread-ledger-1",
          timestamp: 1710000000,
          action: "set_labels",
          field: "labels",
          oldValue: ["INBOX"],
          newValue: ["INBOX", "Work"],
        },
        {
          id: "entry-2",
          conversationId: "thread-ledger-1",
          timestamp: 1710000500,
          action: "set_category",
          field: "category",
          oldValue: null,
          newValue: "Work",
        },
      ];

      const email = buildLedgerEmail("user@example.com", "thread-ledger-1", entries);

      expect(email).toContain("Subject: SuperMail-Metadata-Ledger: thread-ledger-1");
      expect(email).toContain("X-SuperMail-Metadata-Format: jsonl");
      expect(email).toContain("Content-Type: application/x-ndjson; charset=utf-8");

      // Verify JSONL lines in the body
      const parsedLines = parseMetadataLines(email.split("\r\n\r\n")[1]!);
      expect(parsedLines).toHaveLength(2);
      expect(parsedLines[0].id).toBe("entry-1");
      expect(parsedLines[0].action).toBe("set_labels");
      expect(parsedLines[1].id).toBe("entry-2");
      expect(parsedLines[1].action).toBe("set_category");
    });

    it("appends discrete JSONL ledger entries to IMAP without mutating in-place", async () => {
      mockCommands.imapListFolders.mockResolvedValueOnce([
        { path: ".metadata", name: ".metadata", raw_path: ".metadata" },
      ]);
      mockCommands.imapAppendMessage.mockResolvedValueOnce(undefined);

      const entries: MetadataLedgerEntry[] = [
        {
          id: "e-append-1",
          conversationId: "thread-append",
          timestamp: 1710001000,
          action: "set_labels",
          field: "labels",
          newValue: ["INBOX"],
        },
      ];

      await appendLedgerEntriesToRemote(testConfig, "user@example.com", "thread-append", entries);

      expect(mockCommands.imapAppendMessage).toHaveBeenCalledTimes(1);
      const [configArg, folderArg, rawB64Arg] = mockCommands.imapAppendMessage.mock.calls[0];
      expect(configArg).toEqual(testConfig);
      expect(folderArg).toBe(".metadata");
      expect(typeof rawB64Arg).toBe("string");
    });

    it("parses single JSON objects as well as multi-line JSONL streams", () => {
      // Single object
      const singleJson = '{"conversationId":"c1","type":"personal"}';
      expect(parseMetadataLines(singleJson)).toHaveLength(1);
      expect(parseMetadataLines(singleJson)[0].conversationId).toBe("c1");

      // Multi-line JSONL
      const jsonl = '{"id":"1","action":"a"}\n{"id":"2","action":"b"}\r\n{"id":"3","action":"c"}';
      const parsed = parseMetadataLines(jsonl);
      expect(parsed).toHaveLength(3);
      expect(parsed.map((p: any) => p.id)).toEqual(["1", "2", "3"]);
    });

    it("syncs JSONL ledger messages from server and applies changes into local database", async () => {
      mockCommands.imapListFolders.mockResolvedValueOnce([
        { path: ".metadata", name: ".metadata", raw_path: ".metadata" },
      ]);
      mockCommands.imapGetFolderStatus.mockResolvedValueOnce({
        uidvalidity: 1,
        uidnext: 20,
        exists: 1,
        unseen: 0,
        highest_modseq: null,
      });
      mockCommands.imapSearchAllUids.mockResolvedValueOnce([50]);

      const jsonlEntries: MetadataLedgerEntry[] = [
        {
          id: "entry-sync-1",
          conversationId: "thread-ledger-sync",
          timestamp: 1720000000,
          action: "set_category",
          field: "category",
          oldValue: null,
          newValue: "Finance",
        },
        {
          id: "entry-sync-2",
          conversationId: "thread-ledger-sync",
          timestamp: 1720000100,
          action: "set_followup",
          field: "followUpAt",
          oldValue: null,
          newValue: 1730000000,
        },
      ];
      const jsonlBody = jsonlEntries.map((e) => JSON.stringify(e)).join("\n");

      mockCommands.imapFetchMessages.mockResolvedValueOnce({
        messages: [
          {
            uid: 50,
            folder: ".metadata",
            body_text: jsonlBody,
            body_html: null,
            date: 1720000100,
            is_read: true,
            is_starred: false,
            is_draft: false,
            attachments: [],
          },
        ],
        folder_status: {
          uidvalidity: 1,
          uidnext: 20,
          exists: 1,
          unseen: 0,
          highest_modseq: null,
        },
      });

      const applied = await syncSidecarMetadata("acc-1", testConfig);
      expect(applied).toBe(2);
      expect(mockCategories["thread-ledger-sync"]?.category).toBe("Finance");
      expect(mockReminders["thread-ledger-sync"]?.remindAt).toBe(1730000000);
      expect(mockFolderSyncState["acc-1:.metadata"]?.last_uid).toBe(50);
    });
  });
});
