import * as automerge from "@automerge/automerge";
import {
  imapListFolders,
  imapCreateFolder,
  imapAppendMessage,
  imapSearchAllUids,
  imapFetchMessages,
  imapGetFolderStatus,
  type ImapConfig,
} from "./tauriCommands";
import { isSidecarFolder, METADATA_SIDECAR_FOLDER } from "./folderMapper";
import { getFolderSyncState, upsertFolderSyncState } from "../db/folderSyncState";
import { setThreadCategory } from "../db/threadCategories";
import { insertFollowUpReminder } from "../db/followUpReminders";
import { getThreadCrdtDoc, upsertThreadCrdtDoc } from "../db/threadCrdtDocs";
import { getThreadLabelIds } from "../db/threads";
import {
  deserializeMetadataDoc,
  mergeMetadataDocs,
  serializeMetadataDoc,
  reconcilePersonalMetadataToDb,
  getOrInitPersonalMetadataDoc,
  updatePersonalMetadataDoc,
  savePersonalMetadataDoc,
  setConversationMetadataLabels,
  setConversationMetadataCategory,
  setConversationMetadataFollowUp,
  markEmailFiltered,
  type PersonalMetadataState,
} from "../crdt/metadataCrdt";
import {
  recordMetadataLedgerEntry,
  markMetadataChangeReverted,
} from "../db/metadataHistory";
import { getAccount } from "../db/accounts";
import { buildImapConfig } from "./imapConfigBuilder";
import {
  checkOutgoingSyncAllowed,
  buildOutgoingSyncRequest,
} from "../sync/outgoingSyncGuard";
import type { OutgoingDiffItem } from "@/stores/outgoingSyncStore";

export {
  reverseMetadataChangesPastHour,
  reverseMetadataChange,
  type ReversalResult,
  type ReversalDetail,
} from "../crdt/metadataReversion";

/**
 * An individual entry in the append-only IMAP metadata ledger.
 * Stored as a line in JSONL format, allowing changes to be recorded
 * without mutating previous data in-place or re-uploading entire snapshots.
 */
export interface MetadataLedgerEntry {
  id: string;
  conversationId: string;
  timestamp: number;
  action: string;
  field?: string;
  oldValue?: any;
  newValue?: any;
  summary?: string;
  isReversion?: boolean;
  revertedEntryId?: string;
  crdtDocBase64?: string;
  personalLabels?: string[];
  categories?: string[];
  category?: string | null;
  followUpAt?: number | null;
  isFiltered?: boolean;
}

/**
 * Payload stored in the .metadata shadow folder on IMAP.
 * Represents the user's private personal conversation metadata
 * (e.g. personal follow-up/snooze, private labels, private notes, personal category).
 * This data is synchronized only across the user's own devices and is NEVER
 * sent out in email replies.
 */
export interface PersonalSidecarPayload {
  conversationId: string;
  targetId?: string; // backwards compatibility alias for conversationId
  type: "personal" | "local" | "conversation";
  updatedAt: number;
  categories?: string[];
  category?: string | null;
  followUpAt?: number | null;
  privateNotes?: string;
  personalLabels?: string[];
  isFiltered?: boolean;
  crdtDocBase64?: string;
}

export type LocalSidecarPayload = PersonalSidecarPayload;
export type SidecarPayload = PersonalSidecarPayload;

/**
 * Ensure the hidden sidecar folder exists on the IMAP server.
 * Returns the exact path to use for IMAP commands.
 */
export async function ensureSidecarFolder(config: ImapConfig): Promise<string> {
  const folders = await imapListFolders(config);
  const existing = folders.find((f) => isSidecarFolder(f.path) || isSidecarFolder(f.name));

  if (existing) {
    return existing.raw_path || existing.path;
  }

  try {
    await imapCreateFolder(config, METADATA_SIDECAR_FOLDER);
  } catch (err) {
    // If creation returns an error because it already exists or namespace requires prefix, log warning
    console.warn(`[metadataSidecarSync] Note on creating ${METADATA_SIDECAR_FOLDER}:`, err);
  }

  return METADATA_SIDECAR_FOLDER;
}

/**
 * Encode a string to URL-safe base64 without padding.
 */
function base64UrlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Format a sidecar conversation metadata payload as an RFC 2822 email message.
 */
