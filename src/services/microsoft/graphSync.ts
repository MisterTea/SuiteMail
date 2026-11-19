import { getAccount, clearAccountHistoryId, updateAccountSyncState } from "../db/accounts";
import { getDb } from "../db/connection";
import { upsertLabel, getLabelsForAccount } from "../db/labels";
import { deleteMessage, getMessagesForThread, upsertMessage } from "../db/messages";
import { deleteThread, getThreadById, getThreadLabelIds, setThreadLabels, upsertThread } from "../db/threads";
import { upsertAttachment } from "../db/attachments";
import { getPendingOpsForResource } from "../db/pendingOperations";
import { getSetting } from "../db/settings";
import { addEmail } from "../filters/filterEngine";
import { ensureFreshToken } from "../oauth/oauthTokenManager";
import {
  isDeltaExpired,
  msgraphListFolders,
  msgraphSyncPage,
  type GraphSyncPage,
} from "./graphCommands";
import {
  graphMessageToStored,
  labelIdForFolder,
  mapGraphFolder,
  receivedAfterIso,
  type GraphStoredMessage,
} from "./graphModel";

async function freshToken(accountId: string): Promise<string> {
  const account = await getAccount(accountId);
  if (!account) throw new Error("Account not found");
  return ensureFreshToken(account);
}

export async function syncGraphFolders(accountId: string): Promise<Map<string, string>> {
  const token = await freshToken(accountId);
  const folders = await msgraphListFolders(token);
  const folderLabelByGraphId = new Map<string, string>();
  for (const folder of folders) {
    const mapped = mapGraphFolder(folder);
    folderLabelByGraphId.set(folder.id, mapped.labelId);
    if (mapped.labelId === "UNREAD" || mapped.labelId === "STARRED") continue;
    await upsertLabel({
      id: mapped.labelId,
      accountId,
      name: mapped.name,
      type: mapped.type,
      imapFolderPath: folder.id,
      imapSpecialUse: mapped.specialUse,
    });
  }
  return folderLabelByGraphId;
}

async function findMessageThread(accountId: string, messageId: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ thread_id: string }[]>(
    "SELECT thread_id FROM messages WHERE account_id = $1 AND id = $2 LIMIT 1",
    [accountId, messageId],
  );
  return rows[0]?.thread_id ?? null;
}

async function rememberRemoved(
  accountId: string,
  messageId: string,
  folderLabelByGraphId: Map<string, string>,
): Promise<void> {
  const threadId = await findMessageThread(accountId, messageId);
  if (!threadId) return;
  await deleteMessage(accountId, messageId);
  await recomputeThread(accountId, threadId, folderLabelByGraphId, false, false);
}

async function recomputeThread(
  accountId: string,
  threadId: string,
  folderLabelByGraphId: Map<string, string>,
  incomingImportant: boolean,
  incomingAttachments: boolean,
  incomingFocused?: boolean,
): Promise<void> {
  const messages = await getMessagesForThread(accountId, threadId);
  if (messages.length === 0) {
    await deleteThread(accountId, threadId);
    return;
  }
  const latest = messages[messages.length - 1];
  if (!latest) return;
  const labels = new Set<string>();
  for (const message of messages) {
    const label = labelIdForFolder(message.imap_folder, folderLabelByGraphId);
    if (label) labels.add(label);
  }
  const existingLabels = await getThreadLabelIds(accountId, threadId);
  const allFolderLabels = new Set(folderLabelByGraphId.values());
  for (const el of existingLabels) {
    if (!allFolderLabels.has(el) && el !== "FOCUSED") {
      labels.add(el);
    }
  }

  if (incomingFocused === true) {
    labels.add("FOCUSED");
  } else if (incomingFocused === false) {
    labels.delete("FOCUSED");
  } else if (existingLabels.includes("FOCUSED")) {
    labels.add("FOCUSED");
  }

  const existing = await getThreadById(accountId, threadId);
  await upsertThread({
    id: threadId,
    accountId,
    subject: latest.subject,
    snippet: latest.snippet,
    lastMessageAt: latest.date,
    messageCount: messages.length,
    isRead: messages.every((message) => message.is_read === 1),
    isStarred: messages.some((message) => message.is_starred === 1),
    isImportant: incomingImportant || existing?.is_important === 1,
    hasAttachments: incomingAttachments || existing?.has_attachments === 1,
    isFiltered: true,
  });
  await setThreadLabels(accountId, threadId, [...labels]);
}

