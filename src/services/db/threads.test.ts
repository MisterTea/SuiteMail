import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/services/db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/db/connection")>();
  return {
    ...actual,
    getDb: vi.fn(),
  };
});

import { getDb } from "@/services/db/connection";
import {
  muteThread,
  unmuteThread,
  getMutedThreadIds,
  deleteAllThreadsForAccount,
  getThreadsForAccount,
  getThreadsForCategory,
  upsertThread,
  getUnreadInboxCount,
  getThreadCountForAccount,
} from "./threads";
import { createMockDb } from "@/test/mocks";

const mockDb = createMockDb();

describe("threads service - deleteAllThreadsForAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Awaited<ReturnType<typeof getDb>>);
  });

  it("deletes all threads for the given account", async () => {
    await deleteAllThreadsForAccount("acc-1");

    expect(mockDb.execute).toHaveBeenCalledWith(
      "DELETE FROM threads WHERE account_id = $1",
      ["acc-1"],
    );
  });
});

describe("threads service - mute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Awaited<ReturnType<typeof getDb>>);
  });

  describe("muteThread", () => {
    it("calls db.execute with correct SQL to set is_muted = 1", async () => {
      await muteThread("acc-1", "thread-1");

      expect(mockDb.execute).toHaveBeenCalledWith(
        "UPDATE threads SET is_muted = 1 WHERE account_id = $1 AND id = $2",
        ["acc-1", "thread-1"],
      );
    });
  });

  describe("unmuteThread", () => {
    it("calls db.execute with correct SQL to set is_muted = 0", async () => {
      await unmuteThread("acc-1", "thread-1");

      expect(mockDb.execute).toHaveBeenCalledWith(
        "UPDATE threads SET is_muted = 0 WHERE account_id = $1 AND id = $2",
        ["acc-1", "thread-1"],
      );
    });
  });

  describe("getMutedThreadIds", () => {
    it("returns a Set of muted thread IDs", async () => {
      mockDb.select.mockResolvedValueOnce([
        { id: "thread-1" },
        { id: "thread-3" },
      ]);

      const result = await getMutedThreadIds("acc-1");

      expect(mockDb.select).toHaveBeenCalledWith(
        "SELECT id FROM threads WHERE account_id = $1 AND is_muted = 1",
        ["acc-1"],
      );
      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(2);
      expect(result.has("thread-1")).toBe(true);
      expect(result.has("thread-3")).toBe(true);
    });

    it("returns an empty Set when no threads are muted", async () => {
      mockDb.select.mockResolvedValueOnce([]);

      const result = await getMutedThreadIds("acc-1");

      expect(result.size).toBe(0);
    });
  });
});

describe("threads service - is_filtered filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Awaited<ReturnType<typeof getDb>>);
  });

  it("getThreadsForAccount queries only threads with is_filtered = 1", async () => {
    mockDb.select.mockResolvedValueOnce([]);
    await getThreadsForAccount("acc-1");

    expect(mockDb.select).toHaveBeenCalled();
    const query = mockDb.select.mock.calls[0]![0] as string;
    expect(query).toContain("t.is_filtered = 1");
  });

  it("getThreadsForAccount with label queries only threads with is_filtered = 1", async () => {
    mockDb.select.mockResolvedValueOnce([]);
    await getThreadsForAccount("acc-1", "INBOX");

    expect(mockDb.select).toHaveBeenCalled();
    const query = mockDb.select.mock.calls[0]![0] as string;
    expect(query).toContain("t.is_filtered = 1");
  });

  it("getThreadsForCategory queries only threads with is_filtered = 1", async () => {
    mockDb.select.mockResolvedValueOnce([]);
    await getThreadsForCategory("acc-1", "Primary");

    expect(mockDb.select).toHaveBeenCalled();
    const query = mockDb.select.mock.calls[0]![0] as string;
    expect(query).toContain("t.is_filtered = 1");
  });

  it("getUnreadInboxCount counts only threads with is_filtered = 1", async () => {
    mockDb.select.mockResolvedValueOnce([{ count: 3 }]);
    const count = await getUnreadInboxCount();

    expect(count).toBe(3);
    const query = mockDb.select.mock.calls[0]![0] as string;
    expect(query).toContain("t.is_filtered = 1");
  });

  it("getThreadCountForAccount counts only threads with is_filtered = 1", async () => {
    mockDb.select.mockResolvedValueOnce([{ count: 5 }]);
    const count = await getThreadCountForAccount("acc-1");

    expect(count).toBe(5);
    const query = mockDb.select.mock.calls[0]![0] as string;
    expect(query).toContain("is_filtered = 1");
  });

  it("upsertThread passes isFiltered to SQL execute", async () => {
    await upsertThread({
      id: "th-1",
      accountId: "acc-1",
      subject: "Test",
      snippet: "Snippet",
      lastMessageAt: 12345,
      messageCount: 1,
      isRead: false,
      isStarred: false,
      isImportant: false,
      hasAttachments: false,
      isFiltered: true,
    });

    expect(mockDb.execute).toHaveBeenCalled();
    const params = mockDb.execute.mock.calls[0]![1] as unknown[];
    expect(params[10]).toBe(1); // isFilteredVal = 1
  });
});