export function buildSidecarEmail(
  fromEmail: string,
  conversationId: string,
  payload: SidecarPayload,
): string {
  const jsonBody = JSON.stringify(payload, null, 2);
  const lines = [
    `From: <${fromEmail}>`,
    `To: <${fromEmail}>`,
    `Subject: SuperMail-Personal-Metadata: ${conversationId}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <metadata-${conversationId}-${Date.now()}@supermail.local>`,
    `X-SuperMail-Sidecar: true`,
    `X-SuperMail-Metadata-Scope: personal`,
    `X-SuperMail-Conversation-Id: ${conversationId}`,
    `MIME-Version: 1.0`,
    `Content-Type: application/json; charset=utf-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    jsonBody,
  ];
  return lines.join("\r\n");
}

/**
 * Append a conversation metadata update to the IMAP sidecar folder.
 */
export async function pushSidecarMetadata(
  config: ImapConfig,
  fromEmail: string,
  payload: SidecarPayload,
): Promise<void> {
  const conversationId = payload.conversationId || payload.targetId;
  if (!conversationId) {
    throw new Error("Cannot push sidecar metadata without conversationId");
  }
  const folder = await ensureSidecarFolder(config);
  const normalizedPayload: SidecarPayload = {
    ...payload,
    conversationId,
    targetId: conversationId,
    type: "personal",
  };
  const rawRfc = buildSidecarEmail(fromEmail, conversationId, normalizedPayload);
  const base64Url = base64UrlEncode(rawRfc);
  await imapAppendMessage(config, folder, base64Url, "(\\Seen)");
}

/**
 * Format an append-only sequence of metadata ledger change entries as an RFC 2822 email message.
 * Each entry is represented as a single line in JSONL format in the message body.
 */
export function buildLedgerEmail(
  fromEmail: string,
  conversationId: string,
  entries: MetadataLedgerEntry[],
): string {
  const jsonlBody = entries.map((e) => JSON.stringify(e)).join("\n");
  const lines = [
    `From: <${fromEmail}>`,
    `To: <${fromEmail}>`,
    `Subject: SuperMail-Metadata-Ledger: ${conversationId}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <metadata-ledger-${conversationId}-${Date.now()}@supermail.local>`,
    `X-SuperMail-Sidecar: true`,
    `X-SuperMail-Metadata-Scope: personal`,
    `X-SuperMail-Metadata-Format: jsonl`,
    `X-SuperMail-Conversation-Id: ${conversationId}`,
    `MIME-Version: 1.0`,
    `Content-Type: application/x-ndjson; charset=utf-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    jsonlBody,
  ];
  return lines.join("\r\n");
}

/**
 * Append metadata changes as discrete JSONL ledger entries to the IMAP server.
 * Does not mutate or overwrite previous data in-place.
 */
export async function appendLedgerEntriesToRemote(
  config: ImapConfig,
  fromEmail: string,
  conversationId: string,
  entries: MetadataLedgerEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const folder = await ensureSidecarFolder(config);
  const rawRfc = buildLedgerEmail(fromEmail, conversationId, entries);
  const base64Url = base64UrlEncode(rawRfc);
  await imapAppendMessage(config, folder, base64Url, "(\\Seen)");
}

/**
 * Parse raw email body which can either be a JSONL stream (one JSON object per line)
 * or a single pretty-printed JSON payload.
 */
export function parseMetadataLines(rawText: string): any[] {
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  try {
    const single = JSON.parse(trimmed);
    return [single];
  } catch {
    const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    const results: any[] = [];
    for (const line of lines) {
      try {
        results.push(JSON.parse(line));
      } catch (err) {
        console.warn("[metadataSidecarSync] Skipping invalid JSON line in metadata body:", line, err);
      }
    }
    return results;
  }
}

/**
 * Pull and apply remote metadata changes from the IMAP sidecar folder.
 * Supports both JSONL ledger format and backwards-compatible snapshot format.
 */
