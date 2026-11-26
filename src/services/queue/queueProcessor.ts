import { createBackgroundChecker, type BackgroundChecker } from "../backgroundCheckers";
import { useUIStore } from "@/stores/uiStore";
import {
  getPendingOperations,
  updateOperationStatus,
  deleteOperation,
  incrementRetry,
  getPendingOpsCount,
  compactQueue,
} from "../db/pendingOperations";
import { executeQueuedAction } from "../emailActions";
import { classifyError } from "@/utils/networkErrors";
import {
  checkOutgoingSyncAllowed,
  buildOutgoingSyncRequest,
  LARGE_DIFF_THRESHOLD,
} from "../sync/outgoingSyncGuard";
import type { OutgoingDiffItem } from "@/stores/outgoingSyncStore";
import type { PendingOperation } from "../db/pendingOperations";
import { getAccount } from "../db/accounts";
import { getMessageIdsForThreads } from "../db/messages";
import { gmailLabelDelta } from "../gmail/labelActions";

const BATCH_SIZE = 50;

let checker: BackgroundChecker | null = null;

export async function processQueue(): Promise<void> {
  // Skip if offline
  if (!useUIStore.getState().isOnline) return;

  // Compact first to eliminate redundant ops
  await compactQueue();

  // Get pending operations
  const ops = await getPendingOperations(undefined, BATCH_SIZE);
  if (ops.length === 0) {
    await updatePendingCount();
    return;
  }

  // If there is a large outgoing diff, warn the user before syncing from app to server
  if (ops.length >= LARGE_DIFF_THRESHOLD) {
    const diffItems: OutgoingDiffItem[] = ops.map((op) => {
      let details = "";
      let labels: string[] | undefined;
      try {
        const p = JSON.parse(op.params) as Record<string, unknown>;
        if (p.folderPath) details = `Folder: ${p.folderPath}`;
        if (p.labelId) {
          details = `Label: ${p.labelId}`;
          labels = [String(p.labelId)];
        }
        if (p.isSpam !== undefined) details = p.isSpam ? "Mark Spam" : "Unmark Spam";
      } catch {}

      const opType = op.operation_type;
      const type: OutgoingDiffItem["type"] =
        opType === "archive" ? "archive"
        : opType === "trash" || opType === "permanentDelete" ? "trash"
        : opType === "spam" ? "spam"
        : opType === "addLabel" || opType === "removeLabel" ? "label"
        : opType === "moveToFolder" ? "move"
        : opType === "sendMessage" ? "send"
        : "metadata";

      return {
        id: op.id,
        type,
        summary: `${op.operation_type} on ${op.resource_id}`,
        threadId: op.resource_id,
        details,
        labels,
      };
    });

    const request = buildOutgoingSyncRequest({
      accountId: ops[0]?.account_id ?? "",
      items: diffItems,
      title: `Confirm Queued Outgoing Sync (${ops.length} Operations)`,
      description: `There is a large outgoing diff of ${ops.length} queued operations waiting to sync from app to server. Confirm to sync them now, or cancel to keep them in the queue. (Syncing from server to app is unaffected).`,
    });

    const allowed = await checkOutgoingSyncAllowed(request);
    if (!allowed) {
      console.log("[QueueProcessor] Outgoing sync cancelled by user confirmation");
      await updatePendingCount();
      return;
    }
  }

  // Gmail label edits with the same effect go out as one messages.batchModify per group.
  const grouped = await executeGmailLabelGroups(ops);

  for (const op of ops) {
    if (grouped.has(op.id)) continue;
    try {
      // Mark as executing
      await updateOperationStatus(op.id, "executing");

      // Parse params and execute
      const params = JSON.parse(op.params) as Record<string, unknown>;
      await executeQueuedAction(op.account_id, op.operation_type, params);

      // Success — delete from queue
      await deleteOperation(op.id);
    } catch (err) {
      await recordFailure(op, err);
    }
  }

  await updatePendingCount();
}

