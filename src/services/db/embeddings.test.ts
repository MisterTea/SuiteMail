import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  upsertEmbedding,
  getEmbeddingsForAccount,
  deleteEmbedding,
  getUnembeddedMessageIds,
} from "./embeddings";

const mockDb = {
  execute: vi.fn(),
  select: vi.fn(),
};

vi.mock("./connection", () => ({
  getDb: vi.fn(() => Promise.resolve(mockDb)),
}));

describe("embeddings db service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts an embedding vector into email_embeddings", async () => {
    mockDb.execute.mockResolvedValue(undefined);
    await upsertEmbedding("acc-1", "msg-100", [0.1, 0.2, 0.3], "Sample chunk");

    expect(mockDb.execute).toHaveBeenCalledTimes(1);
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO email_embeddings"),
      ["acc-1", "msg-100", "[0.1,0.2,0.3]", "Sample chunk"],
    );
  });

  it("fetches embeddings for account", async () => {
    mockDb.select.mockResolvedValue([
      {
        account_id: "acc-1",
        message_id: "msg-100",
        embedding_json: "[0.1,0.2,0.3]",
        text_chunk: "Sample",
        created_at: 1000,
      },
    ]);

    const res = await getEmbeddingsForAccount("acc-1");
    expect(res).toHaveLength(1);
    expect(res[0]?.message_id).toBe("msg-100");
  });

  it("deletes embedding for message", async () => {
    mockDb.execute.mockResolvedValue(undefined);
    await deleteEmbedding("acc-1", "msg-100");

    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM email_embeddings"),
      ["acc-1", "msg-100"],
    );
  });

  it("fetches unembedded message ids", async () => {
    mockDb.select.mockResolvedValue([{ id: "msg-1" }, { id: "msg-2" }]);
    const ids = await getUnembeddedMessageIds("acc-1", 50);

    expect(ids).toEqual(["msg-1", "msg-2"]);
  });

  it("fetches embedding stats for an account", async () => {
    mockDb.select
      .mockResolvedValueOnce([{ count: 10 }])
      .mockResolvedValueOnce([{ count: 7 }]);

    const stats = await import("./embeddings").then((m) => m.getEmbeddingStats("acc-1"));
    expect(stats).toEqual({ totalMessages: 10, embeddedCount: 7 });
  });

  it("clears all embeddings", async () => {
    mockDb.execute.mockResolvedValue(undefined);
    await import("./embeddings").then((m) => m.clearAllEmbeddings("acc-1"));
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM email_embeddings WHERE account_id = $1"),
      ["acc-1"],
    );
  });
});
