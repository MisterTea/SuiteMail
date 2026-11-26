import { GmailClient, type GmailMessage, type GmailThread } from "./client";
import { parseGmailMessage, type ParsedMessage } from "./messageParser";
import { upsertLabel } from "../db/labels";
import { deleteThread, upsertThread, setThreadLabels, getThreadLabelIds, getThreadById } from "../db/threads";
import { upsertMessage, getThreadMessageStates, setMessageFlags, deleteThreadMessagesExcept, getThreadsMissingBodies } from "../db/messages";
import { upsertAttachment } from "../db/attachments";
import { updateAccountSyncState } from "../db/accounts";
import { deleteEmbeddingsForMessages } from "../db/embeddings";
import { shouldNotifyForMessage, queueNewEmailNotification } from "../notifications/notificationManager";
import { applyFiltersToMessages, isEmailFiltered, markEmailFiltered } from "../filters/filterEngine";
import { getSetting, setSetting } from "../db/settings";
import { getMutedThreadIds } from "../db/threads";
import { getThreadCategory } from "../db/threadCategories";
import { getVipSenders } from "../db/notificationVips";
import { getPendingOpsForResource } from "../db/pendingOperations";

/** threads.list page size (Gmail's maximum). */
const LIST_PAGE_SIZE = 500;
/** Download bodies for mail newer than this first; older bodies follow at low priority or when opened. */
export const BODY_PREFETCH_DAYS = 30;

