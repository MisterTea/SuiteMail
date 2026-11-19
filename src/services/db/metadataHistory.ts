import { getDb } from "./connection";

export interface MetadataHistoryRecord {
  id: string;
  account_id: string;
  conversation_id: string;
  timestamp: number;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  change_summary: string | null;
  reverted: number;
  reverted_at: number | null;
  reverted_by_id: string | null;
  created_at?: number;
}

export interface MetadataLedgerRecord {
  id: string;
  account_id: string;
  conversation_id: string;
  timestamp: number;
  entry_jsonl: string;
  imap_uid: number | null;
  synced_to_imap: number;
  created_at?: number;
}

export interface NewMetadataChange {
  id?: string;
  accountId: string;
  conversationId: string;
  timestamp?: number;
  action: string;
  field?: string;
  oldValue?: any;
  newValue?: any;
  changeSummary?: string;
}

export interface NewMetadataLedgerEntry {
  id: string;
  accountId: string;
  conversationId: string;
  timestamp?: number;
  entryJsonl: string;
  imapUid?: number | null;
  syncedToImap?: boolean;
}

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `meta-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Record a metadata change in the SQLite metadata_history table,
 * and also append a corresponding JSONL line in metadata_ledger.
 */
export async function recordMetadataChange(
  change: NewMetadataChange,
): Promise<MetadataHistoryRecord> {
  const id = change.id || generateId();
  const timestamp = change.timestamp ?? Date.now();
  const oldValueStr =
    change.oldValue !== undefined ? JSON.stringify(change.oldValue) : null;
  const newValueStr =
    change.newValue !== undefined ? JSON.stringify(change.newValue) : null;
  const field = change.field ?? null;
  const changeSummary =
    change.changeSummary ||
    `${change.action} on ${field ?? "metadata"}`;

  const record: MetadataHistoryRecord = {
    id,
    account_id: change.accountId,
    conversation_id: change.conversationId,
    timestamp,
    action: change.action,
    field,
    old_value: oldValueStr,
    new_value: newValueStr,
    change_summary: changeSummary,
    reverted: 0,
    reverted_at: null,
    reverted_by_id: null,
  };

  const ledgerEntryPayload = {
    id,
    conversationId: change.conversationId,
    timestamp,
    action: change.action,
    field: change.field,
    oldValue: change.oldValue,
    newValue: change.newValue,
    summary: changeSummary,
  };
  const jsonlLine = JSON.stringify(ledgerEntryPayload);

  try {
    const db = await getDb();
    await db.execute(
      `INSERT INTO metadata_history (
        id, account_id, conversation_id, timestamp, action, field,
        old_value, new_value, change_summary, reverted, reverted_at, reverted_by_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, NULL, NULL)`,
      [
        id,
        change.accountId,
        change.conversationId,
        timestamp,
        change.action,
        field,
        oldValueStr,
        newValueStr,
        changeSummary,
      ],
    );

    await db.execute(
      `INSERT INTO metadata_ledger (
        id, account_id, conversation_id, timestamp, entry_jsonl, imap_uid, synced_to_imap
      ) VALUES ($1, $2, $3, $4, $5, NULL, 0)`,
      [id, change.accountId, change.conversationId, timestamp, jsonlLine],
    );
  } catch (err) {
    console.warn("[metadataHistory] Failed to write metadata history/ledger to DB:", err);
  }

  return record;
}

/**
 * Record a raw JSONL entry into the local ledger table (e.g. when pulled from IMAP).
 */
export async function recordMetadataLedgerEntry(
  entry: NewMetadataLedgerEntry,
): Promise<void> {
  const timestamp = entry.timestamp ?? Date.now();
  try {
    const db = await getDb();
    await db.execute(
      `INSERT OR IGNORE INTO metadata_ledger (
        id, account_id, conversation_id, timestamp, entry_jsonl, imap_uid, synced_to_imap
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.id,
        entry.accountId,
        entry.conversationId,
        timestamp,
        entry.entryJsonl,
        entry.imapUid ?? null,
        entry.syncedToImap ? 1 : 0,
      ],
    );
  } catch (err) {
    console.warn("[metadataHistory] Failed to write raw ledger entry:", err);
  }
}

/**
 * Get metadata change history with flexible filtering options.
 */