export async function syncSidecarMetadata(
  accountId: string,
  config: ImapConfig,
): Promise<number> {
  const folders = await imapListFolders(config);
  const sidecar = folders.find((f) => isSidecarFolder(f.path) || isSidecarFolder(f.name));
  if (!sidecar) {
    return 0;
  }

  const folderPath = sidecar.raw_path || sidecar.path;
  const syncState = await getFolderSyncState(accountId, folderPath);
  const status = await imapGetFolderStatus(config, folderPath);

  const lastUid = syncState?.last_uid ?? 0;
  const allUids = await imapSearchAllUids(config, folderPath);
  const newUids = allUids.filter((uid) => uid > lastUid);

  if (newUids.length === 0) {
    return 0;
  }

  // Fetch messages in batches of 25
  let appliedCount = 0;
  const batchSize = 25;
  for (let i = 0; i < newUids.length; i += batchSize) {
    const chunk = newUids.slice(i, i + batchSize);
    const fetchResult = await imapFetchMessages(config, folderPath, chunk);

    for (const msg of fetchResult.messages) {
      const rawText = msg.body_text || msg.body_html || "";
      if (!rawText.trim()) continue;

      try {
        const items = parseMetadataLines(rawText);

        for (const payload of items) {
          const conversationId = payload.conversationId || payload.targetId;
          if (!conversationId) continue;

          // If this is an append-only ledger entry with an action
          if (payload.action) {
            const entryId = payload.id || `imap-${msg.uid}-${Date.now()}`;
            await recordMetadataLedgerEntry({
              id: entryId,
              accountId,
              conversationId,
              timestamp: payload.timestamp ?? Date.now(),
              entryJsonl: JSON.stringify(payload),
              imapUid: msg.uid,
              syncedToImap: true,
            }).catch(() => {});

            if (payload.action === "revert" || payload.isReversion) {
              if (payload.revertedEntryId) {
                await markMetadataChangeReverted(payload.revertedEntryId, entryId, payload.timestamp).catch(() => {});
              }
              if (payload.field === "labels") {
                const labels = Array.isArray(payload.newValue) ? payload.newValue : [];
                await setConversationMetadataLabels(accountId, conversationId, labels, { skipAudit: true });
              } else if (payload.field === "category") {
                await setConversationMetadataCategory(accountId, conversationId, payload.newValue, { skipAudit: true });
              } else if (payload.field === "followUpAt") {
                await setConversationMetadataFollowUp(accountId, conversationId, payload.newValue, { skipAudit: true });
              } else if (payload.field === "isFiltered") {
                await markEmailFiltered(accountId, conversationId, Boolean(payload.newValue), { skipAudit: true });
              }
            } else {
              if (payload.action === "set_labels" || payload.field === "labels") {
                const labels = payload.newValue ?? payload.personalLabels ?? payload.labels;
                if (labels && Array.isArray(labels)) {
                  await setConversationMetadataLabels(accountId, conversationId, labels, { skipAudit: true });
                }
              }
              if (payload.action === "set_category" || payload.field === "category") {
                const category = payload.newValue ?? (payload.categories ? payload.categories[0] : null);
                await setConversationMetadataCategory(accountId, conversationId, category, { skipAudit: true });
              }
              if (payload.action === "set_followup" || payload.field === "followUpAt") {
                const followUpAt = payload.newValue ?? payload.followUpAt;
                await setConversationMetadataFollowUp(accountId, conversationId, followUpAt, { skipAudit: true });
              }
              if (payload.action === "set_filtered" || payload.field === "isFiltered") {
                const isFiltered = payload.newValue ?? payload.isFiltered;
                if (isFiltered !== undefined) {
                  await markEmailFiltered(accountId, conversationId, Boolean(isFiltered), { skipAudit: true });
                }
              }
            }

            if (payload.crdtDocBase64) {
              const remoteDoc = deserializeMetadataDoc<PersonalMetadataState>(payload.crdtDocBase64);
              const existing = await getThreadCrdtDoc(accountId, conversationId, "personal");
              let merged: automerge.Doc<PersonalMetadataState>;
              if (existing && existing.doc_base64) {
                const localDoc = deserializeMetadataDoc<PersonalMetadataState>(existing.doc_base64);
                merged = mergeMetadataDocs(localDoc, remoteDoc);
              } else {
                merged = remoteDoc;
              }
              await upsertThreadCrdtDoc({
                account_id: accountId,
                thread_id: conversationId,
                scope: "personal",
                doc_base64: serializeMetadataDoc(merged),
              });
              await reconcilePersonalMetadataToDb(accountId, conversationId, merged);
            }
          } else {
            // Backwards-compatible legacy snapshot payload
            if (payload.categories && payload.categories.length > 0) {
              const category = payload.categories[0];
              if (category) {
                await setThreadCategory(accountId, conversationId, category, true);
              }
            }

            if (payload.followUpAt) {
              await insertFollowUpReminder(accountId, conversationId, conversationId, payload.followUpAt);
            }

            if (payload.personalLabels && payload.personalLabels.length > 0) {
              await setConversationMetadataLabels(accountId, conversationId, payload.personalLabels, { skipAudit: true });
            }

            if (payload.crdtDocBase64) {
              const remoteDoc = deserializeMetadataDoc<PersonalMetadataState>(payload.crdtDocBase64);
              const existing = await getThreadCrdtDoc(accountId, conversationId, "personal");
              let merged: automerge.Doc<PersonalMetadataState>;
              if (existing && existing.doc_base64) {
                const localDoc = deserializeMetadataDoc<PersonalMetadataState>(existing.doc_base64);
                merged = mergeMetadataDocs(localDoc, remoteDoc);
              } else {
                merged = remoteDoc;
              }
              if (payload.isFiltered !== undefined && merged.isFiltered !== payload.isFiltered) {
                merged = updatePersonalMetadataDoc(merged, { isFiltered: payload.isFiltered });
              }
              await upsertThreadCrdtDoc({
                account_id: accountId,
                thread_id: conversationId,
                scope: "personal",
                doc_base64: serializeMetadataDoc(merged),
              });
              await reconcilePersonalMetadataToDb(accountId, conversationId, merged);
            } else if (payload.isFiltered !== undefined) {
              const doc = await getOrInitPersonalMetadataDoc(accountId, conversationId, {
                conversationId,
                isFiltered: payload.isFiltered,
              });
              const updated = updatePersonalMetadataDoc(doc, { isFiltered: payload.isFiltered });
              await savePersonalMetadataDoc(accountId, conversationId, updated);
              await reconcilePersonalMetadataToDb(accountId, conversationId, updated);
            }
          }

          appliedCount++;
        }
      } catch (e) {
        console.warn(`[metadataSidecarSync] Failed to parse sidecar message UID ${msg.uid}:`, e);
      }
    }
  }

  // Update sync state
  const maxUid = Math.max(...newUids, lastUid);
  await upsertFolderSyncState({
    account_id: accountId,
    folder_path: folderPath,
    uidvalidity: status.uidvalidity,
    last_uid: maxUid,
    modseq: status.highest_modseq,
    last_sync_at: Date.now(),
  });

  return appliedCount;
}

