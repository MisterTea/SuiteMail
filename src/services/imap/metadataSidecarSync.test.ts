// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ensureSidecarFolder,
  buildSidecarEmail,
  pushSidecarMetadata,
  syncSidecarMetadata,
  hasPendingMetadata,
  ensureMetadataDownloadedForEmail,
  type SidecarPayload,
} from "./metadataSidecarSync";
import type { ImapConfig, ImapFolder, ImapFetchResult } from "./tauriCommands";

const mockTauri = {
  imapListFolders: vi.fn(),
  imapCreateFolder: vi.fn(),
  imapAppendMessage: vi.fn(),
  imapSearchAllUids: vi.fn(),
  imapFetchMessages: vi.fn(),
  imapGetFolderStatus: vi.fn(),
};

vi.mock("./tauriCommands", () => ({
  imapListFolders: vi.fn((config) => mockTauri.imapListFolders(config)),
  imapCreateFolder: vi.fn((config, folder) => mockTauri.imapCreateFolder(config, folder)),
  imapAppendMessage: vi.fn((config, folder, raw, flags) =>
    mockTauri.imapAppendMessage(config, folder, raw, flags)
  ),
  imapSearchAllUids: vi.fn((config, folder) => mockTauri.imapSearchAllUids(config, folder)),
  imapFetchMessages: vi.fn((config, folder, uids) => mockTauri.imapFetchMessages(config, folder, uids)),
  imapGetFolderStatus: vi.fn((config, folder) => mockTauri.imapGetFolderStatus(config, folder)),
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
    mockTauri.imapListFolders.mockResolvedValueOnce([
      { path: "INBOX", name: "INBOX", raw_path: "INBOX" },
      { path: ".metadata", name: ".metadata", raw_path: ".metadata" },
    ]);

    const folder1 = await ensureSidecarFolder(testConfig);
    expect(folder1).toBe(".metadata");
    expect(mockTauri.imapCreateFolder).not.toHaveBeenCalled();

    // 2. When folder does not exist
    mockTauri.imapListFolders.mockResolvedValueOnce([
      { path: "INBOX", name: "INBOX", raw_path: "INBOX" },
    ]);
    mockTauri.imapCreateFolder.mockResolvedValueOnce(undefined);

    const folder2 = await ensureSidecarFolder(testConfig);
    expect(folder2).toBe(".metadata");
    expect(mockTauri.imapCreateFolder).toHaveBeenCalledWith(testConfig, ".metadata");
  });

  it("builds and pushes a sidecar metadata RFC 822 email to IMAP", async () => {
    mockTauri.imapListFolders.mockResolvedValueOnce([
      { path: ".metadata", name: ".metadata", raw_path: ".metadata" },
    ]);
    mockTauri.imapAppendMessage.mockResolvedValueOnce(undefined);

    const payload: SidecarPayload = {
      conversationId: "thread-456",
      type: "conversation",
      updatedAt: 1710000000,
      categories: ["Work"],
      followUpAt: 1715000000,
    };

    await pushSidecarMetadata(testConfig, "user@example.com", payload);

    expect(mockTauri.imapAppendMessage).toHaveBeenCalledTimes(1);
    const [configArg, folderArg, rawB64Arg, flagsArg] = mockTauri.imapAppendMessage.mock.calls[0];
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
    mockTauri.imapListFolders.mockResolvedValueOnce([
      { path: ".metadata", name: ".metadata", raw_path: ".metadata" },
    ]);
    mockTauri.imapGetFolderStatus.mockResolvedValueOnce({
      uidvalidity: 1,
      uidnext: 10,
      exists: 1,
      unseen: 0,
      highest_modseq: null,
    });
    mockTauri.imapSearchAllUids.mockResolvedValueOnce([1]);

    const sidecarPayload: SidecarPayload = {
      conversationId: "thread-789",
      type: "conversation",
      updatedAt: 1720000000,
      categories: ["Personal"],
      followUpAt: 1725000000,
    };

    mockTauri.imapFetchMessages.mockResolvedValueOnce({
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
    mockTauri.imapListFolders.mockResolvedValueOnce([
      { path: ".metadata", name: ".metadata", raw_path: ".metadata" },
    ]);
    mockTauri.imapGetFolderStatus.mockResolvedValueOnce({
      uidvalidity: 1,
      uidnext: 10,
      exists: 1,
      unseen: 0,
      highest_modseq: null,
    });
    mockTauri.imapSearchAllUids.mockResolvedValueOnce([105]);

    const sidecarPayload: SidecarPayload = {
      conversationId: "thread-filter-1",
      type: "personal",
      updatedAt: 1720000000,
      isFiltered: true,
    };

    mockTauri.imapFetchMessages.mockResolvedValueOnce({
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
      mockTauri.imapListFolders.mockResolvedValueOnce([
        { path: "INBOX", name: "INBOX" },
      ]);
      const pending = await hasPendingMetadata("acc-1", testConfig);
      expect(pending).toBe(false);
    });

    it("returns true if there are UIDs higher than last_uid", async () => {
      mockTauri.imapListFolders.mockResolvedValueOnce([
        { path: ".metadata", name: ".metadata", raw_path: ".metadata" },
      ]);
      mockFolderSyncState["acc-1:.metadata"] = { last_uid: 5 };
      mockTauri.imapSearchAllUids.mockResolvedValueOnce([1, 2, 3, 4, 5, 6]);

      const pending = await hasPendingMetadata("acc-1", testConfig);
      expect(pending).toBe(true);
    });

    it("returns false if all UIDs are <= last_uid", async () => {
      mockTauri.imapListFolders.mockResolvedValueOnce([
        { path: ".metadata", name: ".metadata", raw_path: ".metadata" },
      ]);
      mockFolderSyncState["acc-1:.metadata"] = { last_uid: 6 };
      mockTauri.imapSearchAllUids.mockResolvedValueOnce([1, 2, 3, 4, 5, 6]);

      const pending = await hasPendingMetadata("acc-1", testConfig);
      expect(pending).toBe(false);
    });

    it("ensureMetadataDownloadedForEmail syncs when pending exists", async () => {
      // 1st listFolders for hasPendingMetadata
      mockTauri.imapListFolders.mockResolvedValueOnce([
        { path: ".metadata", name: ".metadata", raw_path: ".metadata" },
      ]);
      mockFolderSyncState["acc-1:.metadata"] = { last_uid: 10 };
      mockTauri.imapSearchAllUids.mockResolvedValueOnce([11]);

      // syncSidecarMetadata calls:
      mockTauri.imapListFolders.mockResolvedValueOnce([
        { path: ".metadata", name: ".metadata", raw_path: ".metadata" },
      ]);
      mockTauri.imapGetFolderStatus.mockResolvedValueOnce({
        uidvalidity: 1,
        uidnext: 12,
        exists: 1,
        unseen: 0,
        highest_modseq: null,
      });
      mockTauri.imapSearchAllUids.mockResolvedValueOnce([11]);
      mockTauri.imapFetchMessages.mockResolvedValueOnce({
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
      mockTauri.imapListFolders.mockResolvedValueOnce([
        { path: ".metadata", name: ".metadata", raw_path: ".metadata" },
      ]);
      mockFolderSyncState["acc-1:.metadata"] = { last_uid: 20 };
      mockTauri.imapSearchAllUids.mockResolvedValueOnce([15, 20]);

      const count = await ensureMetadataDownloadedForEmail("acc-1", testConfig, "thread-dl-check");
      expect(count).toBe(0);
    });
  });
});