async function loadAutoArchiveCategories(): Promise<Set<string>> {
  const raw = await getSetting("auto_archive_categories");
  if (!raw) return new Set();
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

export interface SyncProgress {
  phase: "labels" | "threads" | "messages" | "done";
  current: number;
  total: number;
}

export type SyncProgressCallback = (progress: SyncProgress) => void;

/** "full" stores bodies and attachments; "metadata" stores headers and labels only (bodies follow later). */
type StoreMode = "full" | "metadata";

function parseForStorage(message: GmailMessage, mode: StoreMode): ParsedMessage {
  const parsed = parseGmailMessage(message);
  if (mode === "full") return parsed;
  // A metadata response has headers but no MIME parts; multipart/mixed is the usual sign of attachments.
  return { ...parsed, bodyHtml: null, bodyText: null, attachments: [], hasAttachments: message.payload?.mimeType === "multipart/mixed" };
}

/** Options for work that can stop early and resume on the next sync cycle. */
export interface BackfillLimits {
  /** Stop starting new requests after this time (ms since epoch). */
  deadline?: number;
  /** Stop early when this returns true (e.g. the user asked for a sync). */
  shouldStop?: () => boolean;
}

const shouldStop = (limits: BackfillLimits) =>
  (limits.deadline !== undefined && Date.now() >= limits.deadline) || Boolean(limits.shouldStop?.());

/**
 * Rule-based categorization for an inbox thread, plus auto-archive and delivery-schedule holds.
 * Returns the thread's labels after any auto-archive.
 */
async function categorizeInboxThread(
  accountId: string,
  threadId: string,
  labelIds: Set<string>,
  lastMessage: { fromAddress: string | null; listUnsubscribe?: string | null },
  client?: GmailClient,
  autoArchiveCategories?: Set<string>,
): Promise<Set<string>> {
  if (!labelIds.has("INBOX")) return labelIds;
  const { getThreadCategoryWithManual, setThreadCategory } = await import("@/services/db/threadCategories");
  const existing = await getThreadCategoryWithManual(accountId, threadId);
  // Skip if manually categorized
  if (existing && existing.isManual) return labelIds;
  const { categorizeByRules } = await import("@/services/categorization/ruleEngine");
  const category = categorizeByRules({
    labelIds: [...labelIds],
    fromAddress: lastMessage.fromAddress,
    listUnsubscribe: lastMessage.listUnsubscribe ?? null,
  });
  await setThreadCategory(accountId, threadId, category, false);

  // Auto-archive if category matches
  if (client && autoArchiveCategories && autoArchiveCategories.has(category) && category !== "Primary") {
    try {
      await client.modifyThread(threadId, undefined, ["INBOX"]);
      labelIds.delete("INBOX");
      await setThreadLabels(accountId, threadId, [...labelIds]);
    } catch (err) {
      console.error(`Failed to auto-archive thread ${threadId}:`, err);
    }
  }

  // Hold thread if delivery schedule is active for this category
  if (category !== "Primary") {
    try {
      const { getBundleRule, holdThread, getNextDeliveryTime } = await import("@/services/db/bundleRules");
      const rule = await getBundleRule(accountId, category);
      if (rule?.delivery_enabled && rule.delivery_schedule) {
        const schedule = JSON.parse(rule.delivery_schedule);
        const heldUntil = getNextDeliveryTime(schedule);
        await holdThread(accountId, threadId, category, heldUntil);
      }
    } catch (err) {
      console.error(`Failed to check bundle rule for thread ${threadId}:`, err);
    }
  }
  return labelIds;
}

async function storeMessages(accountId: string, parsedMessages: ParsedMessage[], mode: StoreMode): Promise<void> {
  await Promise.all(parsedMessages.map(async (parsed) => {
    await upsertMessage({
      id: parsed.id,
      accountId,
      threadId: parsed.threadId,
      fromAddress: parsed.fromAddress,
      fromName: parsed.fromName,
      toAddresses: parsed.toAddresses,
      ccAddresses: parsed.ccAddresses,
      bccAddresses: parsed.bccAddresses,
      replyTo: parsed.replyTo,
      subject: parsed.subject,
      snippet: parsed.snippet,
      date: parsed.date,
      isRead: parsed.isRead,
      isStarred: parsed.isStarred,
      bodyHtml: parsed.bodyHtml,
      bodyText: parsed.bodyText,
      rawSize: parsed.rawSize,
      internalDate: parsed.internalDate,
      listUnsubscribe: parsed.listUnsubscribe,
      listUnsubscribePost: parsed.listUnsubscribePost,
      authResults: parsed.authResults,
      bodyCached: mode === "full",
    });

    await Promise.all(parsed.attachments.map((att) =>
      upsertAttachment({
        id: `${parsed.id}_${att.gmailAttachmentId}`,
        messageId: parsed.id,
        accountId,
        filename: att.filename,
        mimeType: att.mimeType,
        size: att.size,
        gmailAttachmentId: att.gmailAttachmentId,
        contentId: att.contentId,
        isInline: att.isInline,
      }),
    ));
  }));
}

async function applyFiltersOnce(accountId: string, threadId: string, messages: ParsedMessage[]): Promise<void> {
  try {
    if (!(await isEmailFiltered(accountId, threadId))) {
      await applyFiltersToMessages(accountId, messages);
      await markEmailFiltered(accountId, threadId, true);
    }
  } catch (err) {
    console.error(`Failed to apply client-side filters to thread ${threadId}:`, err);
  }
}

/**
 * Store a whole fetched thread (messages, labels, attachments) into the local DB, replacing the local copy.
 * Optionally pass autoArchiveCategories and client to enable auto-archiving.
 */
async function processAndStoreThread(
  thread: { id: string },
  accountId: string,
  parsedMessages: ParsedMessage[],
  client?: GmailClient,
  autoArchiveCategories?: Set<string>,
  mode: StoreMode = "full",
): Promise<void> {
  const lastMessage = parsedMessages[parsedMessages.length - 1]!;
  const firstMessage = parsedMessages[0]!;

  const allLabelIds = new Set<string>();
  for (const msg of parsedMessages) {
    for (const lid of msg.labelIds) {
      allLabelIds.add(lid);
    }
  }

  await upsertThread({
    id: thread.id,
    accountId,
    subject: firstMessage.subject,
    snippet: lastMessage.snippet,
    lastMessageAt: lastMessage.date,
    messageCount: parsedMessages.length,
    isRead: parsedMessages.every((m) => m.isRead),
    isStarred: parsedMessages.some((m) => m.isStarred),
    isImportant: allLabelIds.has("IMPORTANT"),
    hasAttachments: parsedMessages.some((m) => m.hasAttachments),
  });

  await setThreadLabels(accountId, thread.id, [...allLabelIds]);
  await categorizeInboxThread(accountId, thread.id, allLabelIds, lastMessage, client, autoArchiveCategories);
  await storeMessages(accountId, parsedMessages, mode);
  // The server copy is authoritative: drop local messages that were deleted remotely.
  await deleteThreadMessagesExcept(accountId, thread.id, parsedMessages.map((m) => m.id));

  // Client-side filters may match on bodies, so they wait until the full message is stored.
  if (mode === "full") await applyFiltersOnce(accountId, thread.id, parsedMessages);
}

/**
 * Sync all labels for an account.
 */
export async function syncLabels(
  client: GmailClient,
  accountId: string,
): Promise<void> {
  const response = await client.listLabels();
  await Promise.all(response.labels.map((label) =>
    upsertLabel({
      id: label.id,
      accountId,
      name: label.name,
      type: label.type,
      colorBg: label.color?.backgroundColor ?? null,
      colorFg: label.color?.textColor ?? null,
    }),
  ));
}

/**
 * Perform an initial sync of the last N days: list threads 500 at a time (newest first) and store their
 * headers and labels via batched format=metadata requests. Bodies are downloaded later by backfillBodies
 * or when a thread is opened. Stops early (keeping its checkpoint) at `deadline` or after `maxThreads`.
 */
export async function initialSync(
  client: GmailClient,
  accountId: string,
  daysBack = 365,
  onProgress?: SyncProgressCallback,
  options: BackfillLimits & { maxThreads?: number; onMessagesStored?: (count: number) => void } = {},
): Promise<void> {
  let downloaded = 0;
  const maxThreads = options.maxThreads ?? Infinity;
  const key = `gmail_initial_sync:${accountId}`;
  type Checkpoint = {version:1; daysBack:number; query:string; historyId:string; pageToken?:string; completed:number; total:number; storedIds:string[]};
  let checkpoint: Checkpoint | undefined;
  try {
    const raw = await getSetting(key);
    const saved = raw ? JSON.parse(raw) as Checkpoint : undefined;
    if (saved?.version === 1 && saved.daysBack === daysBack && typeof saved.historyId === "string" && saved.historyId && typeof saved.query === "string" && Number.isFinite(saved.completed) && Array.isArray(saved.storedIds)) checkpoint = saved;
  } catch { /* Invalid/old checkpoints start a fresh listing. */ }
  if (!checkpoint) {
    const afterDate = new Date();
    afterDate.setDate(afterDate.getDate() - daysBack);
    const afterStr = `${afterDate.getFullYear()}/${afterDate.getMonth()+1}/${afterDate.getDate()}`;
    // Use a pre-sync cursor: changes during a long initial download must be replayed by delta sync.
    const profile = await client.getProfile();
    checkpoint = {version:1, daysBack, query:`after:${afterStr}`, historyId:profile.historyId, completed:0, total:0, storedIds:[]};
  }
  const save = () => setSetting(key, JSON.stringify(checkpoint), {skipNotify:true});
  await save();
  onProgress?.({phase:"labels",current:0,total:1});
  await syncLabels(client, accountId);
  const autoArchiveCategories = await loadAutoArchiveCategories();
  while (true) {
    if (shouldStop(options) || downloaded >= maxThreads) return;
    const response = await client.listThreads({maxResults:LIST_PAGE_SIZE,pageToken:checkpoint.pageToken,q:checkpoint.query});
    const stubs = response.threads || [];
    checkpoint.total = Math.max(checkpoint.total, checkpoint.completed+stubs.length, response.resultSizeEstimate || 0);
    onProgress?.({phase:"messages",current:checkpoint.completed,total:checkpoint.total});
    const stored = new Set(checkpoint.storedIds);
    const remaining = stubs.filter((stub) => !stored.has(stub.id));
    // The client splits these into batch requests that each fit the quota burst (~25 metadata threads).
    const chunkSize = 25;
    for (let start = 0; start < remaining.length; ) {
      if (shouldStop(options) || downloaded >= maxThreads) return;
      const chunk = remaining.slice(start, start + Math.min(chunkSize, maxThreads - downloaded));
      start += chunk.length;
      // A thread deleted after listing comes back as null and is skipped; any other failure keeps the checkpoint.
      const threads = await client.getThreads(chunk.map((stub) => stub.id), "metadata");
      let storedCount = 0;
      for (const stub of chunk) {
        const thread = threads.get(stub.id);
        if (thread?.messages?.length) {
          await processAndStoreThread(thread,accountId,thread.messages.map((m) => parseForStorage(m,"metadata")),client,autoArchiveCategories,"metadata");
          storedCount += thread.messages.length;
        }
        checkpoint.storedIds.push(stub.id);
        downloaded++;
        checkpoint.completed++;
      }
      await save();
      onProgress?.({phase:"messages",current:checkpoint.completed,total:checkpoint.total});
      if (storedCount > 0) {
        options.onMessagesStored?.(storedCount);
        window.dispatchEvent(new Event("suitemail-sync-progress"));
      }
    }
    if (!response.nextPageToken) break;
    checkpoint.pageToken = response.nextPageToken;
    checkpoint.storedIds = [];
    await save();
  }
  await updateAccountSyncState(accountId,checkpoint.historyId);
  await setSetting(key,"",{skipNotify:true});
  onProgress?.({
    phase: "done",
    current: checkpoint.completed,
    total: checkpoint.completed,
  });
}

/**
 * Download full bodies for threads whose messages were stored from metadata. Returns the number of
 * threads updated. Used by the background body backfill and when a thread is opened.
 */
export async function storeThreadBodies(client: GmailClient, accountId: string, threadIds: string[]): Promise<number> {
  if (!threadIds.length) return 0;
  const autoArchiveCategories = await loadAutoArchiveCategories();
  const threads = await client.getThreads(threadIds, "full");
  let updated = 0;
  for (const threadId of threadIds) {
    const thread = threads.get(threadId);
    if (!thread?.messages?.length) {
      // Deleted on the server since it was listed.
      await deleteThread(accountId, threadId);
      continue;
    }
    const before = await getThreadMessageStates(accountId, threadId);
    const parsed = thread.messages.map((m) => parseForStorage(m, "full"));
    if ((await getPendingOpsForResource(accountId, threadId)).length > 0) {
      // Keep queued local label edits: only fill in the bodies.
      await storeMessages(accountId, parsed, "full");
    } else {
      await processAndStoreThread(thread, accountId, parsed, client, autoArchiveCategories, "full");
    }
    // Embeddings built from the snippet alone are rebuilt from the full body.
    await deleteEmbeddingsForMessages(accountId, before.filter((m) => !m.body_cached).map((m) => m.id)).catch(() => {});
    updated++;
  }
  if (updated) window.dispatchEvent(new Event("suitemail-sync-progress"));
  return updated;
}

/**
 * Low-priority body download for metadata-only messages, newest first, until `deadline`.
 * `sinceMs` limits it to recent mail (the first pass covers the last BODY_PREFETCH_DAYS days).
 */
export async function backfillBodies(
  client: GmailClient,
  accountId: string,
  options: BackfillLimits & { sinceMs?: number } = {},
): Promise<number> {
  let total = 0;
  let previous = "";
  while (!shouldStop(options)) {
    // ~8 full threads fit in one quota burst, so each pass is a single batch request.
    const threadIds = await getThreadsMissingBodies(accountId, 8, options.sinceMs ?? 0);
    const key = threadIds.join(",");
    if (!threadIds.length || key === previous) break; // No progress possible this cycle.
    previous = key;
    total += await storeThreadBodies(client, accountId, threadIds);
  }
  return total;
}

interface MessageChange {
  threadId: string;
  added: boolean;
  deleted: boolean;
  labelsAdded: Set<string>;
  labelsRemoved: Set<string>;
}

/** Labels recomputed from per-message flags rather than tracked at thread level. */
const FLAG_LABELS = new Set(["UNREAD", "STARRED"]);

interface ThreadPlan {
  threadId: string;
  changes: [string, MessageChange][];
  /** "full": re-download the whole thread. "incremental": fetch only new messages and apply the rest locally. */
  mode: "full" | "incremental";
  addedIds: string[];
  deletedIds: string[];
  /** Fetch format=minimal to recompute labels the history alone can't settle. */
  needLabels: boolean;
  localIds: Set<string>;
}

/**
 * Delta sync: fetch only changes since last sync using history API.
 *
 * Label changes are applied locally from the history records, new messages are fetched with
 * messages.get (batched), and a thread is only re-downloaded when the history can't describe it
 * (a reply to a thread that isn't stored locally, or a label change on an unknown thread).
 */
export async function deltaSync(
  client: GmailClient,
  accountId: string,
  lastHistoryId: string,
  persistHistory: typeof updateAccountSyncState = updateAccountSyncState,
  onMessagesStored?: (count: number) => void,
): Promise<void> {
  try {
    // Paginate through all history pages
    const changes = new Map<string, MessageChange>();
    const newInboxMessageIds = new Set<string>();
    let latestHistoryId = lastHistoryId;
    let pageToken: string | undefined;
    const change = (message: { id: string; threadId: string }): MessageChange => {
      let entry = changes.get(message.id);
      if (!entry) {
        entry = { threadId: message.threadId, added: false, deleted: false, labelsAdded: new Set(), labelsRemoved: new Set() };
        changes.set(message.id, entry);
      }
      return entry;
    };

    do {
      const response = await client.getHistory(lastHistoryId, undefined, pageToken);
      latestHistoryId = response.historyId;
      for (const item of response.history ?? []) {
        for (const { message } of item.messagesAdded ?? []) {
          const entry = change(message);
          entry.added = true;
          entry.deleted = false;
          // Track new unread inbox messages for notifications
          const labels = message.labelIds ?? [];
          if (labels.includes("INBOX") && labels.includes("UNREAD")) newInboxMessageIds.add(message.id);
        }
        for (const { message } of item.messagesDeleted ?? []) change(message).deleted = true;
        for (const { message, labelIds } of item.labelsAdded ?? []) {
          const entry = change(message);
          for (const label of labelIds ?? []) { entry.labelsAdded.add(label); entry.labelsRemoved.delete(label); }
        }
        for (const { message, labelIds } of item.labelsRemoved ?? []) {
          const entry = change(message);
          for (const label of labelIds ?? []) { entry.labelsRemoved.add(label); entry.labelsAdded.delete(label); }
        }
      }
      pageToken = response.nextPageToken;
    } while (pageToken);

    const byThread = new Map<string, [string, MessageChange][]>();
    for (const [messageId, entry] of changes) {
      const list = byThread.get(entry.threadId) ?? [];
      list.push([messageId, entry]);
      byThread.set(entry.threadId, list);
    }

    if (byThread.size === 0) {
      await persistHistory(accountId, latestHistoryId);
      return;
    }

    // Load settings once for the whole sync cycle
    const autoArchiveCategories = await loadAutoArchiveCategories();
    const mutedThreadIds = await getMutedThreadIds(accountId);
    const smartNotifications = (await getSetting("smart_notifications")) !== "false";
    const notifyCategories = new Set(
      ((await getSetting("notify_categories")) ?? "Primary").split(",").map((s) => s.trim()).filter(Boolean),
    );
    const vipSenders = smartNotifications ? await getVipSenders(accountId) : new Set<string>();

    // 1. Plan each affected thread from local state (newest activity first).
    const plans: ThreadPlan[] = [];
    for (const [threadId, threadChanges] of [...byThread].reverse()) {
      // Skip metadata overwrite for threads with pending local changes
      const pendingOps = await getPendingOpsForResource(accountId, threadId);
      if (pendingOps.length > 0) {
        console.log(`[deltaSync] Skipping thread ${threadId}: has ${pendingOps.length} pending local ops`);
        continue;
      }
      const local = await getThreadMessageStates(accountId, threadId);
      const localIds = new Set(local.map((m) => m.id));
      const addedIds = threadChanges.filter(([, c]) => c.added && !c.deleted).map(([id]) => id);
      const deletedIds = threadChanges.filter(([, c]) => c.deleted).map(([id]) => id);
      const remainingLocal = [...localIds].filter((id) => !deletedIds.includes(id) && !addedIds.includes(id));
      let mode: ThreadPlan["mode"] = "incremental";
      if (!local.length && !addedIds.length) {
        if (!threadChanges.some(([, c]) => c.labelsAdded.size || c.labelsRemoved.size)) continue; // Deleted and never stored.
        mode = "full"; // A label change on a thread we don't have: download it, as before.
      } else if (addedIds.length && !localIds.has(threadId) && !addedIds.includes(threadId)) {
        // Gmail's thread ID is its first message's ID: without it, older messages are missing locally.
        mode = "full";
      }
      // Removing a label from some messages only clears it from the thread when no other message keeps it.
      // Without per-message labels locally, check that every remaining local message lost it too.
      const removed = new Set(threadChanges.flatMap(([, c]) => [...c.labelsRemoved]).filter((l) => !FLAG_LABELS.has(l)));
      const ambiguousRemoval = [...removed].some((label) => remainingLocal.some((id) => !changes.get(id)?.labelsRemoved.has(label)));
      const needLabels = mode === "incremental" && remainingLocal.length > 0 && (deletedIds.some((id) => localIds.has(id)) || ambiguousRemoval);
      plans.push({ threadId, changes: threadChanges, mode, addedIds, deletedIds, needLabels, localIds });
    }

    // 2. Fetch everything the plans need with as few batch requests as possible.
    const fullIds = plans.filter((p) => p.mode === "full").map((p) => p.threadId);
    const messageIds = plans.filter((p) => p.mode === "incremental").flatMap((p) => p.addedIds);
    const labelIds = plans.filter((p) => p.needLabels).map((p) => p.threadId);
    const fetchedThreads = fullIds.length ? await client.getThreads(fullIds, "full") : new Map<string, GmailThread | null>();
    const fetchedMessages = messageIds.length ? await client.getMessages(messageIds, "full") : new Map<string, GmailMessage | null>();
    const labelThreads = labelIds.length ? await client.getThreads(labelIds, "minimal") : new Map<string, GmailThread | null>();

    // Threads whose minimal listing revealed messages we don't have: download them whole.
    const anomalies: string[] = [];
    for (const plan of plans) {
      const minimal = labelThreads.get(plan.threadId);
      if (!minimal?.messages) continue;
      const known = new Set([...plan.localIds, ...plan.addedIds]);
      if (minimal.messages.some((m) => !known.has(m.id))) anomalies.push(plan.threadId);
    }
    if (anomalies.length) {
      for (const [id, thread] of await client.getThreads(anomalies, "full")) fetchedThreads.set(id, thread);
      for (const plan of plans) if (anomalies.includes(plan.threadId)) { plan.mode = "full"; plan.needLabels = false; }
    }

    // 3. Apply.
    for (const plan of plans) {
      const { threadId } = plan;
      try {
        let parsedMessages: ParsedMessage[];
        let newMessages: ParsedMessage[];
        if (plan.mode === "full") {
          const thread = fetchedThreads.get(threadId);
          // History can reference a thread that has since been permanently deleted.
          if (!thread) { await deleteThread(accountId, threadId); continue; }
          if (!thread.messages || thread.messages.length === 0) continue;
          parsedMessages = thread.messages.map((m) => parseForStorage(m, "full"));
          await processAndStoreThread(thread, accountId, parsedMessages, client, autoArchiveCategories);
          newMessages = parsedMessages.filter((m) => newInboxMessageIds.has(m.id));
          const added = parsedMessages.filter((m) => plan.addedIds.includes(m.id)).length;
          if (added > 0) onMessagesStored?.(added);
        } else {
          const result = await applyIncrementalThread(accountId, plan, fetchedMessages, labelThreads.get(plan.threadId), client, autoArchiveCategories);
          if (!result) continue;
          parsedMessages = result.fetched;
          newMessages = parsedMessages.filter((m) => newInboxMessageIds.has(m.id));
          if (parsedMessages.length > 0) onMessagesStored?.(parsedMessages.length);
        }
        window.dispatchEvent(new Event("suitemail-sync-progress"));

        // Auto-archive muted threads that reappear in INBOX
        if (mutedThreadIds.has(threadId)) {
          const labels = new Set(await getThreadLabelIds(accountId, threadId));
          if (labels.has("INBOX")) {
            try {
              await client.modifyThread(threadId, undefined, ["INBOX"]);
              labels.delete("INBOX");
              await setThreadLabels(accountId, threadId, [...labels]);
            } catch (err) {
              console.error(`Failed to auto-archive muted thread ${threadId}:`, err);
            }
          }
        }

        // Send desktop notifications for new unread inbox messages (smart-filtered)
        // Skip notifications for muted threads
        for (const parsed of newMessages) {
          if (mutedThreadIds.has(threadId)) continue;
          const fromAddr = parsed.fromAddress ?? undefined;
          if (shouldNotifyForMessage(smartNotifications, notifyCategories, vipSenders, await getThreadCategory(accountId, threadId), fromAddr)) {
            const sender = parsed.fromName ?? parsed.fromAddress ?? "Unknown";
            queueNewEmailNotification(
              sender,
              parsed.subject ?? "",
              parsed.threadId,
              accountId,
              fromAddr,
              parsed.snippet,
              parsed.date,
            );
          }
        }

        // Apply filters to new inbox messages in this thread
        if (newMessages.length > 0) {
          await applyFiltersOnce(accountId, threadId, newMessages);

          // Apply smart labels (fire-and-forget, non-blocking)
          import("@/services/smartLabels/smartLabelManager")
            .then(({ applySmartLabelsToMessages }) => applySmartLabelsToMessages(accountId, newMessages))
            .catch((err) => console.error("Smart label error:", err));
        }
      } catch (err) {
        console.error(`Failed to re-sync thread ${threadId}:`, err);
        throw err; // Never advance history past a failed download.
      }
    }

    await persistHistory(accountId, latestHistoryId);

    // Fire-and-forget AI categorization for new threads
    import("@/services/ai/categorizationManager")
      .then(({ categorizeNewThreads }) => categorizeNewThreads(accountId))
      .catch((err) => console.error("Categorization error:", err));

    // Fire-and-forget vector embedding for new messages
    import("@/services/ai/embeddingIndexer")
      .then(({ indexBatchForAccount }) => indexBatchForAccount(accountId, 50))
      .catch((err) => console.error("Embedding indexing error:", err));
  } catch (err) {
    // historyId might be too old — need full re-sync
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("404") || message.includes("historyId")) {
      console.warn("History ID expired, triggering full re-sync");
      throw new Error("HISTORY_EXPIRED");
    }
    throw err;
  }
}

