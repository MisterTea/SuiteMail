import { isIOS } from "@/platform/ios";
import { notifyNewlySyncedMail } from "../notifications/newMail";
import { importBackgroundMail } from "./androidBackgroundSync";
import { getGmailClient } from "./tokenManager";
import { initialSync, deltaSync, syncInitialChanges, backfillBodies, BODY_PREFETCH_DAYS, type SyncProgress } from "./sync";
import { getAccount, clearAccountHistoryId } from "../db/accounts";
import { getSetting, setSetting } from "../db/settings";
import { getThreadCountForAccount, deleteAllThreadsForAccount } from "../db/threads";
import { deleteAllMessagesForAccount } from "../db/messages";
import { imapInitialSync, imapDeltaSync } from "../imap/imapSync";
import { syncGraphAccount } from "../microsoft/graphSync";
import { syncEwsAccount } from "../microsoft/ewsSync";
import { clearAllFolderSyncStates } from "../db/folderSyncState";
import { ensureFreshToken } from "../oauth/oauthTokenManager";
import { hasCalendarSupport, getCalendarProvider } from "../calendar/providerFactory";
import { getVisibleCalendars, upsertCalendar, updateCalendarSyncToken } from "../db/calendars";
import { upsertCalendarEvent, deleteEventByRemoteId } from "../db/calendarEvents";
import { classifyError } from "@/utils/networkErrors";

const SYNC_INTERVAL_MS = 60_000; // 60 seconds — delta syncs are lightweight (single API call when idle)
/**
 * Wall-clock budget per sync cycle for backfill work (initial listing, then body downloads), shared by
 * the Gmail accounts being synced. New-mail polling always runs first and is not limited.
 */
export const GMAIL_BACKFILL_BUDGET_MS = 45_000;
const MIN_ACCOUNT_BUDGET_MS = 10_000;
let accountBudgetMs = GMAIL_BACKFILL_BUDGET_MS;
const ANDROID_RESUME_WINDOW_MS = 15_000;
const ANDROID_RESUME_RETRY_MS = 1_000;

let syncTimer: ReturnType<typeof setInterval> | null = null;
let syncPromise: Promise<void> | null = null;
let pendingAccountIds: string[] | null = null;
let androidSyncForeground: boolean | undefined;
let androidResumedAt: number | undefined;

export function setAndroidSyncForeground(isActive: boolean | undefined): void {
  if (androidSyncForeground === isActive) return;
  androidSyncForeground = isActive;
  androidResumedAt = isActive ? Date.now() : undefined;
}

function isAndroidSyncPaused(): boolean {
  return androidSyncForeground === false;
}

export type SyncStatusCallback = (
  accountId: string,
  status: "syncing" | "done" | "interrupted" | "error",
  progress?: SyncProgress,
  error?: string,
) => void;

let statusCallback: SyncStatusCallback | null = null;

export function onSyncStatus(cb: SyncStatusCallback): () => void {
  statusCallback = cb;
  return () => {
    statusCallback = null;
  };
}

function reportSyncedMessages(accountId: string, count: number): void {
  if (count > 0) statusCallback?.(accountId, "syncing", { phase: "messages", current: count, total: 0 });
}

/**
 * Run a sync for a single Gmail API account (initial or delta).
 */
async function syncGmailAccount(accountId: string): Promise<void> {
  const client = await getGmailClient(accountId);
  const account = await getAccount(accountId);

  if (!account) {
    throw new Error("Account not found");
  }

  const syncPeriodStr = await getSetting("sync_period_days");
  const syncDays = parseInt(syncPeriodStr ?? "365", 10) || 365;
  let messagesSynced = 0;
  const onMessagesStored = (count: number) => {
    messagesSynced += count;
    reportSyncedMessages(accountId, messagesSynced);
  };
  // Backfill until this account's share of the cycle budget is used, then resume next cycle.
  const deadline = Date.now() + accountBudgetMs;
  // A sync requested meanwhile (user refresh or the next timer tick) takes priority over backfill.
  const shouldStop = () => pendingAccountIds !== null;
  // Historical backfill runs silently — don't mix older mail into the header's "X messages synced" counter.
  const backfill = () => initialSync(client, accountId, syncDays, undefined, { deadline, shouldStop });

  if (account.history_id) {
    // Delta sync
    try {
      await deltaSync(client, accountId, account.history_id, undefined, onMessagesStored);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? "");
      if (message === "HISTORY_EXPIRED") {
        // Clear the expired account cursor so subsequent cycles can poll live changes during backfill.
        await clearAccountHistoryId(accountId);
        await backfill();
      } else {
        throw err;
      }
    }
  } else {
    // New mail gets priority; a bounded backfill must not hold the queue for hours.
    await syncInitialChanges(client, accountId, onMessagesStored);
    await backfill();
  }

  // Low priority: bodies for mail stored from metadata, recent mail first. Only once the listing is done.
  if (Date.now() < deadline && (await getAccount(accountId))?.history_id) {
    await backfillBodies(client, accountId, { deadline, shouldStop, sinceMs: Date.now() - BODY_PREFETCH_DAYS * 86_400_000 });
    await backfillBodies(client, accountId, { deadline, shouldStop });
  }
}

