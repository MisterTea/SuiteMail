import { describe, expect, it, vi, beforeEach } from "vitest";
import { storeGraphPage } from "./graphSync";
import type { GraphMessageDto } from "./graphModel";

vi.mock("../db/accounts", () => ({
  getAccount: vi.fn(),
  clearAccountHistoryId: vi.fn(),
  updateAccountSyncState: vi.fn(),
}));

vi.mock("../db/labels", () => ({
  upsertLabel: vi.fn(),
  getLabelsForAccount: vi.fn(),
}));

const mockDbMessage = {
  id: "msg-1",
  account_id: "acc-1",
  thread_id: "thread-1",
  subject: "Meeting",
  snippet: "Let's meet",
  date: 1000,
  is_read: 0,
  is_starred: 0,
  imap_folder: "folder-inbox",
};

vi.mock("../db/messages", () => ({
  deleteMessage: vi.fn(),
  getMessagesForThread: vi.fn().mockImplementation(() => Promise.resolve([mockDbMessage])),
  upsertMessage: vi.fn().mockResolvedValue(undefined),
}));

const mockSetThreadLabels = vi.fn().mockResolvedValue(undefined);
const mockGetThreadLabelIds = vi.fn().mockResolvedValue([]);
const mockUpsertThread = vi.fn().mockResolvedValue(undefined);
const mockGetThreadById = vi.fn().mockResolvedValue(undefined);

vi.mock("../db/threads", () => ({
  deleteThread: vi.fn(),
  getThreadById: (...args: unknown[]) => mockGetThreadById(...args),
  getThreadLabelIds: (...args: unknown[]) => mockGetThreadLabelIds(...args),
  setThreadLabels: (...args: unknown[]) => mockSetThreadLabels(...args),
  upsertThread: (...args: unknown[]) => mockUpsertThread(...args),
}));

vi.mock("../db/attachments", () => ({
  upsertAttachment: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../db/pendingOperations", () => ({
  getPendingOpsForResource: vi.fn().mockResolvedValue([]),
}));

vi.mock("../filters/filterEngine", () => ({
  addEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../oauth/oauthTokenManager", () => ({
  ensureFreshToken: vi.fn().mockResolvedValue("mock-token"),
}));

describe("storeGraphPage with focused inference classification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseMessage: GraphMessageDto = {
    id: "msg-1",
    conversationId: "thread-1",
    parentFolderId: "folder-inbox",
    subject: "Meeting",
    bodyContent: "Let's meet",
    bodyContentType: "text",
    from: { address: "colleague@example.com" },
    receivedDateTime: "2026-11-19T12:00:00Z",
  };

  it("adds FOCUSED label to parsed message and thread when server marks email as focused", async () => {
    const focusedMessage: GraphMessageDto = {
      ...baseMessage,
      inferenceClassification: "focused",
    };

    const folderMap = new Map([["folder-inbox", "INBOX"]]);
    await storeGraphPage("acc-1", { messages: [focusedMessage], removedIds: [] }, folderMap);

    expect(mockSetThreadLabels).toHaveBeenCalledWith(
      "acc-1",
      "thread-1",
      expect.arrayContaining(["INBOX", "FOCUSED"]),
    );
  });

  it("does not add FOCUSED label when server marks email as other", async () => {
    const otherMessage: GraphMessageDto = {
      ...baseMessage,
      inferenceClassification: "other",
    };

    const folderMap = new Map([["folder-inbox", "INBOX"]]);
    await storeGraphPage("acc-1", { messages: [otherMessage], removedIds: [] }, folderMap);

    expect(mockSetThreadLabels).toHaveBeenCalledWith(
      "acc-1",
      "thread-1",
      ["INBOX"],
    );
  });
});
