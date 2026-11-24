import type { SqlDatabase } from "@/platform";
import { getDb, withTransaction } from "./connection";
import { normalizeEmail } from "@/utils/emailUtils";

type AllowlistChange = { accountId: string; source: "local" | "imap" };
const listeners = new Set<(change: AllowlistChange) => void>();

export function addImageAllowlistChangeListener(listener: (change: AllowlistChange) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notifyChange(change: AllowlistChange): void {
  for (const listener of listeners) {
    try {
      listener(change);
    } catch (err) {
      console.warn("Image allowlist change listener failed:", err);
    }
  }
}

export async function isAllowlisted(
  accountId: string,
  senderAddress: string,
): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<{ id: string }[]>(
    "SELECT id FROM image_allowlist WHERE account_id = $1 AND sender_address = $2 LIMIT 1",
    [accountId, normalizeEmail(senderAddress)],
  );
  return rows.length > 0;
}

/**
 * Batch-check which senders are allowlisted in a single query.
 */
export async function getAllowlistedSenders(
  accountId: string,
  senderAddresses: string[],
): Promise<Set<string>> {
  if (senderAddresses.length === 0) return new Set();
  const db = await getDb();
  const normalized = senderAddresses.map(normalizeEmail);
  const placeholders = normalized.map((_, i) => `$${i + 2}`).join(", ");
  const rows = await db.select<{ sender_address: string }[]>(
    `SELECT sender_address FROM image_allowlist WHERE account_id = $1 AND sender_address IN (${placeholders})`,
    [accountId, ...normalized],
  );
  return new Set(rows.map((r) => r.sender_address));
}

export async function addToAllowlist(
  accountId: string,
  senderAddress: string,
): Promise<void> {
  await updateAllowlist(accountId, senderAddress, true);
}

export async function removeFromAllowlist(
  accountId: string,
  senderAddress: string,
): Promise<void> {
  await updateAllowlist(accountId, senderAddress, false);
}

async function updateAllowlist(accountId: string, senderAddress: string, allow: boolean): Promise<void> {
  const address = normalizeEmail(senderAddress);
  if (!address) throw new Error("A sender address is required");
  let changed = false;
  await withTransaction(async (db) => {
    changed = (await writeEntry(db, accountId, address, allow)).rowsAffected > 0;
  });
  if (changed) notifyChange({ accountId, source: "local" });
}

function writeEntry(db: SqlDatabase, accountId: string, address: string, allow: boolean) {
  return allow
    ? db.execute(
      "INSERT OR IGNORE INTO image_allowlist (id, account_id, sender_address) VALUES ($1, $2, $3)",
      [crypto.randomUUID(), accountId, address],
    )
    : db.execute(
      "DELETE FROM image_allowlist WHERE account_id = $1 AND sender_address = $2",
      [accountId, address],
    );
}

export interface AllowlistEntry {
  id: string;
  account_id: string;
  sender_address: string;
  created_at: number;
}

export async function getAllowlistForAccount(
  accountId: string,
): Promise<AllowlistEntry[]> {
  return readAllowlist(await getDb(), accountId);
}

function readAllowlist(db: SqlDatabase, accountId: string): Promise<AllowlistEntry[]> {
  return db.select<AllowlistEntry[]>(
    "SELECT * FROM image_allowlist WHERE account_id = $1 ORDER BY sender_address",
    [accountId],
  );
}

export async function readImageAllowlistSyncState(accountId: string): Promise<string[] | null> {
  const db = await getDb();
  const [state] = await db.select<{ senders_json: string }[]>(
    "SELECT senders_json FROM imap_image_allowlist_sync_state WHERE account_id = $1", [accountId],
  );
  return state ? JSON.parse(state.senders_json) as string[] : null;
}

export async function saveSyncedImageAllowlist(
  accountId: string,
  before: ReadonlySet<string>,
  synced: ReadonlySet<string>,
): Promise<void> {
  let changed = false;
  await withTransaction(async (db) => {
    const current = new Set((await readAllowlist(db, accountId)).map((entry) => entry.sender_address));
    for (const address of new Set([...before, ...synced])) {
      const allowed = current.has(address);
      // A local edit during the IMAP exchange is picked up by the next sync.
      if (allowed !== before.has(address) || allowed === synced.has(address)) continue;
      await writeEntry(db, accountId, address, synced.has(address));
      changed = true;
    }
    await db.execute(
      `INSERT INTO imap_image_allowlist_sync_state (account_id, senders_json) VALUES ($1, $2)
       ON CONFLICT(account_id) DO UPDATE SET senders_json = excluded.senders_json`,
      [accountId, JSON.stringify([...synced])],
    );
  });
  if (changed) notifyChange({ accountId, source: "imap" });
}
