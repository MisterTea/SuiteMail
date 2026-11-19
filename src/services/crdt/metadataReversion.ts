import {
  getMetadataChangesPastHour,
  getMetadataChangeById,
  markMetadataChangeReverted,
  recordMetadataChange,
  type MetadataHistoryRecord,
} from "../db/metadataHistory";
import {
  setConversationMetadataLabels,
  setConversationMetadataCategory,
  setConversationMetadataFollowUp,
  markEmailFiltered,
  getOrInitPersonalMetadataDoc,
  updatePersonalMetadataDoc,
  savePersonalMetadataDoc,
  reconcilePersonalMetadataToDb,
} from "./metadataCrdt";
import { appendLedgerEntriesToRemote, type MetadataLedgerEntry } from "../imap/metadataSidecarSync";
import { getAccount, getAllAccounts } from "../db/accounts";
import { buildImapConfig } from "../imap/imapConfigBuilder";
import type { ImapConfig } from "../imap/tauriCommands";

export interface ReversalDetail {
  originalChangeId: string;
  conversationId: string;
  action: string;
  field: string | null;
  restoredValue: any;
  reversalEntryId: string;
}

export interface ReversalResult {
  reversedCount: number;
  affectedConversations: string[];
  reversals: ReversalDetail[];
}

function parseJsonSafe(val: string | null): any {
  if (val === null || val === undefined) return null;
  try {
    return JSON.parse(val);
  } catch {
    return val;
  }
}

/**
 * Reverses a single metadata change record by ID.
 * Restores the previous value (old_value) into the database and CRDT doc,
 * marks the original record as reverted, records an audit log entry,
 * and appends a JSONL entry to the IMAP ledger.
 */
export async function reverseMetadataChange(
  changeId: string,
  accountId?: string,
  options?: { config?: ImapConfig },
): Promise<boolean> {
  const record = await getMetadataChangeById(changeId);
  if (!record || record.reverted === 1 || record.action === "revert") {
    return false;
  }
  const effectiveAccountId = accountId || record.account_id;
  const oldValue = parseJsonSafe(record.old_value);
  const now = Date.now();
  const reversalId = `rev-${record.id}-${now}`;

  // 1. Restore previous value
  await applyRestoredValue(effectiveAccountId, record.conversation_id, record.field, record.action, oldValue);

  // 2. Mark original change as reverted
  await markMetadataChangeReverted(record.id, reversalId, now);

  // 3. Record the reversal audit entry
  const newValue = parseJsonSafe(record.new_value);
  await recordMetadataChange({
    id: reversalId,
    accountId: effectiveAccountId,
    conversationId: record.conversation_id,
    action: "revert",
    field: record.field ?? undefined,
    oldValue: newValue,
    newValue: oldValue,
    changeSummary: `Reversed change ${record.id}: restored ${record.field ?? "metadata"}`,
    timestamp: now,
  });

  // 4. Append to IMAP server ledger if available
  const ledgerEntry: MetadataLedgerEntry = {
    id: reversalId,
    conversationId: record.conversation_id,
    timestamp: now,
    action: "revert",
    field: record.field ?? undefined,
    oldValue: newValue,
    newValue: oldValue,
    summary: `Reversed change ${record.id}`,
    isReversion: true,
    revertedEntryId: record.id,
  };

  await tryAppendLedgerToImap(effectiveAccountId, record.conversation_id, [ledgerEntry], options?.config);

  return true;
}

/**
 * Reverse all metadata changes made in the past hour.
 * Optionally filter by accountId and/or conversationId.
 */
