import { getDb } from "./connection";

export interface DbEmbedding {
  message_id: string;
  account_id: string;
  embedding_json: string;
  text_chunk: string;
  created_at: number;
}

export async function upsertEmbedding(
  accountId: string,
  messageId: string,
  vector: number[],
  textChunk: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO email_embeddings (account_id, message_id, embedding_json, text_chunk, created_at)
     VALUES ($1, $2, $3, $4, unixepoch())
     ON CONFLICT(account_id, message_id) DO UPDATE SET
       embedding_json = $3,
       text_chunk = $4,
       created_at = unixepoch()`,
    [accountId, messageId, JSON.stringify(vector), textChunk],
  );
}

export async function getEmbeddingsForAccount(accountId: string): Promise<DbEmbedding[]> {
  const db = await getDb();
  return db.select<DbEmbedding[]>(
    "SELECT * FROM email_embeddings WHERE account_id = $1 ORDER BY created_at DESC",
    [accountId],
  );
}

export async function deleteEmbedding(accountId: string, messageId: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM email_embeddings WHERE account_id = $1 AND message_id = $2",
    [accountId, messageId],
  );
}

export async function getUnembeddedMessageIds(accountId: string, limit = 100): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ id: string }[]>(
    `SELECT m.id FROM messages m
     LEFT JOIN email_embeddings e ON m.account_id = e.account_id AND m.id = e.message_id
     WHERE m.account_id = $1 AND e.message_id IS NULL
     ORDER BY m.date DESC
     LIMIT $2`,
    [accountId, limit],
  );
  return rows.map((r) => r.id);
}

export async function getEmbeddingStats(accountId?: string): Promise<{ totalMessages: number; embeddedCount: number }> {
  const db = await getDb();
  if (accountId) {
    const totalRow = await db.select<{ count: number }[]>(
      "SELECT COUNT(*) as count FROM messages WHERE account_id = $1",
      [accountId],
    );
    const embeddedRow = await db.select<{ count: number }[]>(
      "SELECT COUNT(*) as count FROM email_embeddings WHERE account_id = $1",
      [accountId],
    );
    return {
      totalMessages: totalRow[0]?.count ?? 0,
      embeddedCount: embeddedRow[0]?.count ?? 0,
    };
  }
  const totalRow = await db.select<{ count: number }[]>(
    "SELECT COUNT(*) as count FROM messages",
  );
  const embeddedRow = await db.select<{ count: number }[]>(
    "SELECT COUNT(*) as count FROM email_embeddings",
  );
  return {
    totalMessages: totalRow[0]?.count ?? 0,
    embeddedCount: embeddedRow[0]?.count ?? 0,
  };
}

export async function clearAllEmbeddings(accountId?: string): Promise<void> {
  const db = await getDb();
  if (accountId) {
    await db.execute("DELETE FROM email_embeddings WHERE account_id = $1", [accountId]);
  } else {
    await db.execute("DELETE FROM email_embeddings");
  }
}


/** Drop embeddings so the indexer rebuilds them (e.g. after a message's full body is downloaded). */
export async function deleteEmbeddingsForMessages(accountId: string, messageIds: string[]): Promise<void> {
  if (!messageIds.length) return;
  const db = await getDb();
  await db.execute(
    `DELETE FROM email_embeddings WHERE account_id = $1 AND message_id IN (${messageIds.map((_, i) => `$${i + 2}`).join(", ")})`,
    [accountId, ...messageIds],
  );
}
