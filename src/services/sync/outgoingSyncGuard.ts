import {
  type OutgoingSyncRequest,
  type OutgoingDiffItem,
  requestOutgoingSyncConfirmation,
} from "@/stores/outgoingSyncStore";

export const LARGE_DIFF_THRESHOLD = 5;

export function buildOutgoingSyncRequest(params: {
  accountId: string;
  accountEmail?: string;
  isFirstSync?: boolean;
  title?: string;
  description?: string;
  items: OutgoingDiffItem[];
}): OutgoingSyncRequest {
  const { items } = params;
  let labelsCount = 0;
  let archiveCount = 0;
  let trashCount = 0;
  let spamCount = 0;
  let metadataCount = 0;
  let otherCount = 0;

  for (const item of items) {
    switch (item.type) {
      case "label":
        labelsCount++;
        break;
      case "archive":
        archiveCount++;
        break;
      case "trash":
      case "delete":
        trashCount++;
        break;
      case "spam":
        spamCount++;
        break;
      case "metadata":
        metadataCount++;
        break;
      default:
        otherCount++;
        break;
    }
  }

  const defaultTitle = params.isFirstSync
    ? `Confirm First Sync to Server (${items.length} Changes)`
    : `Confirm Outgoing Sync (${items.length} Changes)`;

  const defaultDescription = params.isFirstSync
    ? `A large outgoing diff was detected during initial sync (${items.length} items). Please confirm before syncing these conversation labels and metadata from the app to the mail server. Syncing from server to app is unaffected.`
    : `A large outgoing diff was detected (${items.length} items). Please confirm before syncing these changes from the app to the mail server. Syncing from server to app is unaffected.`;

  return {
    accountId: params.accountId,
    accountEmail: params.accountEmail,
    isFirstSync: params.isFirstSync,
    title: params.title ?? defaultTitle,
    description: params.description ?? defaultDescription,
    items,
    summary: {
      total: items.length,
      labelsCount,
      archiveCount,
      trashCount,
      spamCount,
      metadataCount,
      otherCount,
    },
  };
}

/**
 * Check if an outgoing sync diff requires user confirmation.
 * Syncing from server to app is always ok.
 * If there is a large outgoing diff (for example, when doing a first sync), warn the user
 * before syncing from app to server, show a popover with a summary, and get confirmation first.
 */
export async function checkOutgoingSyncAllowed(
  request: OutgoingSyncRequest,
  threshold: number = LARGE_DIFF_THRESHOLD,
): Promise<boolean> {
  const isLarge =
    request.items.length >= threshold ||
    (Boolean(request.isFirstSync) && request.items.length > 0);

  if (!isLarge) {
    // Normal small update (e.g. user archiving a single email)
    return true;
  }

  return requestOutgoingSyncConfirmation(request);
}

/**
 * Syncing from server to app is always ok without user confirmation.
 */
export function isServerToAppSyncAllowed(): boolean {
  return true;
}