export async function reverseMetadataChangesPastHour(
  accountId?: string,
  conversationId?: string,
  options?: { config?: ImapConfig; now?: number },
): Promise<ReversalResult> {
  // If no accountId is given, collect for all accounts
  let targetAccountIds: string[] = [];
  if (accountId) {
    targetAccountIds = [accountId];
  } else {
    try {
      const all = await getAllAccounts();
      targetAccountIds = all.map((a) => a.id);
    } catch {
      // If DB lookup fails
      targetAccountIds = [];
    }
  }

  // If still empty, try single null lookup
  if (targetAccountIds.length === 0) {
    targetAccountIds = [accountId ?? ""];
  }

  const allRecords: MetadataHistoryRecord[] = [];
  for (const accId of targetAccountIds) {
    const records = await getMetadataChangesPastHour(accId || undefined, conversationId);
    allRecords.push(...records);
  }

  if (allRecords.length === 0) {
    return { reversedCount: 0, affectedConversations: [], reversals: [] };
  }

  // Sort newest first to undo in reverse chronological order
  allRecords.sort((a, b) => b.timestamp - a.timestamp);

  const reversals: ReversalDetail[] = [];
  const affectedConversations = new Set<string>();
  const ledgerEntriesByAccountAndConv = new Map<string, MetadataLedgerEntry[]>();

  for (const record of allRecords) {
    const oldValue = parseJsonSafe(record.old_value);
    const newValue = parseJsonSafe(record.new_value);
    const now = Date.now();
    const reversalId = `rev-${record.id}-${now}`;

    // 1. Restore previous value into CRDT doc & SQLite tables
    await applyRestoredValue(record.account_id, record.conversation_id, record.field, record.action, oldValue);

    // 2. Mark original record as reverted
    await markMetadataChangeReverted(record.id, reversalId, now);

    // 3. Record audit log entry in SQLite
    await recordMetadataChange({
      id: reversalId,
      accountId: record.account_id,
      conversationId: record.conversation_id,
      action: "revert",
      field: record.field ?? undefined,
      oldValue: newValue,
      newValue: oldValue,
      changeSummary: `Reversed change ${record.id}: restored ${record.field ?? "metadata"}`,
      timestamp: now,
    });

    affectedConversations.add(record.conversation_id);
    reversals.push({
      originalChangeId: record.id,
      conversationId: record.conversation_id,
      action: record.action,
      field: record.field,
      restoredValue: oldValue,
      reversalEntryId: reversalId,
    });

    // 4. Collect ledger entries for IMAP
    const key = `${record.account_id}:${record.conversation_id}`;
    if (!ledgerEntriesByAccountAndConv.has(key)) {
      ledgerEntriesByAccountAndConv.set(key, []);
    }
    ledgerEntriesByAccountAndConv.get(key)!.push({
      id: reversalId,
      conversationId: record.conversation_id,
      timestamp: now,
      action: "revert",
      field: record.field ?? undefined,
      oldValue: newValue,
      newValue: oldValue,
      summary: `Reversed change ${record.id}`,
      isReversion: true,
      revertedEntryId: record.id,
    });
  }

  // 5. Append ledger entries to IMAP for all affected conversations
  for (const [key, entries] of ledgerEntriesByAccountAndConv.entries()) {
    const [accId, convId] = key.split(":");
    if (accId && convId) {
      await tryAppendLedgerToImap(accId, convId, entries, options?.config);
    }
  }

  return {
    reversedCount: reversals.length,
    affectedConversations: Array.from(affectedConversations),
    reversals,
  };
}

/**
 * Helper to apply restored value back into CRDT doc and SQLite tables.
 */
async function applyRestoredValue(
  accountId: string,
  conversationId: string,
  field: string | null,
  action: string,
  restoredValue: any,
): Promise<void> {
  if (field === "labels" || action === "set_labels") {
    const labels = Array.isArray(restoredValue) ? restoredValue : [];
    await setConversationMetadataLabels(accountId, conversationId, labels, { skipAudit: true });
  } else if (field === "category" || action === "set_category") {
    await setConversationMetadataCategory(accountId, conversationId, restoredValue, { skipAudit: true });
  } else if (field === "followUpAt" || action === "set_followup") {
    await setConversationMetadataFollowUp(accountId, conversationId, restoredValue, { skipAudit: true });
  } else if (field === "isFiltered" || action === "set_filtered") {
    await markEmailFiltered(accountId, conversationId, Boolean(restoredValue), { skipAudit: true });
  } else {
    // Generic fallback for any other fields in personal CRDT doc
    const doc = await getOrInitPersonalMetadataDoc(accountId, conversationId);
    const updated = updatePersonalMetadataDoc(doc, { [field || "custom"]: restoredValue });
    await savePersonalMetadataDoc(accountId, conversationId, updated);
    await reconcilePersonalMetadataToDb(accountId, conversationId, updated);
  }
}

/**
 * Helper to safely append ledger entries to the IMAP server.
 */
async function tryAppendLedgerToImap(
  accountId: string,
  conversationId: string,
  entries: MetadataLedgerEntry[],
  config?: ImapConfig,
): Promise<void> {
  try {
    let imapConfig = config;
    let email = "";
    const account = await getAccount(accountId);
    if (account && account.provider === "imap") {
      imapConfig = imapConfig ?? buildImapConfig(account);
      email = account.email;
    }
    if (imapConfig && email) {
      await appendLedgerEntriesToRemote(imapConfig, email, conversationId, entries);
    }
  } catch (err) {
    console.warn(`[metadataReversion] Failed to push reversion ledger entries to IMAP for ${conversationId}:`, err);
  }
}