async function recordFailure(op: PendingOperation, err: unknown): Promise<void> {
  const classified = classifyError(err);
  if (classified.isRetryable) {
    // Increment retry with exponential backoff
    await updateOperationStatus(op.id, "pending", classified.message);
    await incrementRetry(op.id);
  } else {
    // Permanent failure
    await updateOperationStatus(op.id, "failed", classified.message);
  }
}

/**
 * Execute queued Gmail label edits (archive, read, star, spam, move, label) in groups that make the same
 * label change, with one messages.batchModify per group instead of one threads.modify per thread.
 * Only threads with a single queued op in this batch are grouped, so per-thread order is preserved.
 * Returns the IDs of the operations it handled (succeeded or recorded as failed).
 */
export async function executeGmailLabelGroups(ops: PendingOperation[]): Promise<Set<string>> {
  const handled = new Set<string>();
  const perThread = new Map<string, number>();
  for (const op of ops) perThread.set(`${op.account_id}:${op.resource_id}`, (perThread.get(`${op.account_id}:${op.resource_id}`) ?? 0) + 1);

  const groups = new Map<string, { accountId: string; add: string[]; remove: string[]; ops: PendingOperation[] }>();
  const providers = new Map<string, string | undefined>();
  for (const op of ops) {
    if (perThread.get(`${op.account_id}:${op.resource_id}`)! > 1) continue;
    let params: Record<string, unknown>;
    try { params = JSON.parse(op.params) as Record<string, unknown>; } catch { continue; }
    const delta = gmailLabelDelta(op.operation_type, params);
    if (!delta) continue;
    if (!providers.has(op.account_id)) providers.set(op.account_id, (await getAccount(op.account_id).catch(() => undefined))?.provider);
    if (providers.get(op.account_id) !== "gmail_api") continue;
    const key = JSON.stringify([op.account_id, delta.addLabelIds, delta.removeLabelIds]);
    const group = groups.get(key) ?? { accountId: op.account_id, add: delta.addLabelIds, remove: delta.removeLabelIds, ops: [] };
    group.ops.push(op);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    if (group.ops.length < 2) continue; // A single op is cheaper as threads.modify.
    const messageIds = await getMessageIdsForThreads(group.accountId, group.ops.map((op) => op.resource_id)).catch(() => new Map<string, string[]>());
    // Threads with no local messages can't be expressed as message IDs; leave them to threads.modify.
    const ready = group.ops.filter((op) => (messageIds.get(op.resource_id)?.length ?? 0) > 0);
    if (ready.length < 2) continue;
    for (const op of ready) {
      handled.add(op.id);
      await updateOperationStatus(op.id, "executing");
    }
    try {
      const { getGmailClient } = await import("../gmail/tokenManager");
      const client = await getGmailClient(group.accountId);
      await client.batchModifyMessages(
        ready.flatMap((op) => messageIds.get(op.resource_id) ?? []),
        group.add.length ? group.add : undefined,
        group.remove.length ? group.remove : undefined,
      );
      for (const op of ready) await deleteOperation(op.id);
    } catch (err) {
      for (const op of ready) await recordFailure(op, err);
    }
  }
  return handled;
}

async function updatePendingCount(): Promise<void> {
  const count = await getPendingOpsCount();
  useUIStore.getState().setPendingOpsCount(count);
}

export function startQueueProcessor(): void {
  if (checker) return;
  checker = createBackgroundChecker("QueueProcessor", processQueue, 30_000);
  checker.start();
}

export function stopQueueProcessor(): void {
  checker?.stop();
  checker = null;
}

/**
 * Trigger an immediate queue flush (e.g., when coming back online).
 * Returns a promise that resolves when processing completes.
 */
export async function triggerQueueFlush(): Promise<void> {
  try {
    await processQueue();
  } catch (err) {
    console.error("[QueueProcessor] flush failed:", err);
  }
}