/**
 * Check if there is pending metadata in the sidecar folder on the IMAP server
 * that has not been downloaded yet.
 */
export async function hasPendingMetadata(
  accountId: string,
  config: ImapConfig,
): Promise<boolean> {
  const folders = await imapListFolders(config);
  const sidecar = folders.find((f) => isSidecarFolder(f.path) || isSidecarFolder(f.name));
  if (!sidecar) {
    return false;
  }

  const folderPath = sidecar.raw_path || sidecar.path;
  const syncState = await getFolderSyncState(accountId, folderPath);
  const lastUid = syncState?.last_uid ?? 0;
  const allUids = await imapSearchAllUids(config, folderPath);
  return allUids.some((uid) => uid > lastUid);
}

/**
 * Ensure any pending metadata on the server has been downloaded.
 */
export async function ensureMetadataDownloaded(
  accountId: string,
  config: ImapConfig,
): Promise<number> {
  return syncSidecarMetadata(accountId, config);
}

/**
 * Make sure there isn't metadata for that email/conversation yet to be downloaded
 * before adding or assuming an empty metadata item.
 * If there are pending metadata messages in the sidecar folder, downloads and applies them.
 */
export async function ensureMetadataDownloadedForEmail(
  accountId: string,
  config: ImapConfig,
  _conversationId?: string,
): Promise<number> {
  const hasPending = await hasPendingMetadata(accountId, config);
  if (hasPending) {
    return await syncSidecarMetadata(accountId, config);
  }
  return 0;
}

/**
 * Helper to ensure metadata is downloaded for an account, automatically building
 * config if it is an IMAP account.
 */
export async function ensureMetadataDownloadedForAccount(
  accountId: string,
  config?: ImapConfig,
  conversationId?: string,
): Promise<void> {
  let imapConfig = config;
  if (!imapConfig) {
    const account = await getAccount(accountId);
    if (account && account.provider === "imap") {
      imapConfig = buildImapConfig(account);
    }
  }
  if (imapConfig) {
    await ensureMetadataDownloadedForEmail(accountId, imapConfig, conversationId);
  }
}

