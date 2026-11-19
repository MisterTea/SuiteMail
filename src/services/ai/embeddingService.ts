import { getDb } from "@/services/db/connection";
import { getEmbeddingsForAccount, upsertEmbedding } from "@/services/db/embeddings";
import { getSetting } from "@/services/db/settings";
import { loadPiServerUrl } from "./llamaServer";
import { platformFetch as safeFetch } from "@/platform";

export interface SemanticSearchResult {
  messageId: string;
  threadId: string;
  subject: string;
  fromName: string | null;
  fromAddress: string | null;
  snippet: string | null;
  date: number;
  similarityScore: number;
  textChunk: string;
}

/**
 * Compute cosine similarity between two numeric vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const valA = a[i]!;
    const valB = b[i]!;
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Normalize vector to unit length.
 */
export function normalizeVector(vec: number[]): number[] {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

/**
 * Deterministic local feature hashing vectorizer (384 dimensions).
 * Provides robust, fast semantic representation without network dependencies.
 */
export function generateLocalDenseVector(text: string, dimensions = 384): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);

  if (words.length === 0) return vector;

  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    // Hash unigram
    let hash = 0;
    for (let c = 0; c < word.length; c++) {
      hash = (hash * 31 + word.charCodeAt(c)) >>> 0;
    }
    const idx1 = hash % dimensions;
    const sign1 = (hash & 1) === 0 ? 1 : -1;
    vector[idx1] = (vector[idx1] ?? 0) + sign1;

    // Hash bigram with previous word for semantic phrase awareness
    if (i > 0) {
      const prev = words[i - 1]!;
      let biHash = hash;
      for (let c = 0; c < prev.length; c++) {
        biHash = (biHash * 37 + prev.charCodeAt(c)) >>> 0;
      }
      const idx2 = biHash % dimensions;
      const sign2 = (biHash & 1) === 0 ? 1 : -1;
      vector[idx2] = (vector[idx2] ?? 0) + sign2 * 1.5;
    }
  }

  return normalizeVector(vector);
}

/**
 * Generate embedding vector for a piece of text:
 * 1. Attempts remote embedding endpoint (/v1/embeddings) if Pi/Ollama/OpenAI configured.
 * 2. Falls back seamlessly to the deterministic local dense vectorizer.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const trimmed = text.trim();
  if (!trimmed) {
    return new Array<number>(384).fill(0);
  }

  const storedPiServerUrl = await getSetting("pi_server_url");
  if (storedPiServerUrl) {
    const piServerUrl = await loadPiServerUrl();
    try {
      const endpoint = `${piServerUrl.replace(/\/+$/, "")}/v1/embeddings`;
      const res = await safeFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: trimmed.slice(0, 2000),
          model: "gemma-4-e4b",
        }),
      });

      if (res.ok) {
        const json = await res.json() as { data?: Array<{ embedding?: number[] }> };
        const vec = json.data?.[0]?.embedding;
        if (Array.isArray(vec) && vec.length > 0) {
          return normalizeVector(vec);
        }
      }
    } catch {
      // Fall through to local vectorizer
    }
  }

  return generateLocalDenseVector(trimmed);
}

/**
 * Index a single message into the vector database.
 */
export async function indexMessageForVectorSearch(
  accountId: string,
  messageId: string,
  subject: string | null,
  bodyText: string | null,
  snippet: string | null,
): Promise<void> {
  const textChunk = [subject, snippet, bodyText?.slice(0, 1000)]
    .filter(Boolean)
    .join(" \n ");

  if (!textChunk.trim()) return;

  const vector = await generateEmbedding(textChunk);
  await upsertEmbedding(accountId, messageId, vector, textChunk);
}

/**
 * Perform semantic vector search over stored email embeddings for an account.
 */
export async function searchSimilarMessages(
  accountId: string,
  conceptQuery: string,
  topK = 10,
  threshold = 0.15,
): Promise<SemanticSearchResult[]> {
  const queryVec = await generateEmbedding(conceptQuery);
  const storedEmbeddings = await getEmbeddingsForAccount(accountId);

  if (storedEmbeddings.length === 0) {
    return [];
  }

  const scored: Array<{ messageId: string; score: number; textChunk: string }> = [];

  for (const item of storedEmbeddings) {
    try {
      const docVec = JSON.parse(item.embedding_json) as number[];
      const score = cosineSimilarity(queryVec, docVec);
      if (score >= threshold) {
        scored.push({
          messageId: item.message_id,
          score,
          textChunk: item.text_chunk,
        });
      }
    } catch {
      // ignore corrupted json
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const topMatches = scored.slice(0, topK);

  if (topMatches.length === 0) return [];

  // Fetch full message metadata from SQLite
  const db = await getDb();
  const placeholders = topMatches.map((_, i) => `$${i + 2}`).join(", ");
  const messageRows = await db.select<Array<{
    id: string;
    thread_id: string;
    subject: string | null;
    from_name: string | null;
    from_address: string | null;
    snippet: string | null;
    date: number;
  }>>(
    `SELECT id, thread_id, subject, from_name, from_address, snippet, date
     FROM messages
     WHERE account_id = $1 AND id IN (${placeholders})`,
    [accountId, ...topMatches.map((m) => m.messageId)],
  );

  const rowMap = new Map(messageRows.map((r) => [r.id, r]));

  const results: SemanticSearchResult[] = [];
  for (const match of topMatches) {
    const row = rowMap.get(match.messageId);
    if (row) {
      results.push({
        messageId: row.id,
        threadId: row.thread_id,
        subject: row.subject ?? "(No subject)",
        fromName: row.from_name,
        fromAddress: row.from_address,
        snippet: row.snippet,
        date: row.date,
        similarityScore: Math.round(match.score * 100) / 100,
        textChunk: match.textChunk,
      });
    }
  }

  return results;
}