export async function getMetadataHistory(
  accountId?: string,
  options?: {
    conversationId?: string;
    limit?: number;
    since?: number;
    includeReverted?: boolean;
  },
): Promise<MetadataHistoryRecord[]> {
  try {
    const db = await getDb();
    let query = `SELECT * FROM metadata_history WHERE 1=1`;
    const params: unknown[] = [];

    if (accountId) {
      params.push(accountId);
      query += ` AND account_id = $${params.length}`;
    }
    if (options?.conversationId) {
      params.push(options.conversationId);
      query += ` AND conversation_id = $${params.length}`;
    }
    if (options?.since) {
      params.push(options.since);
      query += ` AND timestamp >= $${params.length}`;
    }
    if (options?.includeReverted === false) {
      query += ` AND reverted = 0`;
    }

    query += ` ORDER BY timestamp DESC`;

    if (options?.limit) {
      params.push(options.limit);
      query += ` LIMIT $${params.length}`;
    }

    return await db.select<MetadataHistoryRecord[]>(query, params);
  } catch (err) {
    console.warn("[metadataHistory] Failed to fetch metadata history:", err);
    return [];
  }
}

/**
 * Fetch a single metadata change record by ID.
 */
export async function getMetadataChangeById(
  id: string,
): Promise<MetadataHistoryRecord | null> {
  try {
    const db = await getDb();
    const rows = await db.select<MetadataHistoryRecord[]>(
      `SELECT * FROM metadata_history WHERE id = $1 LIMIT 1`,
      [id],
    );
    return rows[0] || null;
  } catch (err) {
    console.warn(`[metadataHistory] Failed to get change ${id}:`, err);
    return null;
  }
}

/**
 * Get non-reverted metadata changes made in the past hour.
 */
export async function getMetadataChangesPastHour(
  accountId?: string,
  conversationId?: string,
): Promise<MetadataHistoryRecord[]> {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  try {
    const db = await getDb();
    let query = `
      SELECT * FROM metadata_history
      WHERE timestamp >= $1
        AND reverted = 0
        AND action != 'revert'
    `;
    const params: unknown[] = [oneHourAgo];

    if (accountId) {
      params.push(accountId);
      query += ` AND account_id = $${params.length}`;
    }
    if (conversationId) {
      params.push(conversationId);
      query += ` AND conversation_id = $${params.length}`;
    }

    query += ` ORDER BY timestamp DESC`;
    return await db.select<MetadataHistoryRecord[]>(query, params);
  } catch (err) {
    console.warn("[metadataHistory] Failed to get changes in past hour:", err);
    return [];
  }
}

/**
 * Mark a metadata change record as reverted.
 */
export async function markMetadataChangeReverted(
  id: string,
  revertedById: string,
  revertedAt: number = Date.now(),
): Promise<void> {
  try {
    const db = await getDb();
    await db.execute(
      `UPDATE metadata_history
       SET reverted = 1, reverted_at = $1, reverted_by_id = $2
       WHERE id = $3`,
      [revertedAt, revertedById, id],
    );
  } catch (err) {
    console.warn(`[metadataHistory] Failed to mark change ${id} as reverted:`, err);
  }
}

/**
 * Retrieve local ledger entries for an account/conversation.
 */
export async function getMetadataLedgerEntries(
  accountId: string,
  conversationId?: string,
): Promise<MetadataLedgerRecord[]> {
  try {
    const db = await getDb();
    let query = `SELECT * FROM metadata_ledger WHERE account_id = $1`;
    const params: unknown[] = [accountId];

    if (conversationId) {
      params.push(conversationId);
      query += ` AND conversation_id = $${params.length}`;
    }

    query += ` ORDER BY timestamp ASC`;
    return await db.select<MetadataLedgerRecord[]>(query, params);
  } catch (err) {
    console.warn("[metadataHistory] Failed to get ledger entries:", err);
    return [];
  }
}

/**
 * Get ledger entries that have not yet been synced to IMAP.
 */
export async function getUnsyncedLedgerEntries(
  accountId: string,
): Promise<MetadataLedgerRecord[]> {
  try {
    const db = await getDb();
    return await db.select<MetadataLedgerRecord[]>(
      `SELECT * FROM metadata_ledger WHERE account_id = $1 AND synced_to_imap = 0 ORDER BY timestamp ASC`,
      [accountId],
    );
  } catch (err) {
    console.warn("[metadataHistory] Failed to get unsynced ledger entries:", err);
    return [];
  }
}

/**
 * Mark local ledger entries as successfully pushed to IMAP.
 */
export async function markLedgerEntriesSynced(
  ids: string[],
  imapUid?: number,
): Promise<void> {
  if (ids.length === 0) return;
  try {
    const db = await getDb();
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
    await db.execute(
      `UPDATE metadata_ledger
       SET synced_to_imap = 1, imap_uid = COALESCE($${ids.length + 1}, imap_uid)
       WHERE id IN (${placeholders})`,
      [...ids, imapUid ?? null],
    );
  } catch (err) {
    console.warn("[metadataHistory] Failed to mark ledger entries as synced:", err);
  }
}
