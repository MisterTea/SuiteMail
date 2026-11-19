import { getDb } from "./connection";

export interface DbThread {
  id: string;
  account_id: string;
  subject: string | null;
  snippet: string | null;
  last_message_at: number | null;
  message_count: number;
  is_read: number;
  is_starred: number;
  is_important: number;
  has_attachments: number;
  is_snoozed: number;
  snooze_until: number | null;
  is_pinned: number;
  is_muted: number;
  from_name: string | null;
  from_address: string | null;
  to_addresses?: string | null;
  is_filtered?: number;
}

export async function getThreadsForAccount(
  accountId: string,
  labelId?: string,
  limit = 50,
  offset = 0,
): Promise<DbThread[]> {
  const db = await getDb();
  if (labelId) {
    return db.select<DbThread[]>(
      `SELECT t.*, m.from_name, m.from_address, m.to_addresses FROM threads t
       INNER JOIN thread_labels tl ON tl.account_id = t.account_id AND tl.thread_id = t.id
       LEFT JOIN messages m ON m.account_id = t.account_id AND m.thread_id = t.id
         AND m.date = (SELECT MAX(m2.date) FROM messages m2 WHERE m2.account_id = t.account_id AND m2.thread_id = t.id)
       WHERE t.account_id = $1 AND tl.label_id = $2 AND t.is_filtered = 1
       GROUP BY t.account_id, t.id
       ORDER BY t.is_pinned DESC, t.last_message_at DESC
       LIMIT $3 OFFSET $4`,
      [accountId, labelId, limit, offset],
    );
  }
  return db.select<DbThread[]>(
    `SELECT t.*, m.from_name, m.from_address, m.to_addresses FROM threads t
     LEFT JOIN messages m ON m.account_id = t.account_id AND m.thread_id = t.id
       AND m.date = (SELECT MAX(m2.date) FROM messages m2 WHERE m2.account_id = t.account_id AND m2.thread_id = t.id)
     WHERE t.account_id = $1 AND t.is_filtered = 1
     ORDER BY t.is_pinned DESC, t.last_message_at DESC LIMIT $2 OFFSET $3`,
    [accountId, limit, offset],
  );
}

export async function getThreadsForCategory(
  accountId: string,
  category: string,
  limit = 50,
  offset = 0,
): Promise<DbThread[]> {
  const db = await getDb();
  if (category === "Primary") {
    // Primary includes threads with NULL category (uncategorized)
    return db.select<DbThread[]>(
      `SELECT t.*, m.from_name, m.from_address FROM threads t
       INNER JOIN thread_labels tl ON tl.account_id = t.account_id AND tl.thread_id = t.id
       LEFT JOIN thread_categories tc ON tc.account_id = t.account_id AND tc.thread_id = t.id
       LEFT JOIN messages m ON m.account_id = t.account_id AND m.thread_id = t.id
         AND m.date = (SELECT MAX(m2.date) FROM messages m2 WHERE m2.account_id = t.account_id AND m2.thread_id = t.id)
       WHERE t.account_id = $1 AND tl.label_id = 'INBOX' AND t.is_filtered = 1 AND (tc.category IS NULL OR tc.category = 'Primary')
       GROUP BY t.account_id, t.id
       ORDER BY t.is_pinned DESC, t.last_message_at DESC
       LIMIT $2 OFFSET $3`,
      [accountId, limit, offset],
    );
  }
  return db.select<DbThread[]>(
    `SELECT t.*, m.from_name, m.from_address FROM threads t
     INNER JOIN thread_labels tl ON tl.account_id = t.account_id AND tl.thread_id = t.id
     INNER JOIN thread_categories tc ON tc.account_id = t.account_id AND tc.thread_id = t.id
     LEFT JOIN messages m ON m.account_id = t.account_id AND m.thread_id = t.id
       AND m.date = (SELECT MAX(m2.date) FROM messages m2 WHERE m2.account_id = t.account_id AND m2.thread_id = t.id)
     WHERE t.account_id = $1 AND tl.label_id = 'INBOX' AND t.is_filtered = 1 AND tc.category = $2
     GROUP BY t.account_id, t.id
     ORDER BY t.is_pinned DESC, t.last_message_at DESC
     LIMIT $3 OFFSET $4`,
    [accountId, category, limit, offset],
  );
}