/**
 * Run a sync for a single IMAP account (initial or delta).
 */
async function syncImapAccount(accountId: string): Promise<void> {
  const account = await getAccount(accountId);

  if (!account) {
    throw new Error("Account not found");
  }

  // Refresh OAuth2 token before syncing (if applicable)
  if (account.auth_method === "oauth2") {
    await ensureFreshToken(account);
  }

  const syncPeriodStr = await getSetting("sync_period_days");
  const syncDays = parseInt(syncPeriodStr ?? "365", 10) || 365;

  if (account.history_id) {
    // Delta sync — IMAP uses folder-level UID tracking
    const result = await imapDeltaSync(accountId, syncDays, (count) => reportSyncedMessages(accountId, count));

    // Recovery: if delta sync found nothing new but the DB has no threads,
    // the previous initial sync likely failed or stored data incorrectly.
    // Force a full re-sync to recover.
    if (result.messages.length > 0 || await getThreadCountForAccount(accountId) !== 0) return;
    console.warn(`[syncManager] IMAP delta sync returned 0 new messages and DB has 0 threads for ${accountId} — forcing full re-sync`);
    await clearAccountHistoryId(accountId);
    await clearAllFolderSyncStates(accountId);
  }

  await imapInitialSync(accountId, syncDays, (progress) => {
    if (progress.phase === "messages") reportSyncedMessages(accountId, progress.current);
  });
}

/**
 * Sync calendars for a single account via the CalendarProvider abstraction.
 * Discovers calendars, syncs events for each visible calendar, stores results in DB.
 */
async function syncCalendarForAccount(accountId: string): Promise<void> {
  if (isIOS()) return;
  try {
    const supported = await hasCalendarSupport(accountId);
    if (!supported) return;

    const provider = await getCalendarProvider(accountId);

    // Discover/update calendars
    const calendarInfos = await provider.listCalendars();
    for (const cal of calendarInfos) {
      await upsertCalendar({
        accountId,
        provider: provider.type,
        remoteId: cal.remoteId,
        displayName: cal.displayName,
        color: cal.color,
        isPrimary: cal.isPrimary,
      });
    }

    // Sync events for each visible calendar
    const visibleCals = await getVisibleCalendars(accountId);
    for (const cal of visibleCals) {
      try {
        const syncResult = await provider.syncEvents(cal.remote_id, cal.sync_token ?? undefined);

        // Upsert created/updated events
        for (const event of [...syncResult.created, ...syncResult.updated]) {
          await upsertCalendarEvent({
            accountId,
            googleEventId: event.remoteEventId,
            summary: event.summary,
            description: event.description,
            location: event.location,
            startTime: event.startTime,
            endTime: event.endTime,
            isAllDay: event.isAllDay,
            status: event.status,
            organizerEmail: event.organizerEmail,
            attendeesJson: event.attendeesJson,
            htmlLink: event.htmlLink,
            calendarId: cal.id,
            remoteEventId: event.remoteEventId,
            etag: event.etag,
            icalData: event.icalData,
            uid: event.uid,
          });
        }

        // Delete removed events
        for (const remoteId of syncResult.deletedRemoteIds) {
          await deleteEventByRemoteId(cal.id, remoteId);
        }

        // Update sync token
        if (syncResult.newSyncToken || syncResult.newCtag) {
          await updateCalendarSyncToken(cal.id, syncResult.newSyncToken, syncResult.newCtag);
        }
      } catch (err) {
        console.warn(`[syncManager] Calendar sync failed for ${cal.display_name ?? cal.remote_id}:`, err);
      }
    }

    // Emit event for UI update
    window.dispatchEvent(new CustomEvent("suitemail-calendar-sync-done"));
  } catch (err) {
    console.warn(`[syncManager] Calendar sync failed for account ${accountId}:`, err);
  }
}

/**
 * Run a sync for a single account (initial or delta).
 * Routes to Gmail or IMAP sync based on account provider.
 */
