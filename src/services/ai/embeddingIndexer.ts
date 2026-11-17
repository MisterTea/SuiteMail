import { getUnembeddedMessageIds } from "@/services/db/embeddings";
import { indexMessageForVectorSearch } from "./embeddingService";
import { getDb } from "@/services/db/connection";

export async function indexBatchForAccount(
  accountId: string,
  batchSize = 25,
): Promise<{ indexedCount: number }> {
  const unembeddedIds = await getUnembeddedMessageIds(accountId, batchSize);
  if (unembeddedIds.length === 0) {
    return { indexedCount: 0 };
  }

  const db = await getDb();
  const placeholders = unembeddedIds.map((_, i) => `$${i + 2}`).join(", ");
  const rows = await db.select<Array<{
    id: string;
    subject: string | null;
    body_text: string | null;
    snippet: string | null;
  }>>(
    `SELECT id, subject, body_text, snippet
     FROM messages
     WHERE account_id = $1 AND id IN (${placeholders})`,
    [accountId, ...unembeddedIds],
  );

  let indexedCount = 0;
  for (const msg of rows) {
    try {
      await indexMessageForVectorSearch(
        accountId,
        msg.id,
        msg.subject,
        msg.body_text,
        msg.snippet,
      );
      indexedCount++;
    } catch (err) {
      console.warn(`Failed to generate vector embedding for message ${msg.id}:`, err);
    }
  }

  return { indexedCount };
}

export async function indexAllForAccount(
  accountId: string,
  onProgress?: (indexed: number) => void,
): Promise<{ totalIndexed: number }> {
  let totalIndexed = 0;
  while (true) {
    const { indexedCount } = await indexBatchForAccount(accountId, 50);
    if (indexedCount === 0) break;
    totalIndexed += indexedCount;
    onProgress?.(totalIndexed);
  }
  return { totalIndexed };
}