export async function upsertThread(thread: {
  id: string;
  accountId: string;
  subject: string | null;
  snippet: string | null;
  lastMessageAt: number | null;
  messageCount: number;
  isRead: boolean;
  isStarred: boolean;
  isImportant: boolean;
  hasAttachments: boolean;
  isFiltered?: boolean;
}): Promise<void> {
  const db = await getDb();
  const isFilteredVal = thread.isFiltered !== undefined ? (thread.isFiltered ? 1 : 0) : null;
  await db.execute(
    `INSERT INTO threads (id, account_id, subject, snippet, last_message_at, message_count, is_read, is_starred, is_important, has_attachments, is_filtered)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, 0))
     ON CONFLICT(account_id, id) DO UPDATE SET
       subject = $3, snippet = $4, last_message_at = $5, message_count = $6,
       is_read = $7, is_starred = $8, is_important = $9, has_attachments = $10,
       is_filtered = COALESCE($11, threads.is_filtered)`,
    [
      thread.id,
      thread.accountId,
      thread.subject,
      thread.snippet,
      thread.lastMessageAt,
      thread.messageCount,
      thread.isRead ? 1 : 0,
      thread.isStarred ? 1 : 0,
      thread.isImportant ? 1 : 0,
      thread.hasAttachments ? 1 : 0,
      isFilteredVal,
    ],
  );
}

export async function setThreadLabels(
  accountId: string,
  threadId: string,
  labelIds: string[],
): Promise<void> {
  const db = await getDb();
  // Remove existing labels
  await db.execute(
    "DELETE FROM thread_labels WHERE account_id = $1 AND thread_id = $2",
    [accountId, threadId],
  );
  // Insert new labels
  for (const labelId of labelIds) {
    await db.execute(
      "INSERT OR IGNORE INTO thread_labels (account_id, thread_id, label_id) VALUES ($1, $2, $3)",
      [accountId, threadId, labelId],
    );
  }
}

export async function getThreadLabelIds(
  accountId: string,
  threadId: string,
): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ label_id: string }[]>(
    "SELECT label_id FROM thread_labels WHERE account_id = $1 AND thread_id = $2",
    [accountId, threadId],
  );
  return rows.map((r) => r.label_id);
}

export async function getThreadById(
  accountId: string,
  threadId: string,
  onlyFiltered = false,
): Promise<DbThread | undefined> {
  const db = await getDb();
  const whereClause = onlyFiltered
    ? "WHERE t.account_id = $1 AND t.id = $2 AND t.is_filtered = 1"
    : "WHERE t.account_id = $1 AND t.id = $2";
  const rows = await db.select<DbThread[]>(
    `SELECT t.*, m.from_name, m.from_address FROM threads t
     LEFT JOIN messages m ON m.account_id = t.account_id AND m.thread_id = t.id
       AND m.date = (SELECT MAX(m2.date) FROM messages m2 WHERE m2.account_id = t.account_id AND m2.thread_id = t.id)
     ${whereClause}
     LIMIT 1`,
    [accountId, threadId],
  );
  return rows[0];
}

export async function getThreadCountForAccount(accountId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>(
    "SELECT COUNT(*) as count FROM threads WHERE account_id = $1 AND is_filtered = 1",
    [accountId],
  );
  return rows[0]?.count ?? 0;
}

export async function getSnoozedCount(accountId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>(
    "SELECT COUNT(*) as count FROM threads WHERE account_id = $1 AND is_snoozed = 1",
    [accountId],
  );
  return rows[0]?.count ?? 0;
}

