import { getDb } from "./connection";
import type { DbThread } from "./threads";
import { searchMessages } from "./search";

export async function getUnifiedThreads(
  accountIds: string[],
  label: string | null,
  query: string,
  limit: number,
  offset: number,
): Promise<DbThread[]> {
  if (!accountIds.length) return [];
  const db = await getDb();
  const hits = query ? await searchMessages(query, undefined, 200) : null;
  const threadKeys = hits && JSON.stringify(hits.map((hit) => [hit.account_id, hit.thread_id]));
  return db.select<DbThread[]>(
    `SELECT t.*, m.from_name, m.from_address, m.to_addresses FROM threads t
     LEFT JOIN messages m ON m.rowid = (
       SELECT latest.rowid FROM messages latest
       WHERE latest.account_id = t.account_id AND latest.thread_id = t.id
       ORDER BY latest.date DESC, latest.id DESC LIMIT 1
     )
     WHERE t.account_id IN (SELECT value FROM json_each($1))
       AND t.is_filtered = 1
       AND ($2 IS NULL OR ($2 = 'STARRED' AND t.is_starred = 1) OR EXISTS (
         SELECT 1 FROM thread_labels l WHERE l.account_id = t.account_id AND l.thread_id = t.id AND l.label_id = $2
       ))
       AND ($3 IS NULL OR EXISTS (
         SELECT 1 FROM json_each($3) hit
         WHERE json_extract(hit.value, '$[0]') = t.account_id AND json_extract(hit.value, '$[1]') = t.id
       ))
     ORDER BY t.is_pinned DESC, t.last_message_at DESC, t.account_id, t.id
     LIMIT $4 OFFSET $5`,
    [JSON.stringify(accountIds), label, threadKeys, limit, offset],
  );
}