export async function storeGraphPage(
  accountId: string,
  page: GraphSyncPage,
  folderLabelByGraphId: Map<string, string>,
): Promise<number> {
  const addedIds = new Set(page.messages.map((message) => message.id));
  for (const removedId of page.removedIds) {
    if (addedIds.has(removedId)) continue;
    await rememberRemoved(accountId, removedId, folderLabelByGraphId);
  }

  const groups = new Map<string, GraphStoredMessage[]>();
  for (const message of page.messages) {
    const stored = graphMessageToStored(message);
    const label = labelIdForFolder(stored.parentFolderId, folderLabelByGraphId);
    stored.parsed.labelIds = label ? [label] : [];
    if (stored.isDraft && !stored.parsed.labelIds.includes("DRAFT")) {
      stored.parsed.labelIds.push("DRAFT");
    }
    if (stored.isFocused && !stored.parsed.labelIds.includes("FOCUSED")) {
      stored.parsed.labelIds.push("FOCUSED");
    }
    const list = groups.get(stored.parsed.threadId) ?? [];
    list.push(stored);
    groups.set(stored.parsed.threadId, list);
  }

  let storedCount = 0;
  for (const [threadId, storedMessages] of groups) {
    const pending = await getPendingOpsForResource(accountId, threadId);
    if (pending.length > 0) continue;

    const first = storedMessages[0]?.parsed;
    await upsertThread({
      id: threadId,
      accountId,
      subject: first?.subject ?? null,
      snippet: first?.snippet ?? null,
      lastMessageAt: first?.date ?? null,
      messageCount: storedMessages.length,
      isRead: storedMessages.every((message) => message.parsed.isRead),
      isStarred: storedMessages.some((message) => message.parsed.isStarred),
      isImportant: storedMessages.some((message) => message.isImportant),
      hasAttachments: storedMessages.some((message) => message.parsed.hasAttachments),
      isFiltered: true,
    });

    for (const stored of storedMessages) {
      await upsertMessage({
        id: stored.parsed.id,
        accountId,
        threadId,
        fromAddress: stored.parsed.fromAddress,
        fromName: stored.parsed.fromName,
        toAddresses: stored.parsed.toAddresses,
        ccAddresses: stored.parsed.ccAddresses,
        bccAddresses: stored.parsed.bccAddresses,
        replyTo: stored.parsed.replyTo,
        subject: stored.parsed.subject,
        snippet: stored.parsed.snippet,
        date: stored.parsed.date,
        isRead: stored.parsed.isRead,
        isStarred: stored.parsed.isStarred,
        bodyHtml: stored.parsed.bodyHtml,
        bodyText: stored.parsed.bodyText,
        rawSize: stored.parsed.rawSize,
        internalDate: stored.parsed.internalDate,
        listUnsubscribe: stored.parsed.listUnsubscribe,
        listUnsubscribePost: stored.parsed.listUnsubscribePost,
        messageIdHeader: stored.messageIdHeader,
        referencesHeader: stored.referencesHeader,
        inReplyToHeader: stored.inReplyTo,
        imapFolder: stored.parentFolderId,
      });
      for (const attachment of stored.parsed.attachments) {
        await upsertAttachment({
          id: `${stored.parsed.id}:${attachment.gmailAttachmentId}`,
          messageId: stored.parsed.id,
          accountId,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          size: attachment.size,
          gmailAttachmentId: attachment.gmailAttachmentId,
          contentId: attachment.contentId,
          isInline: attachment.isInline,
        });
      }
      storedCount += 1;
    }

    await recomputeThread(
      accountId,
      threadId,
      folderLabelByGraphId,
      storedMessages.some((message) => message.isImportant),
      storedMessages.some((message) => message.parsed.hasAttachments),
      storedMessages.some((message) => message.isFocused),
    );
    await addEmail(
      accountId,
      threadId,
      storedMessages.map((message) => message.parsed),
      undefined,
      { skipSidecarPush: true },
    );
  }
  return storedCount;
}

async function followPages(
  accountId: string,
  startLink: string | null,
  receivedAfter: string | null,
  onProgress?: (phase: string, current: number, total: number) => void,
): Promise<string | null> {
  let link = startLink;
  let deltaLink: string | null = null;
  let count = 0;
  const folderLabelByGraphId = await syncGraphFolders(accountId);
  onProgress?.("messages", 0, 0);

  for (let pageNumber = 0; pageNumber < 500; pageNumber += 1) {
    const token = await freshToken(accountId);
    const page = await msgraphSyncPage(token, link, link ? null : receivedAfter, 40);
    count += await storeGraphPage(accountId, page, folderLabelByGraphId);
    onProgress?.("messages", count, 0);
    if (page.deltaLink) {
      deltaLink = page.deltaLink;
      await updateAccountSyncState(accountId, page.deltaLink);
      break;
    }
    if (!page.nextLink) break;
    link = page.nextLink;
    // A year of mail can take more than one pass. The next link resumes it.
    await updateAccountSyncState(accountId, link);
  }

  return deltaLink;
}

export async function syncGraphAccount(
  accountId: string,
  onProgress?: (phase: string, current: number, total: number) => void,
  daysBack?: number,
): Promise<void> {
  const account = await getAccount(accountId);
  if (!account) throw new Error("Account not found");

  const syncPeriod = daysBack ?? (parseInt((await getSetting("sync_period_days")) ?? "365", 10) || 365);
  onProgress?.("folders", 0, 0);

  const runInitial = () => followPages(accountId, null, receivedAfterIso(syncPeriod), onProgress);

  if (!account.history_id) {
    await runInitial();
    onProgress?.("done", 0, 0);
    return;
  }

  try {
    await followPages(accountId, account.history_id, null, onProgress);
  } catch (err) {
    if (!isDeltaExpired(err)) throw err;
    await clearAccountHistoryId(accountId);
    await runInitial();
  }
  onProgress?.("done", 0, 0);
}

export async function graphFolderIdForLabel(
  accountId: string,
  labelId: string,
): Promise<string | null> {
  const labels = await getLabelsForAccount(accountId);
  return labels.find((label) => label.id === labelId)?.imap_folder_path ?? null;
}

