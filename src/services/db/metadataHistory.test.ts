// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  recordMetadataChange,
  recordMetadataLedgerEntry,
  getMetadataHistory,
  getMetadataChangesPastHour,
  markMetadataChangeReverted,
  getMetadataChangeById,
  getMetadataLedgerEntries,
  getUnsyncedLedgerEntries,
  markLedgerEntriesSynced,
  type MetadataHistoryRecord,
  type MetadataLedgerRecord,
} from "./metadataHistory";

const mockDb = {
  execute: vi.fn(),
  select: vi.fn(),
};

vi.mock("./connection", () => ({
  getDb: vi.fn(async () => mockDb),
}));

describe("metadataHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records a metadata change into both history and ledger tables", async () => {
    mockDb.execute.mockResolvedValue({ rowsAffected: 1 });

    const change = await recordMetadataChange({
      accountId: "acc-1",
      conversationId: "thread-100",
      action: "set_labels",
      field: "labels",
      oldValue: ["INBOX"],
      newValue: ["INBOX", "Work"],
      changeSummary: "Added Work label",
    });

    expect(change.id).toBeTruthy();
    expect(change.account_id).toBe("acc-1");
    expect(change.conversation_id).toBe("thread-100");
    expect(change.action).toBe("set_labels");
    expect(change.field).toBe("labels");
    expect(change.old_value).toBe(JSON.stringify(["INBOX"]));
    expect(change.new_value).toBe(JSON.stringify(["INBOX", "Work"]));
    expect(change.change_summary).toBe("Added Work label");
    expect(change.reverted).toBe(0);

    // Verify 2 execute calls: one for metadata_history, one for metadata_ledger
    expect(mockDb.execute).toHaveBeenCalledTimes(2);

    const historyCall = mockDb.execute.mock.calls[0];
    expect(historyCall[0]).toContain("INSERT INTO metadata_history");
    expect(historyCall[1][0]).toBe(change.id);
    expect(historyCall[1][1]).toBe("acc-1");
    expect(historyCall[1][2]).toBe("thread-100");

    const ledgerCall = mockDb.execute.mock.calls[1];
    expect(ledgerCall[0]).toContain("INSERT INTO metadata_ledger");
    expect(ledgerCall[1][0]).toBe(change.id);
    const parsedJsonl = JSON.parse(ledgerCall[1][4]);
    expect(parsedJsonl.id).toBe(change.id);
    expect(parsedJsonl.action).toBe("set_labels");
    expect(parsedJsonl.newValue).toEqual(["INBOX", "Work"]);
  });

  it("fetches metadata history with filters", async () => {
    const mockRows: MetadataHistoryRecord[] = [
      {
        id: "meta-1",
        account_id: "acc-1",
        conversation_id: "thread-1",
        timestamp: 1000,
        action: "set_labels",
        field: "labels",
        old_value: "[]",
        new_value: '["INBOX"]',
        change_summary: "Set labels",
        reverted: 0,
        reverted_at: null,
        reverted_by_id: null,
      },
    ];
    mockDb.select.mockResolvedValueOnce(mockRows);

    const history = await getMetadataHistory("acc-1", {
      conversationId: "thread-1",
      limit: 10,
      includeReverted: false,
    });

    expect(history).toEqual(mockRows);
    expect(mockDb.select).toHaveBeenCalledTimes(1);
    const [query, params] = mockDb.select.mock.calls[0];
    expect(query).toContain("account_id = $1");
    expect(query).toContain("conversation_id = $2");
    expect(query).toContain("reverted = 0");
    expect(params).toEqual(["acc-1", "thread-1", 10]);
  });

  it("fetches changes made in the past hour", async () => {
    const now = Date.now();
    const mockRows: MetadataHistoryRecord[] = [
      {
        id: "meta-2",
        account_id: "acc-1",
        conversation_id: "thread-2",
        timestamp: now - 1000 * 60 * 10, // 10 mins ago
        action: "set_category",
        field: "category",
        old_value: null,
        new_value: '"Promotions"',
        change_summary: "Categorized as Promotions",
        reverted: 0,
        reverted_at: null,
        reverted_by_id: null,
      },
    ];
    mockDb.select.mockResolvedValueOnce(mockRows);

    const changes = await getMetadataChangesPastHour("acc-1", "thread-2");

    expect(changes).toEqual(mockRows);
    const [query, params] = mockDb.select.mock.calls[0];
    expect(query).toContain("timestamp >= $1");
    expect(query).toContain("reverted = 0");
    expect(query).toContain("action != 'revert'");
    expect(params[0]).toBeGreaterThan(now - 3600 * 1000 - 5000);
    expect(params[1]).toBe("acc-1");
    expect(params[2]).toBe("thread-2");
  });

  it("marks a metadata change record as reverted", async () => {
    mockDb.execute.mockResolvedValueOnce({ rowsAffected: 1 });

    const revertTimestamp = 1710000000;
    await markMetadataChangeReverted("meta-1", "rev-meta-1", revertTimestamp);

    expect(mockDb.execute).toHaveBeenCalledTimes(1);
    const [query, params] = mockDb.execute.mock.calls[0];
    expect(query).toContain("UPDATE metadata_history");
    expect(query).toContain("reverted = 1");
    expect(params).toEqual([revertTimestamp, "rev-meta-1", "meta-1"]);
  });

  it("records and queries raw ledger entries and sync state", async () => {
    mockDb.execute.mockResolvedValue({ rowsAffected: 1 });
    mockDb.select.mockResolvedValue([
      {
        id: "entry-1",
        account_id: "acc-1",
        conversation_id: "conv-1",
        timestamp: 1710000000,
        entry_jsonl: '{"id":"entry-1"}',
        imap_uid: null,
        synced_to_imap: 0,
      },
    ]);

    await recordMetadataLedgerEntry({
      id: "entry-1",
      accountId: "acc-1",
      conversationId: "conv-1",
      entryJsonl: '{"id":"entry-1"}',
    });
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT OR IGNORE INTO metadata_ledger"),
      expect.arrayContaining(["entry-1", "acc-1", "conv-1"]),
    );

    const unsynced = await getUnsyncedLedgerEntries("acc-1");
    expect(unsynced).toHaveLength(1);
    expect(unsynced[0].id).toBe("entry-1");

    await markLedgerEntriesSynced(["entry-1"], 999);
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE metadata_ledger"),
      ["entry-1", 999],
    );
  });
});
