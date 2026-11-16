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
import type { ImapConfig } from "../imap/tauriCommands";
import { getAccount } from "../db/accounts";
import { getThreadCrdtDoc } from "../db/threadCrdtDocs";

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
  await Promise.allSettled(
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
      }
    }),
  );
}

// ============================================================================
// Client-side Filter Operations (Metadata-tracked)
// ============================================================================

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

  // If this is an IMAP account and sidecar is available, push updated metadata
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
  const messages = Array.isArray(messageOrMessages)
    ? messageOrMessages
    : [messageOrMessages];
  const effectiveThreadId =
    threadId || (messages.length > 0 ? messages[0]!.threadId : "");

  // When downloading an email, make sure there isn't metadata for that email
  // yet to be downloaded before adding/assuming an empty metadata item.
  let imapConfig = config;
  if (!imapConfig) {
    try {
      const account = await getAccount(accountId);
      if (account && account.provider === "imap") {
        imapConfig = buildImapConfig(account);
      }
    } catch {
      // Account lookup failed or not found
    }
  }

  if (imapConfig) {
    try {
      await ensureMetadataDownloadedForEmail(
        accountId,
        imapConfig,
        effectiveThreadId,
      );
    } catch (err) {
      console.warn(
        `[filterEngine] Error checking pending metadata for ${effectiveThreadId}:`,
        err,
      );
    }
  }

  // Add the email, applying filters if unfiltered and setting metadata
  return addEmail(accountId, effectiveThreadId, messages, imapConfig);
}