export async function getDraftCountForAccount(accountId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>(
    `SELECT COUNT(DISTINCT t.id) as count
     FROM threads t
     INNER JOIN thread_labels tl ON tl.account_id = t.account_id AND tl.thread_id = t.id
     WHERE t.account_id = $1 AND tl.label_id = 'DRAFT'`,
    [accountId],
  );
  return rows[0]?.count ?? 0;
}

export async function getStarredCount(accountId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>(
    "SELECT COUNT(*) as count FROM threads WHERE account_id = $1 AND is_starred = 1 AND is_filtered = 1",
    [accountId],
  );
  return rows[0]?.count ?? 0;
}

export async function getUnreadInboxCount(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM threads t
     INNER JOIN thread_labels tl ON tl.account_id = t.account_id AND tl.thread_id = t.id
     WHERE tl.label_id = 'INBOX' AND t.is_read = 0 AND t.is_filtered = 1`,
  );
  return rows[0]?.count ?? 0;
}

/** Unread inbox conversations for one account. This is the number Gmail shows on Inbox. */
export async function getUnreadInboxCountForAccount(accountId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM threads t
     INNER JOIN thread_labels tl ON tl.account_id = t.account_id AND tl.thread_id = t.id
     WHERE t.account_id = $1 AND tl.label_id = 'INBOX' AND t.is_read = 0 AND t.is_filtered = 1`,
    [accountId],
  );
  return rows[0]?.count ?? 0;
}

/**
 * Threads that carry every listed label. Used for Gmail category views,
 * which are inbox mail plus a CATEGORY_* label.
 */
export async function getThreadsForLabels(
  accountId: string,
  labelIds: string[],
  limit = 50,
  offset = 0,
): Promise<DbThread[]> {
  const ids = labelIds.filter((id) => id.length > 0);
  if (ids.length === 0) return getThreadsForAccount(accountId, undefined, limit, offset);
  if (ids.length === 1) return getThreadsForAccount(accountId, ids[0], limit, offset);

  const db = await getDb();
  const joins = ids
    .map(
      (_, i) =>
        `INNER JOIN thread_labels tl${i} ON tl${i}.account_id = t.account_id AND tl${i}.thread_id = t.id AND tl${i}.label_id = $${i + 2}`,
    )
    .join("\n");
  const limitParam = ids.length + 2;
  const offsetParam = ids.length + 3;
  return db.select<DbThread[]>(
    `SELECT t.*, m.from_name, m.from_address, m.to_addresses FROM threads t
     ${joins}
     LEFT JOIN messages m ON m.account_id = t.account_id AND m.thread_id = t.id
       AND m.date = (SELECT MAX(m2.date) FROM messages m2 WHERE m2.account_id = t.account_id AND m2.thread_id = t.id)
     WHERE t.account_id = $1 AND t.is_filtered = 1
     GROUP BY t.account_id, t.id
     ORDER BY t.is_pinned DESC, t.last_message_at DESC
     LIMIT $${limitParam} OFFSET $${offsetParam}`,
    [accountId, ...ids, limit, offset],
  );
}

/** Unread inbox conversations that also have one of the given labels, keyed by that label id. */
export async function getUnreadInboxCountsForLabels(
  accountId: string,
  labelIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (labelIds.length === 0) return counts;
  const db = await getDb();
  const placeholders = labelIds.map((_, i) => `$${i + 2}`).join(", ");
  const rows = await db.select<{ label_id: string; count: number }[]>(
    `SELECT cat.label_id as label_id, COUNT(DISTINCT t.id) as count
     FROM threads t
     INNER JOIN thread_labels inbox ON inbox.account_id = t.account_id AND inbox.thread_id = t.id AND inbox.label_id = 'INBOX'
     INNER JOIN thread_labels cat ON cat.account_id = t.account_id AND cat.thread_id = t.id
       AND cat.label_id IN (${placeholders})
     WHERE t.account_id = $1 AND t.is_read = 0 AND t.is_filtered = 1
     GROUP BY cat.label_id`,
    [accountId, ...labelIds],
  );
  for (const row of rows) counts.set(row.label_id, row.count);
  return counts;
}

