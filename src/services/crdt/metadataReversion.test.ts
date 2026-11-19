// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  reverseMetadataChangesPastHour,
  reverseMetadataChange,
} from "./metadataReversion";
import type { MetadataHistoryRecord } from "../db/metadataHistory";

const mockDbState: {
  history: MetadataHistoryRecord[];
  labels: Record<string, string[]>;
  categories: Record<string, string | null>;
  followUps: Record<string, number | null>;
  isFiltered: Record<string, boolean>;
} = {
  history: [],
  labels: {},
  categories: {},
  followUps: {},
  isFiltered: {},
};

vi.mock("../db/metadataHistory", () => ({
  getMetadataChangesPastHour: vi.fn(async (accountId?: string, conversationId?: string) => {
    const oneHourAgo = Date.now() - 3600 * 1000;
    return mockDbState.history.filter((r) => {
      if (r.timestamp < oneHourAgo) return false;
      if (r.reverted === 1 || r.action === "revert") return false;
      if (accountId && r.account_id !== accountId) return false;
      if (conversationId && r.conversation_id !== conversationId) return false;
      return true;
    });
  }),
  getMetadataChangeById: vi.fn(async (id: string) => {
    return mockDbState.history.find((r) => r.id === id) || null;
  }),
  markMetadataChangeReverted: vi.fn(async (id: string, revertedById: string, revertedAt: number) => {
    const record = mockDbState.history.find((r) => r.id === id);
    if (record) {
      record.reverted = 1;
      record.reverted_at = revertedAt;
      record.reverted_by_id = revertedById;
    }
  }),
  recordMetadataChange: vi.fn(async (change: any) => {
    const record: MetadataHistoryRecord = {
      id: change.id,
      account_id: change.accountId,
      conversation_id: change.conversationId,
      timestamp: change.timestamp || Date.now(),
      action: change.action,
      field: change.field || null,
      old_value: JSON.stringify(change.oldValue),
      new_value: JSON.stringify(change.newValue),
      change_summary: change.changeSummary,
      reverted: 0,
      reverted_at: null,
      reverted_by_id: null,
    };
    mockDbState.history.push(record);
    return record;
  }),
}));

vi.mock("./metadataCrdt", () => ({
  setConversationMetadataLabels: vi.fn(async (accId: string, convId: string, labels: string[]) => {
    mockDbState.labels[convId] = labels;
  }),
  setConversationMetadataCategory: vi.fn(async (accId: string, convId: string, category: string | null) => {
    mockDbState.categories[convId] = category;
  }),
  setConversationMetadataFollowUp: vi.fn(async (accId: string, convId: string, followUpAt: number | null) => {
    mockDbState.followUps[convId] = followUpAt;
  }),
  markEmailFiltered: vi.fn(async (accId: string, convId: string, isFiltered: boolean) => {
    mockDbState.isFiltered[convId] = isFiltered;
  }),
  getOrInitPersonalMetadataDoc: vi.fn(async () => ({})),
  updatePersonalMetadataDoc: vi.fn((doc) => doc),
  savePersonalMetadataDoc: vi.fn(async () => {}),
  reconcilePersonalMetadataToDb: vi.fn(async () => {}),
}));

const mockImapAppend = vi.fn().mockResolvedValue(undefined);

vi.mock("../imap/metadataSidecarSync", () => ({
  appendLedgerEntriesToRemote: vi.fn(async (config, fromEmail, convId, entries) => {
    mockImapAppend(config, fromEmail, convId, entries);
  }),
}));

vi.mock("../db/accounts", () => ({
  getAccount: vi.fn(async () => ({
    id: "acc-1",
    email: "user@example.com",
    provider: "imap",
  })),
  getAllAccounts: vi.fn(async () => [{ id: "acc-1", email: "user@example.com", provider: "imap" }]),
}));

vi.mock("../imap/imapConfigBuilder", () => ({
  buildImapConfig: vi.fn(() => ({ host: "imap.example.com", port: 993 })),
}));