/**
 * Update a locally stored thread from history: store fetched new messages, drop deleted ones, apply
 * label changes, and recompute the thread row. Returns the newly stored messages, or null if the thread
 * no longer exists.
 */
async function applyIncrementalThread(
  accountId: string,
  plan: ThreadPlan,
  fetchedMessages: Map<string, GmailMessage | null>,
  minimal: GmailThread | null | undefined,
  client: GmailClient,
  autoArchiveCategories: Set<string>,
): Promise<{ fetched: ParsedMessage[] } | null> {
  const { threadId } = plan;
  if (plan.needLabels && minimal === null) {
    await deleteThread(accountId, threadId);
    return null;
  }
  const fetched = plan.addedIds
    .map((id) => fetchedMessages.get(id))
    .filter((m): m is GmailMessage => Boolean(m))
    .map((m) => parseForStorage(m, "full"));
  const previousLabels = new Set(await getThreadLabelIds(accountId, threadId));
  const existing = await getThreadById(accountId, threadId);

  // Messages that disappeared: deleted in history, or 404 when fetched.
  const gone = new Set([...plan.deletedIds, ...plan.addedIds.filter((id) => fetchedMessages.get(id) === null)]);
  if (minimal?.messages) for (const id of plan.localIds) if (!minimal.messages.some((m) => m.id === id)) gone.add(id);
  const keep = [...plan.localIds, ...fetched.map((m) => m.id)].filter((id) => !gone.has(id));
  if (gone.size) await deleteThreadMessagesExcept(accountId, threadId, keep);
  if (!existing && fetched.length) {
    // A new conversation: messages reference the thread row, so create it first (finalized below).
    const first = fetched[0]!;
    await upsertThread({ id: threadId, accountId, subject: first.subject, snippet: first.snippet, lastMessageAt: first.date, messageCount: fetched.length, isRead: first.isRead, isStarred: first.isStarred, isImportant: false, hasAttachments: false });
  }
  await storeMessages(accountId, fetched, "full");

  let labels: Set<string>;
  if (minimal?.messages) {
    // Authoritative per-message labels from format=minimal.
    labels = new Set(minimal.messages.flatMap((m) => m.labelIds ?? []));
    for (const message of minimal.messages) {
      const ids = message.labelIds ?? [];
      await setMessageFlags(accountId, message.id, { isRead: !ids.includes("UNREAD"), isStarred: ids.includes("STARRED") });
    }
  } else {
    labels = new Set([...previousLabels].filter((l) => !FLAG_LABELS.has(l)));
    const remainingLocal = [...plan.localIds].filter((id) => !gone.has(id) && !plan.addedIds.includes(id));
    // Removed from every remaining local message (checked in the plan), and not on a fetched message.
    const removed = new Set(plan.changes.flatMap(([, c]) => [...c.labelsRemoved]));
    for (const label of removed) {
      if (remainingLocal.every((id) => plan.changes.some(([mid, c]) => mid === id && c.labelsRemoved.has(label)))) labels.delete(label);
    }
    for (const [messageId, c] of plan.changes) {
      if (gone.has(messageId) || !plan.localIds.has(messageId)) continue;
      for (const label of c.labelsAdded) labels.add(label);
      const isRead = c.labelsAdded.has("UNREAD") ? false : c.labelsRemoved.has("UNREAD") ? true : undefined;
      const isStarred = c.labelsAdded.has("STARRED") ? true : c.labelsRemoved.has("STARRED") ? false : undefined;
      if (isRead !== undefined || isStarred !== undefined) await setMessageFlags(accountId, messageId, { isRead, isStarred });
    }
    for (const message of fetched) for (const label of message.labelIds) labels.add(label);
  }

  const states = await getThreadMessageStates(accountId, threadId);
  if (!states.length) {
    await deleteThread(accountId, threadId);
    return null;
  }
  const isRead = states.every((m) => m.is_read);
  const isStarred = states.some((m) => m.is_starred);
  for (const label of FLAG_LABELS) labels.delete(label);
  if (!isRead) labels.add("UNREAD");
  if (isStarred) labels.add("STARRED");
  const first = states[0]!;
  const last = states[states.length - 1]!;
  await upsertThread({
    id: threadId,
    accountId,
    subject: first.subject,
    snippet: last.snippet,
    lastMessageAt: last.date,
    messageCount: states.length,
    isRead,
    isStarred,
    isImportant: labels.has("IMPORTANT"),
    hasAttachments: fetched.some((m) => m.hasAttachments) || Boolean(existing?.has_attachments),
  });
  await setThreadLabels(accountId, threadId, [...labels]);

  // New mail, or a thread returning to the inbox, gets (re)categorized like a fresh download.
  if (labels.has("INBOX") && (fetched.length > 0 || !previousLabels.has("INBOX"))) {
    const newest = fetched[fetched.length - 1];
    const lastFrom = newest ?? { fromAddress: existing?.from_address ?? null, listUnsubscribe: null };
    await categorizeInboxThread(accountId, threadId, labels, lastFrom, client, autoArchiveCategories);
  }
  // Same rule as a whole-thread download: client-side filters run once per thread, on its first messages.
  if (fetched.length > 0) await applyFiltersOnce(accountId, threadId, fetched);
  return { fetched };
}