/**
 * Threads in INBOX that do not have the FOCUSED label.
 * Used for the "Other" tab in EWS accounts.
 */
export async function getThreadsForOtherInbox(
  accountId: string,
  limit = 50,
  offset = 0,
): Promise<DbThread[]> {
  const db = await getDb();
  return db.select<DbThread[]>(
    `SELECT t.*, m.from_name, m.from_address, m.to_addresses FROM threads t
     INNER JOIN thread_labels inbox ON inbox.account_id = t.account_id AND inbox.thread_id = t.id AND inbox.label_id = 'INBOX'
     LEFT JOIN messages m ON m.account_id = t.account_id AND m.thread_id = t.id
       AND m.date = (SELECT MAX(m2.date) FROM messages m2 WHERE m2.account_id = t.account_id AND m2.thread_id = t.id)
     WHERE t.account_id = $1 AND t.is_filtered = 1
       AND NOT EXISTS (
         SELECT 1 FROM thread_labels fl
         WHERE fl.account_id = t.account_id AND fl.thread_id = t.id AND fl.label_id = 'FOCUSED'
       )
     GROUP BY t.account_id, t.id
     ORDER BY t.is_pinned DESC, t.last_message_at DESC
     LIMIT $2 OFFSET $3`,
    [accountId, limit, offset],
  );
}

export async function getUnreadFocusedInboxCount(accountId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>(
    `SELECT COUNT(DISTINCT t.id) as count FROM threads t
     INNER JOIN thread_labels inbox ON inbox.account_id = t.account_id AND inbox.thread_id = t.id AND inbox.label_id = 'INBOX'
     INNER JOIN thread_labels fl ON fl.account_id = t.account_id AND fl.thread_id = t.id AND fl.label_id = 'FOCUSED'
     WHERE t.account_id = $1 AND t.is_read = 0 AND t.is_filtered = 1`,
    [accountId],
  );
  return rows[0]?.count ?? 0;
}

export async function getUnreadOtherInboxCount(accountId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>(
    `SELECT COUNT(DISTINCT t.id) as count FROM threads t
     INNER JOIN thread_labels inbox ON inbox.account_id = t.account_id AND inbox.thread_id = t.id AND inbox.label_id = 'INBOX'
     WHERE t.account_id = $1 AND t.is_read = 0 AND t.is_filtered = 1
       AND NOT EXISTS (
         SELECT 1 FROM thread_labels fl
         WHERE fl.account_id = t.account_id AND fl.thread_id = t.id AND fl.label_id = 'FOCUSED'
       )`,
    [accountId],
  );
  return rows[0]?.count ?? 0;
}

export async function deleteThread(
  accountId: string,
  threadId: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM threads WHERE account_id = $1 AND id = $2",
    [accountId, threadId],
  );
}

export async function deleteAllThreadsForAccount(
  accountId: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM threads WHERE account_id = $1",
    [accountId],
  );
}

export async function pinThread(
  accountId: string,
  threadId: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE threads SET is_pinned = 1 WHERE account_id = $1 AND id = $2",
    [accountId, threadId],
  );
}

export async function unpinThread(
  accountId: string,
  threadId: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE threads SET is_pinned = 0 WHERE account_id = $1 AND id = $2",
    [accountId, threadId],
  );
}

export async function muteThread(
  accountId: string,
  threadId: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE threads SET is_muted = 1 WHERE account_id = $1 AND id = $2",
    [accountId, threadId],
  );
}

export async function unmuteThread(
  accountId: string,
  threadId: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE threads SET is_muted = 0 WHERE account_id = $1 AND id = $2",
    [accountId, threadId],
  );
}

export async function getMutedThreadIds(
  accountId: string,
): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.select<{ id: string }[]>(
    "SELECT id FROM threads WHERE account_id = $1 AND is_muted = 1",
    [accountId],
  );
  return new Set(rows.map((r) => r.id));
}