/**
 * Sync conversation labels to the remote IMAP metadata sidecar.
 * Updates labels based on conversation labels without changing IMAP folders.
 */
export async function syncConversationLabelsToRemote(
  accountId: string,
  threadId: string,
  labels?: string[],
  config?: ImapConfig,
): Promise<void> {
  const currentLabels = labels ?? (await getThreadLabelIds(accountId, threadId));
  await setConversationMetadataLabels(accountId, threadId, currentLabels);

  try {
    let imapConfig = config;
    let email = "";
    const account = await getAccount(accountId);
    if (account && account.provider === "imap") {
      imapConfig = imapConfig ?? buildImapConfig(account);
      email = account.email;
    }
    if (imapConfig && email) {
      const crdtRecord = await getThreadCrdtDoc(accountId, threadId, "personal");
      await pushSidecarMetadata(imapConfig, email, {
        conversationId: threadId,
        type: "personal",
        updatedAt: Date.now(),
        personalLabels: currentLabels,
        crdtDocBase64: crdtRecord?.doc_base64,
      });
    }
  } catch (err) {
    console.warn(`[metadataSidecarSync] Failed to push conversation labels for ${threadId}:`, err);
  }
}

/**
 * Sync conversation labels for multiple threads to the remote IMAP metadata sidecar.
 * If there is a large outgoing diff (e.g. during a first sync or bulk change),
 * prompts the user with a popover summary before syncing to the server.
 * Syncing from server to app is always ok and unaffected.
 */
export async function syncBatchConversationLabelsToRemote(
  accountId: string,
  updates: { threadId: string; labels: string[]; subject?: string }[],
  options?: { isFirstSync?: boolean; config?: ImapConfig },
): Promise<{ synced: number; confirmed: boolean }> {
  if (updates.length === 0) {
    return { synced: 0, confirmed: true };
  }

  // Update local metadata for all threads (local DB / CRDT doc)
  for (const update of updates) {
    await setConversationMetadataLabels(accountId, update.threadId, update.labels);
  }

  const diffItems: OutgoingDiffItem[] = updates.map((u) => ({
    id: u.threadId,
    type: "label",
    summary: `Set conversation labels: [${u.labels.join(", ")}]`,
    threadId: u.threadId,
    subject: u.subject,
    labels: u.labels,
  }));

  const request = buildOutgoingSyncRequest({
    accountId,
    isFirstSync: options?.isFirstSync,
    items: diffItems,
    title: options?.isFirstSync
      ? `Confirm First Sync to Server (${updates.length} Conversations)`
      : `Confirm Outgoing Label Sync (${updates.length} Conversations)`,
    description: options?.isFirstSync
      ? `Initial sync has imported ${updates.length} conversations. Please confirm before syncing conversation labels and metadata from the app to the mail server. Syncing from server to app is unaffected.`
      : `SuperMail is ready to upload conversation labels for ${updates.length} conversations to the mail server. Syncing from server to app is unaffected.`,
  });

  const allowed = await checkOutgoingSyncAllowed(request);
  if (!allowed) {
    console.log(`[metadataSidecarSync] Outgoing sync for ${updates.length} conversations cancelled by user`);
    return { synced: 0, confirmed: false };
  }

  let imapConfig = options?.config;
  let email = "";
  const account = await getAccount(accountId);
  if (account && account.provider === "imap") {
    imapConfig = imapConfig ?? buildImapConfig(account);
    email = account.email;
  }

  if (!imapConfig || !email) {
    return { synced: 0, confirmed: true };
  }

  let count = 0;
  for (const update of updates) {
    try {
      const crdtRecord = await getThreadCrdtDoc(accountId, update.threadId, "personal");
      await pushSidecarMetadata(imapConfig, email, {
        conversationId: update.threadId,
        type: "personal",
        updatedAt: Date.now(),
        personalLabels: update.labels,
        crdtDocBase64: crdtRecord?.doc_base64,
      });
      count++;
    } catch (err) {
      console.warn(`[metadataSidecarSync] Failed to push labels for ${update.threadId}:`, err);
    }
  }

  return { synced: count, confirmed: true };
}
