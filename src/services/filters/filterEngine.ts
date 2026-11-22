import type { FilterCriteria, FilterActions } from "../db/filters";
import { getEnabledFiltersForAccount } from "../db/filters";
import type { ParsedMessage } from "../gmail/messageParser";
import { addThreadLabel, removeThreadLabel, markThreadRead, starThread } from "../emailActions";
import { isEmailFiltered, markEmailFiltered } from "../crdt/metadataCrdt";
import {
  ensureMetadataDownloadedForEmail,
  pushSidecarMetadata,
} from "../imap/metadataSidecarSync";
import { buildImapConfig } from "../imap/imapConfigBuilder";
import type { ImapConfig } from "../imap/electronCommands";
import { getAccount } from "../db/accounts";
import { getThreadCrdtDoc } from "../db/threadCrdtDocs";
import { getDb } from "../db/connection";
import { getLabelsForAccount } from "../db/labels";
import { getMessagesForThread } from "../db/messages";
import { getPendingOpsForResource } from "../db/pendingOperations";
import { syncFilterSettings } from "../imap/settingsSidecarSync";

export { isEmailFiltered, markEmailFiltered };

/**
 * Check if a parsed message matches the given filter criteria.
 * All set criteria must match (AND logic). Matching is case-insensitive substring.
 */
export function messageMatchesFilter(
  message: ParsedMessage,
  criteria: FilterCriteria,
): boolean {
  if (criteria.from) {
    const fromStr = `${message.fromName ?? ""} ${message.fromAddress ?? ""}`.toLowerCase();
    if (!fromStr.includes(criteria.from.toLowerCase())) return false;
  }

  if (criteria.to) {
    const toStr = (message.toAddresses ?? "").toLowerCase();
    if (!toStr.includes(criteria.to.toLowerCase())) return false;
  }

  if (criteria.subject) {
    const subjectStr = (message.subject ?? "").toLowerCase();
    if (!subjectStr.includes(criteria.subject.toLowerCase())) return false;
  }

  if (criteria.body) {
    const bodyStr = `${message.bodyText ?? ""} ${message.bodyHtml ?? ""}`.toLowerCase();
    if (!bodyStr.includes(criteria.body.toLowerCase())) return false;
  }

  if (criteria.hasAttachment) {
    if (!message.hasAttachments) return false;
  }

  return true;
}

export interface FilterResult {
  addLabelIds: string[];
  removeLabelIds: string[];
  markRead: boolean;
  star: boolean;
}

/**
 * Compute the aggregate label/flag changes from a set of filter actions.
 */
export function computeFilterActions(actions: FilterActions): FilterResult {
  const addLabelIds: string[] = [];
  const removeLabelIds: string[] = [];

  if (actions.applyLabel) {
    addLabelIds.push(actions.applyLabel);
  }

  if (actions.archive) {
    removeLabelIds.push("INBOX");
  }

  if (actions.trash) {
    addLabelIds.push("TRASH");
    removeLabelIds.push("INBOX");
  }

  if (actions.star) {
    addLabelIds.push("STARRED");
  }

  return {
    addLabelIds,
    removeLabelIds,
    markRead: actions.markRead ?? false,
    star: actions.star ?? false,
  };
}

/**
 * Apply all enabled filters to a set of new messages for the given account.
 * Modifies threads via the Gmail API and updates local DB.
 */