async function syncAccountInternal(accountId: string, canRetry = true): Promise<void> {
  const resumedAtStart = androidResumedAt;
  const startedOnResume = resumedAtStart !== undefined && Date.now() - resumedAtStart < ANDROID_RESUME_WINDOW_MS;
  try {
    const account = await getAccount(accountId);

    if (!account) {
      throw new Error("Account not found");
    }

    statusCallback?.(accountId, "syncing");

    console.log(`[syncManager] Syncing account ${accountId} (provider=${account.provider}, has_sync_cursor=${Boolean(account.history_id)})`);

    if (account.provider === "sandbox") {
      statusCallback?.(accountId, "done");
      return;
    }

    if (account.provider === "caldav") {
      // CalDAV-only accounts — skip email sync, only sync calendar
      await syncCalendarForAccount(accountId);
      statusCallback?.(accountId, "done");
      return;
    }

    if (account.provider === "ews") {
      await syncEwsAccount(accountId, (phase, current, total) => {
        statusCallback?.(accountId, "syncing", {
          phase: phase === "folders" ? "labels" : phase === "done" ? "done" : "messages",
          current,
          total,
        });
      });
    } else if (account.provider === "msgraph") {
      await syncGraphAccount(accountId, (phase, current, total) => {
        statusCallback?.(accountId, "syncing", {
          phase: phase === "folders" ? "labels" : phase === "done" ? "done" : "messages",
          current,
          total,
        });
      });
    } else if (account.provider === "imap") {
      await syncImapAccount(accountId);
    } else {
      await syncGmailAccount(accountId);
    }

    if (account.provider === "imap" || account.provider === "ews" || account.provider === "msgraph") {
      await notifyNewlySyncedMail(accountId, account.last_sync_at, Boolean(account.history_id)).catch((error) => {
        console.warn("Could not process new mail notifications", error);
      });
    }

    // Always emit "done" when an initial sync completes (clears the bar).
    // Also emit for delta syncs that fell back to initial (recovery re-sync)
    // since those emit progress via statusCallback inside syncImapAccount.
    statusCallback?.(accountId, "done");

    // Sync calendar alongside email (non-blocking — calendar errors don't affect email sync)
    syncCalendarForAccount(accountId).catch((err) => {
      console.warn(`[syncManager] Calendar sync error for ${accountId}:`, err);
    });
  } catch (err) {
    const { type, message } = classifyError(err);
    if (type === "network") {
      if (isAndroidSyncPaused()) {
        statusCallback?.(accountId, "interrupted");
        return;
      }
      if (canRetry && androidSyncForeground && (startedOnResume || resumedAtStart !== androidResumedAt)) {
        console.warn(`[syncManager] Retrying account ${accountId} after Android resumed:`, message);
        await new Promise<void>((resolve) => setTimeout(resolve, ANDROID_RESUME_RETRY_MS));
        if (androidSyncForeground) {
          await syncAccountInternal(accountId, false);
        } else {
          statusCallback?.(accountId, "interrupted");
        }
        return;
      }
    }
    console.error(`[syncManager] Sync failed for account ${accountId}:`, message);
    statusCallback?.(accountId, "error", undefined, message);
  }
}

async function runSync(accountIds: string[]): Promise<void> {
  if (isAndroidSyncPaused()) return;
  if (syncPromise) {
    // Queue these accounts, merging with any already-pending IDs
    const existing = new Set(pendingAccountIds ?? []);
    for (const id of accountIds) existing.add(id);
    pendingAccountIds = [...existing];
    return syncPromise;
  }

  syncPromise = (async () => {
    try {
      accountBudgetMs = Math.max(MIN_ACCOUNT_BUDGET_MS, GMAIL_BACKFILL_BUDGET_MS / Math.max(1, accountIds.length));
      await importBackgroundMail().catch((error) => console.warn("Background mail import failed:", error));
      for (const id of accountIds) {
        if (isAndroidSyncPaused()) break;
        await syncAccountInternal(id);
      }
    } finally {
      syncPromise = null;
    }

    // Drain the queue — if something was queued while we were syncing, run it now
    if (pendingAccountIds) {
      const queued = pendingAccountIds;
      pendingAccountIds = null;
      await runSync(queued);
    }
  })();

  return syncPromise;
}

/**
 * Run sync for a single account, queuing if already running.
 */
export async function syncAccount(accountId: string): Promise<void> {
  return runSync([accountId]);
}

/**
 * Start the background sync timer for all accounts.
 * When `skipImmediateSync` is true the first periodic sync is deferred to the
 * next interval tick — useful when the caller already triggered a sync for a
 * newly-added account and doesn't want existing accounts to block it.
 */
export function startBackgroundSync(accountIds: string[], skipImmediateSync = false): void {
  stopBackgroundSync();

  if (!skipImmediateSync) {
    // Immediate sync
    runSync(accountIds);
  }

  // Periodic sync
  syncTimer = setInterval(() => {
    runSync(accountIds);
  }, SYNC_INTERVAL_MS);
}

/**
 * Stop the background sync timer.
 */
export function stopBackgroundSync(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}

/**
 * Trigger an immediate sync for all provided accounts.
 * Waits for completion even if a background sync is in progress.
 */
export async function triggerSync(accountIds: string[]): Promise<void> {
  await runSync(accountIds);
}

/**
 * Clear history IDs and perform a full re-sync for all provided accounts.
 * This re-downloads all threads from scratch.
 */
export async function forceFullSync(accountIds: string[]): Promise<void> {
  for (const id of accountIds) {
    await clearAccountHistoryId(id);
    await setSetting(`gmail_initial_sync:${id}`, "", {skipNotify:true});
  }
  await runSync(accountIds);
}

/**
 * Delete all local data for a single account and re-sync from scratch.
 * Removes all threads, messages, history ID, and IMAP folder sync states,
 * then runs a fresh initial sync.
 */
export async function resyncAccount(accountId: string): Promise<void> {
  await deleteAllThreadsForAccount(accountId);
  await deleteAllMessagesForAccount(accountId);
  await clearAccountHistoryId(accountId);
  await setSetting(`gmail_initial_sync:${accountId}`, "", {skipNotify:true});
  await clearAllFolderSyncStates(accountId);
  await runSync([accountId]);
}