/** Poll new mail during backfill without claiming the historical download is complete. */
export async function syncInitialChanges(
  client: GmailClient,
  accountId: string,
  onMessagesStored?: (count: number) => void,
): Promise<void> {
  const key = `gmail_initial_sync:${accountId}`;
  const raw = await getSetting(key);
  if (!raw) return;
  let state: {historyId?: string};
  try { state = JSON.parse(raw); } catch { return; }
  if (!state.historyId) return;
  try {
    await deltaSync(client, accountId, state.historyId, async (_id, historyId) => {
      // The backfill runs after this poll, so the checkpoint cursor cannot be overwritten by a concurrent save.
      await setSetting(key, JSON.stringify({...state,historyId}), {skipNotify:true});
    }, onMessagesStored);
  } catch (error) {
    if (error instanceof Error && error.message === "HISTORY_EXPIRED") {
      // Start a fresh listing from newest mail; keep all previously downloaded data.
      await setSetting(key,"",{skipNotify:true});
      return;
    }
    throw error;
  }
}


/** Import a background download through the same parser, storage, categorization, and rules as foreground sync. */
export async function storeBackgroundGmailThread(accountId: string, thread: import("./client").GmailThread & { partial?: boolean }): Promise<void> {
  if (!thread.messages?.length) return;
  // Android downloads a brand-new conversation as its single root message (messages.get, half the quota of
  // threads.get). If the app already has the thread, it already has that root message and possibly later
  // replies, so a partial copy must not replace it.
  if (thread.partial && (await getThreadMessageStates(accountId, thread.id)).length > 0) return;
  await processAndStoreThread(thread,accountId,thread.messages.map(parseGmailMessage));
}
