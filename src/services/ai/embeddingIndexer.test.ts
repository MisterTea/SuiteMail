import { describe, it, expect, vi, beforeEach } from "vitest";
import { indexBatchForAccount, indexAllForAccount } from "./embeddingIndexer";

const mockGetUnembedded = vi.fn();
const mockIndexMessage = vi.fn();
const mockDb = {
  select: vi.fn(),
};

vi.mock("@/services/db/connection", () => ({
  getDb: vi.fn(() => Promise.resolve(mockDb)),
}));

vi.mock("@/services/db/embeddings", () => ({
  getUnembeddedMessageIds: (...args: unknown[]) => mockGetUnembedded(...args),
}));

vi.mock("./embeddingService", () => ({
  indexMessageForVectorSearch: (...args: unknown[]) => mockIndexMessage(...args),
}));

describe("embeddingIndexer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0 indexed count when no messages need embedding", async () => {
    mockGetUnembedded.mockResolvedValue([]);
    const res = await indexBatchForAccount("acc-1", 10);
    expect(res.indexedCount).toBe(0);
    expect(mockIndexMessage).not.toHaveBeenCalled();
  });

  it("indexes unembedded messages in batch", async () => {
    mockGetUnembedded.mockResolvedValue(["msg-1", "msg-2"]);
    mockDb.select.mockResolvedValue([
      { id: "msg-1", subject: "Hello", body_text: "World", snippet: "Hello world" },
      { id: "msg-2", subject: "Invoice", body_text: "Due tomorrow", snippet: "Due tomorrow" },
    ]);
    mockIndexMessage.mockResolvedValue(undefined);

    const res = await indexBatchForAccount("acc-1", 10);
    expect(res.indexedCount).toBe(2);
    expect(mockIndexMessage).toHaveBeenCalledTimes(2);
    expect(mockIndexMessage).toHaveBeenCalledWith("acc-1", "msg-1", "Hello", "World", "Hello world");
  });

  it("indexes all batches until empty", async () => {
    mockGetUnembedded
      .mockResolvedValueOnce(["msg-1"])
      .mockResolvedValueOnce([]);
    mockDb.select.mockResolvedValue([
      { id: "msg-1", subject: "Hello", body_text: "World", snippet: "Hello world" },
    ]);
    mockIndexMessage.mockResolvedValue(undefined);

    const progressCallback = vi.fn();
    const res = await indexAllForAccount("acc-1", progressCallback);
    expect(res.totalIndexed).toBe(1);
    expect(progressCallback).toHaveBeenCalledWith(1);
  });
});
