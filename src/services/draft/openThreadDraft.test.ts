import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  deleteMessage: vi.fn(),
  getMessagesForThread: vi.fn(),
  deleteThread: vi.fn(),
  getThreadLabelIds: vi.fn(),
  setThreadLabels: vi.fn(),
  removeThreads: vi.fn(),
}));

vi.mock("../db/messages", () => ({ deleteMessage: db.deleteMessage, getMessagesForThread: db.getMessagesForThread }));
vi.mock("../db/threads", () => ({ deleteThread: db.deleteThread, getThreadLabelIds: db.getThreadLabelIds, setThreadLabels: db.setThreadLabels }));
vi.mock("../gmail/tokenManager", () => ({ getGmailClient: vi.fn() }));
vi.mock("@/stores/threadStore", () => ({ useThreadStore: { getState: () => ({ removeThreads: db.removeThreads }) } }));

import { deleteStoredDraft } from "./openThreadDraft";

describe("deleteStoredDraft", () => {
  beforeEach(() => vi.clearAllMocks());

  it("removes a draft-only thread from the local mailbox and the list", async () => {
    db.getMessagesForThread.mockResolvedValue([]);
    await deleteStoredDraft("acc-1", "t-draft", "m-draft");
    expect(db.deleteMessage).toHaveBeenCalledWith("acc-1", "m-draft");
    expect(db.deleteThread).toHaveBeenCalledWith("acc-1", "t-draft");
    expect(db.removeThreads).toHaveBeenCalledWith(["t-draft"]);
  });

  it("keeps a conversation with other messages but takes it out of Drafts", async () => {
    db.getMessagesForThread.mockResolvedValue([{ id: "m-original" }]);
    db.getThreadLabelIds.mockResolvedValue(["INBOX", "DRAFT"]);
    await deleteStoredDraft("acc-1", "t-reply", "m-draft");
    expect(db.deleteMessage).toHaveBeenCalledWith("acc-1", "m-draft");
    expect(db.deleteThread).not.toHaveBeenCalled();
    expect(db.setThreadLabels).toHaveBeenCalledWith("acc-1", "t-reply", ["INBOX"]);
  });
});
