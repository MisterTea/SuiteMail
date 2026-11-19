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

const BATCH_SIZE = 50;

let checker: BackgroundChecker | null = null;

async function processQueue(): Promise<void> {
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

  for (const op of ops) {
    try {
      // Mark as executing
      await updateOperationStatus(op.id, "executing");

      // Parse params and execute
      const params = JSON.parse(op.params) as Record<string, unknown>;
      await executeQueuedAction(op.account_id, op.operation_type, params);

      // Success — delete from queue
      await deleteOperation(op.id);
    } catch (err) {
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
  }

  await updatePendingCount();
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
