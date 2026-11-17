import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  cosineSimilarity,
  normalizeVector,
  generateLocalDenseVector,
  generateEmbedding,
  searchSimilarMessages,
} from "./embeddingService";

const mockGetEmbeddings = vi.fn();
const mockDb = {
  select: vi.fn(),
  execute: vi.fn(),
};

vi.mock("@/services/db/connection", () => ({
  getDb: vi.fn(() => Promise.resolve(mockDb)),
}));

vi.mock("@/services/db/embeddings", () => ({
  getEmbeddingsForAccount: (...args: unknown[]) => mockGetEmbeddings(...args),
  upsertEmbedding: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/services/db/settings", () => ({
  getSetting: vi.fn(() => Promise.resolve(null)),
}));

describe("embeddingService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("cosineSimilarity", () => {
    it("returns 1 for identical vectors", () => {
      const vec = [0.6, 0.8];
      expect(cosineSimilarity(vec, vec)).toBeCloseTo(1.0, 5);
    });

    it("returns 0 for orthogonal vectors", () => {
      expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    });

    it("returns 0 for empty vectors", () => {
      expect(cosineSimilarity([], [])).toBe(0);
    });
  });

  describe("normalizeVector", () => {
    it("normalizes a vector to magnitude 1", () => {
      const vec = [3, 4];
      const norm = normalizeVector(vec);
      expect(norm[0]).toBeCloseTo(0.6, 5);
      expect(norm[1]).toBeCloseTo(0.8, 5);
    });
  });

  describe("generateLocalDenseVector & generateEmbedding", () => {
    it("generates dense vectors with 384 dimensions", async () => {
      const vec = await generateEmbedding("Quarterly product roadmap meeting");
      expect(vec.length).toBe(384);
      // Normalized magnitude should be ~1
      let mag = 0;
      for (const v of vec) mag += v * v;
      expect(Math.sqrt(mag)).toBeCloseTo(1.0, 3);
    });

    it("produces higher similarity for semantically related texts", async () => {
      const vecA = await generateEmbedding("flight reservation confirmation airline ticket");
      const vecB = await generateEmbedding("boarding pass airline flight check-in");
      const vecC = await generateEmbedding("quarterly dental insurance coverage billing");

      const simRelated = cosineSimilarity(vecA, vecB);
      const simUnrelated = cosineSimilarity(vecA, vecC);

      expect(simRelated).toBeGreaterThan(simUnrelated);
    });
  });

  describe("searchSimilarMessages", () => {
    it("searches stored embeddings and returns top matching messages", async () => {
      const vecInvoice = await generateEmbedding("Monthly subscription billing receipt payment");
      mockGetEmbeddings.mockResolvedValue([
        {
          message_id: "msg-inv",
          embedding_json: JSON.stringify(vecInvoice),
          text_chunk: "Your receipt for monthly cloud subscription",
        },
      ]);

      mockDb.select.mockResolvedValue([
        {
          id: "msg-inv",
          thread_id: "thread-1",
          subject: "Your Cloud Receipt",
          from_name: "Billing Dept",
          from_address: "billing@cloud.io",
          snippet: "Payment received $49.00",
          date: 1763330000,
        },
      ]);

      const results = await searchSimilarMessages("acc-1", "cloud receipt payment invoice");
      expect(results.length).toBe(1);
      expect(results[0]?.messageId).toBe("msg-inv");
      expect(results[0]?.subject).toBe("Your Cloud Receipt");
      expect(results[0]?.similarityScore).toBeGreaterThan(0.3);
    });
  });
});