describe("metadataReversion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbState.history = [];
    mockDbState.labels = {};
    mockDbState.categories = {};
    mockDbState.followUps = {};
    mockDbState.isFiltered = {};
  });

  it("returns zero reversals when no changes were made in past hour", async () => {
    const result = await reverseMetadataChangesPastHour("acc-1");
    expect(result.reversedCount).toBe(0);
    expect(result.affectedConversations).toEqual([]);
    expect(result.reversals).toEqual([]);
    expect(mockImapAppend).not.toHaveBeenCalled();
  });

  it("reverses label changes from the past hour and restores previous labels", async () => {
    const now = Date.now();
    mockDbState.history = [
      {
        id: "change-1",
        account_id: "acc-1",
        conversation_id: "thread-10",
        timestamp: now - 1000 * 60 * 15, // 15 mins ago
        action: "set_labels",
        field: "labels",
        old_value: JSON.stringify(["INBOX"]),
        new_value: JSON.stringify(["INBOX", "Archive"]),
        change_summary: "Archived conversation",
        reverted: 0,
        reverted_at: null,
        reverted_by_id: null,
      },
    ];
    mockDbState.labels["thread-10"] = ["INBOX", "Archive"];

    const result = await reverseMetadataChangesPastHour("acc-1");

    expect(result.reversedCount).toBe(1);
    expect(result.affectedConversations).toEqual(["thread-10"]);
    expect(result.reversals[0].restoredValue).toEqual(["INBOX"]);
    expect(result.reversals[0].originalChangeId).toBe("change-1");

    // Old labels restored
    expect(mockDbState.labels["thread-10"]).toEqual(["INBOX"]);

    // Marked as reverted
    const originalRecord = mockDbState.history.find((r) => r.id === "change-1");
    expect(originalRecord?.reverted).toBe(1);
    expect(originalRecord?.reverted_by_id).toBeTruthy();

    // Appended to IMAP ledger
    expect(mockImapAppend).toHaveBeenCalledWith(
      expect.anything(),
      "user@example.com",
      "thread-10",
      expect.arrayContaining([
        expect.objectContaining({
          action: "revert",
          field: "labels",
          newValue: ["INBOX"],
          isReversion: true,
        }),
      ]),
    );
  });

  it("reverses multiple metadata types in reverse chronological order", async () => {
    const now = Date.now();
    mockDbState.history = [
      {
        id: "c1",
        account_id: "acc-1",
        conversation_id: "t1",
        timestamp: now - 1000 * 60 * 30, // 30 mins ago
        action: "set_category",
        field: "category",
        old_value: JSON.stringify(null),
        new_value: JSON.stringify("Work"),
        change_summary: "Set category to Work",
        reverted: 0,
        reverted_at: null,
        reverted_by_id: null,
      },
      {
        id: "c2",
        account_id: "acc-1",
        conversation_id: "t2",
        timestamp: now - 1000 * 60 * 10, // 10 mins ago (newer)
        action: "set_followup",
        field: "followUpAt",
        old_value: JSON.stringify(null),
        new_value: JSON.stringify(1750000000),
        change_summary: "Set follow-up reminder",
        reverted: 0,
        reverted_at: null,
        reverted_by_id: null,
      },
    ];

    const result = await reverseMetadataChangesPastHour("acc-1");

    expect(result.reversedCount).toBe(2);
    expect(result.affectedConversations).toEqual(["t2", "t1"]); // newer first
    expect(mockDbState.categories["t1"]).toBeNull();
    expect(mockDbState.followUps["t2"]).toBeNull();
  });

  it("can reverse a single change record by ID", async () => {
    const now = Date.now();
    mockDbState.history = [
      {
        id: "c-single",
        account_id: "acc-1",
        conversation_id: "t-single",
        timestamp: now - 1000 * 60 * 5,
        action: "set_filtered",
        field: "isFiltered",
        old_value: JSON.stringify(false),
        new_value: JSON.stringify(true),
        change_summary: "Marked filtered",
        reverted: 0,
        reverted_at: null,
        reverted_by_id: null,
      },
    ];

    const success = await reverseMetadataChange("c-single", "acc-1");
    expect(success).toBe(true);
    expect(mockDbState.isFiltered["t-single"]).toBe(false);

    const record = mockDbState.history.find((r) => r.id === "c-single");
    expect(record?.reverted).toBe(1);
  });
});
