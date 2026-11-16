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
import {
  deserializeMetadataDoc,
  mergeMetadataDocs,
  serializeMetadataDoc,
  reconcilePersonalMetadataToDb,
  type PersonalMetadataState,
} from "../crdt/metadataCrdt";

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
 * Pull and apply remote metadata changes from the IMAP sidecar folder.
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
        const payload: SidecarPayload = JSON.parse(rawText.trim());
        const conversationId = payload.conversationId || payload.targetId;
        if (!conversationId) continue;

        // Apply categories
        if (payload.categories && payload.categories.length > 0) {
          const category = payload.categories[0];
          if (category) {
            await setThreadCategory(accountId, conversationId, category, true);
          }
        }

        // Apply follow-up reminders
        if (payload.followUpAt) {
          await insertFollowUpReminder(accountId, conversationId, conversationId, payload.followUpAt);
        }

        // Apply CRDT document if present (personal scope)
        if (payload.crdtDocBase64) {
          const remoteDoc = deserializeMetadataDoc<PersonalMetadataState>(payload.crdtDocBase64);
          const existing = await getThreadCrdtDoc(accountId, conversationId, "personal");
          if (existing && existing.doc_base64) {
            const localDoc = deserializeMetadataDoc<PersonalMetadataState>(existing.doc_base64);
            const merged = mergeMetadataDocs(localDoc, remoteDoc);
            await upsertThreadCrdtDoc({
              account_id: accountId,
              thread_id: conversationId,
              scope: "personal",
              doc_base64: serializeMetadataDoc(merged),
            });
            await reconcilePersonalMetadataToDb(accountId, conversationId, merged);
          } else {
            await upsertThreadCrdtDoc({
              account_id: accountId,
              thread_id: conversationId,
              scope: "personal",
              doc_base64: payload.crdtDocBase64,
            });
            await reconcilePersonalMetadataToDb(accountId, conversationId, remoteDoc);
          }
        }

        appliedCount++;
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