export async function applyFiltersToMessages(
  accountId: string,
  messages: ParsedMessage[],
): Promise<void> {
  const filters = await getEnabledFiltersForAccount(accountId);
  if (filters.length === 0) return;

  // Pre-parse filter JSON once (not per-message) to avoid O(M×F) parse operations
  const parsedFilters = filters.flatMap((filter) => {
    try {
      return [{
        criteria: JSON.parse(filter.criteria_json) as FilterCriteria,
        actions: JSON.parse(filter.actions_json) as FilterActions,
      }];
    } catch {
      return [];
    }
  });
  if (parsedFilters.length === 0) return;

  // Group actions by threadId so we can batch modifications
  const threadActions = new Map<string, FilterResult>();

  for (const msg of messages) {
    for (const { criteria, actions } of parsedFilters) {
      if (messageMatchesFilter(msg, criteria)) {
        const result = computeFilterActions(actions);
        const existing = threadActions.get(msg.threadId);
        if (existing) {
          // Merge results
          existing.addLabelIds.push(...result.addLabelIds);
          existing.removeLabelIds.push(...result.removeLabelIds);
          existing.markRead = existing.markRead || result.markRead;
          existing.star = existing.star || result.star;
        } else {
          threadActions.set(msg.threadId, result);
        }
      }
    }
  }

  // Apply combined actions per thread in parallel
  const outcomes = await Promise.allSettled(
    [...threadActions].map(async ([threadId, result]) => {
      const addLabels = [...new Set(result.addLabelIds)];
      const removeLabels = [...new Set(result.removeLabelIds)];

      try {
        // Apply label changes via provider
        for (const labelId of addLabels) {
          await addThreadLabel(accountId, threadId, labelId);
        }
        for (const labelId of removeLabels) {
          await removeThreadLabel(accountId, threadId, labelId);
        }

        // Mark as read via provider
        if (result.markRead) {
          await markThreadRead(accountId, threadId, [], true);
        }

        // Star via provider
        if (result.star) {
          await starThread(accountId, threadId, [], true);
        }
      } catch (err) {
        console.error(`Failed to apply filter actions to thread ${threadId}:`, err);
        throw err;
      }
    }),
  );
  const failure = outcomes.find((outcome) => outcome.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}

// ============================================================================
// Client-side Filter Operations (Metadata-tracked)
// ============================================================================

/** Prepare one batch against freshly downloaded rules and metadata. Failures defer filtering. */
export async function prepareFilterBatch(accountId: string, config: ImapConfig) {
  await syncFilterSettings(accountId, config, { strict: true });
  await ensureMetadataDownloadedForEmail(accountId, config);
  return (threadId: string, messages: ParsedMessage | ParsedMessage[]) =>
    addEmailLocally(accountId, threadId, messages, config);
}

/**
 * Add an email (or thread of messages) with client-side filtering.
 * Checks whether the email has already been filtered using its metadata.
 * When adding an email that has not been filtered:
 *   1. Applies the filter rules to it.
 *   2. Sets the metadata to mark the email as filtered.
 *
 * If the email has already been marked as filtered in metadata, filter rules are skipped.
 */
export async function addEmail(
  accountId: string,
  threadId: string,
  messageOrMessages: ParsedMessage | ParsedMessage[],
  config?: ImapConfig,
  options?: { skipSidecarPush?: boolean },
): Promise<{ filtered: boolean }> {
  const account = config ? undefined : await getAccount(accountId);
  const imapConfig = config ?? (account?.provider === "imap" ? buildImapConfig(account) : undefined);
  if (imapConfig) {
    await syncFilterSettings(accountId, imapConfig, { strict: true });
    await ensureMetadataDownloadedForEmail(accountId, imapConfig, threadId);
  }
  return addEmailLocally(accountId, threadId, messageOrMessages, imapConfig, options);
}

const filteringThreads = new Map<string, Promise<{ filtered: boolean }>>();

async function addEmailLocally(
  accountId: string,
  threadId: string,
  messages: ParsedMessage | ParsedMessage[],
  config?: ImapConfig,
  options?: { skipSidecarPush?: boolean },
): Promise<{ filtered: boolean }> {
  const effectiveId = threadId || (Array.isArray(messages) ? messages[0]?.threadId : messages.threadId) || "";
  const key = JSON.stringify([accountId, effectiveId]);
  const previous = filteringThreads.get(key);
  if (previous) return previous;
  const operation = filterEmail(accountId, effectiveId, messages, config, options);
  filteringThreads.set(key, operation);
  try {
    return await operation;
  } finally {
    if (filteringThreads.get(key) === operation) filteringThreads.delete(key);
  }
}

async function filterEmail(
  accountId: string,
  threadId: string,
  messageOrMessages: ParsedMessage | ParsedMessage[],
  config?: ImapConfig,
  options?: { skipSidecarPush?: boolean },
): Promise<{ filtered: boolean }> {
  const messages = Array.isArray(messageOrMessages)
    ? messageOrMessages
    : [messageOrMessages];
  const effectiveThreadId =
    threadId || (messages.length > 0 ? messages[0]!.threadId : "");

  // Check metadata to see if email has already been filtered
  const alreadyFiltered = await isEmailFiltered(accountId, effectiveThreadId);
  if (alreadyFiltered) {
    return { filtered: false };
  }

  // When adding an email that has not been filtered, apply the filter rules to it
  await applyFiltersToMessages(accountId, messages);

  // Then set the metadata to mark the email as filtered
  await markEmailFiltered(accountId, effectiveThreadId, true);

  // If this is an IMAP account and sidecar is available, push updated metadata (unless skipped)
  if (!options?.skipSidecarPush) {
    try {
      const account = await getAccount(accountId);
      if (account && account.provider === "imap") {
        const imapConfig = config ?? buildImapConfig(account);
        const doc = await getThreadCrdtDoc(accountId, effectiveThreadId, "personal");
        await pushSidecarMetadata(imapConfig, account.email, {
          conversationId: effectiveThreadId,
          type: "personal",
          updatedAt: Date.now(),
          isFiltered: true,
          crdtDocBase64: doc?.doc_base64,
        });
      }
    } catch (err) {
      console.warn(
        `[filterEngine] Note on pushing sidecar metadata for ${effectiveThreadId}:`,
        err,
      );
    }
  }

  return { filtered: true };
}

/**
 * Download an email (or thread of messages).
 * When downloading an email, makes sure there isn't metadata for that email
 * yet to be downloaded before adding/assuming an empty metadata item.
 * Then calls addEmail to apply filters if not filtered and mark metadata.
 */
export async function downloadEmail(
  accountId: string,
  threadId: string,
  messageOrMessages: ParsedMessage | ParsedMessage[],
  config?: ImapConfig,
): Promise<{ filtered: boolean }> {
  return addEmail(accountId, threadId, messageOrMessages, config);
}

// ============================================================================
// Affected Emails Preview & Manual Execution
// ============================================================================

export interface AffectedEmail {
  id: string;
  threadId: string;
  fromName: string | null;
  fromAddress: string | null;
  toAddresses: string | null;
  subject: string | null;
  snippet: string | null;
  date: number;
  isRead: boolean;
  isStarred: boolean;
  hasAttachments: boolean;
  actionChanges: string[];
}

/**
 * Preview which emails in an account would be affected by a new filter,
 * assuming the new filter has highest priority (evaluated before all others).
 */
export async function getAffectedEmailsForFilter(
  accountId: string,
  criteria: FilterCriteria,
  actions: FilterActions,
  limit = 50,
): Promise<AffectedEmail[]> {
  const db = await getDb();
  let labels: { id: string; name: string }[] = [];
  try {
    labels = await getLabelsForAccount(accountId);
  } catch {
    // best effort
  }
  const labelMap = new Map(labels.map((l) => [l.id, l.name]));

  // Resolve action label display name
  const targetLabelName = actions.applyLabel
    ? labelMap.get(actions.applyLabel) ?? actions.applyLabel
    : undefined;

  const rows = await db.select<{
    id: string;
    thread_id: string;
    from_name: string | null;
    from_address: string | null;
    to_addresses: string | null;
    subject: string | null;
    snippet: string | null;
    date: number;
    is_read: number;
    is_starred: number;
    body_text: string | null;
    body_html: string | null;
    attachment_count: number;
  }[]>(
    `SELECT m.id, m.thread_id, m.from_name, m.from_address, m.to_addresses,
            m.subject, m.snippet, m.date, m.is_read, m.is_starred,
            m.body_text, m.body_html,
            (SELECT COUNT(*) FROM attachments a WHERE a.message_id = m.id AND a.account_id = m.account_id AND a.is_inline = 0) as attachment_count
     FROM messages m
     WHERE m.account_id = $1
     ORDER BY m.date DESC`,
    [accountId],
  );

  const affected: AffectedEmail[] = [];

  for (const row of rows) {
    const hasAttachments = (row.attachment_count ?? 0) > 0;
    const msg: ParsedMessage = {
      id: row.id,
      threadId: row.thread_id,
      fromAddress: row.from_address,
      fromName: row.from_name,
      toAddresses: row.to_addresses,
      ccAddresses: null,
      bccAddresses: null,
      replyTo: null,
      subject: row.subject,
      snippet: row.snippet ?? "",
      date: row.date,
      isRead: row.is_read === 1,
      isStarred: row.is_starred === 1,
      bodyHtml: row.body_html,
      bodyText: row.body_text,
      rawSize: 0,
      internalDate: 0,
      labelIds: [],
      hasAttachments,
      attachments: [],
      listUnsubscribe: null,
      listUnsubscribePost: null,
      authResults: null,
    };

    if (messageMatchesFilter(msg, criteria)) {
      const changes: string[] = [];
      if (actions.applyLabel) {
        changes.push(`Apply label '${targetLabelName}'`);
      }
      if (actions.archive) {
        changes.push("Archive from Inbox");
      }
      if (actions.trash) {
        changes.push("Move to Trash");
      }
      if (actions.star) {
        changes.push(row.is_starred === 1 ? "Keep starred" : "Star email");
      }
      if (actions.markRead) {
        changes.push(row.is_read === 1 ? "Already read" : "Mark as read");
      }

      affected.push({
        id: row.id,
        threadId: row.thread_id,
        fromName: row.from_name,
        fromAddress: row.from_address,
        toAddresses: row.to_addresses,
        subject: row.subject,
        snippet: row.snippet,
        date: row.date,
        isRead: row.is_read === 1,
        isStarred: row.is_starred === 1,
        hasAttachments,
        actionChanges: changes,
      });

      if (affected.length >= limit) {
        break;
      }
    }
  }

  return affected;
}

/**
 * Apply filter actions across specific threads in an account.
 */
export async function applyFilterActionsToThreads(
  accountId: string,
  actions: FilterActions,
  threadIds: string[],
): Promise<void> {
  const result = computeFilterActions(actions);
  const uniqueThreadIds = [...new Set(threadIds)];

  await Promise.allSettled(
    uniqueThreadIds.map(async (threadId) => {
      try {
        for (const labelId of result.addLabelIds) {
          await addThreadLabel(accountId, threadId, labelId);
        }
        for (const labelId of result.removeLabelIds) {
          await removeThreadLabel(accountId, threadId, labelId);
        }
        if (result.markRead) {
          await markThreadRead(accountId, threadId, [], true);
        }
        if (result.star) {
          await starThread(accountId, threadId, [], true);
        }
      } catch (err) {
        console.error(`Failed to apply filter actions to thread ${threadId}:`, err);
      }
    }),
  );
}

/** Retry persisted unfinished work even when the provider has no new messages. */
export async function retryUnfilteredEmails(accountId: string, config: ImapConfig): Promise<void> {
  const db = await getDb();
  const threads = await db.select<{ id: string }[]>(
    `SELECT t.id FROM threads t WHERE t.account_id = $1 AND t.is_filtered = 0
     AND EXISTS (SELECT 1 FROM messages m WHERE m.account_id = t.account_id AND m.thread_id = t.id)`,
    [accountId],
  );
  for (let i = 0; i < threads.length; i += 100) {
    const filter = await prepareFilterBatch(accountId, config);
    for (const { id } of threads.slice(i, i + 100)) {
      if ((await getPendingOpsForResource(accountId, id)).length > 0) continue;
      const rows = await getMessagesForThread(accountId, id);
      const messages: ParsedMessage[] = await Promise.all(rows.map(async (m) => {
        const attachments = await db.select<{ count: number }[]>(
          "SELECT COUNT(*) AS count FROM attachments WHERE account_id = $1 AND message_id = $2", [accountId, m.id],
        );
        return {
          id: m.id, threadId: id, fromAddress: m.from_address, fromName: m.from_name,
          toAddresses: m.to_addresses, ccAddresses: m.cc_addresses, bccAddresses: m.bcc_addresses,
          replyTo: m.reply_to, subject: m.subject, snippet: m.snippet ?? "", date: m.date,
          isRead: Boolean(m.is_read), isStarred: Boolean(m.is_starred),
          bodyHtml: m.body_html, bodyText: m.body_text, attachments: [], labelIds: [],
          hasAttachments: Number(attachments[0]?.count ?? 0) > 0,
          rawSize: m.raw_size ?? 0, internalDate: m.internal_date ?? m.date,
          listUnsubscribe: m.list_unsubscribe, listUnsubscribePost: m.list_unsubscribe_post,
          authResults: m.auth_results,
        };
      }));
      if (messages.length > 0) await filter(id, messages);
    }
  }
}
