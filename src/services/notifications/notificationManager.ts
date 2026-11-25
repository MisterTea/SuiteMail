import { addSettingChangeListener, getSetting } from "../db/settings";
import { useComposerStore } from "../../stores/composerStore";
import { navigateToLabel } from "../../router/navigate";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { getDb } from "../db/connection";
import { getThreadById } from "../db/threads";
import { getVipSenders } from "../db/notificationVips";
import { useAccountStore } from "@/stores/accountStore";
import { getAccountNotificationPreferences, isDuringQuietHours } from "./notificationPreferences";
import { createBackgroundChecker } from "../backgroundCheckers";
import { normalizeEmail } from "@/utils/emailUtils";

let nextNotificationId = Date.now() % 1_000_000_000;
const SUMMARY_TIMEOUT_MS = 5_000;

interface AndroidMailNotificationsPlugin {
  showNotification(options: {
    id: number;
    title: string;
    body: string;
    largeBody?: string;
    timestamp?: number;
    extra?: NotificationContext;
  }): Promise<void>;
  addListener(
    eventName: "mailNotificationOpened",
    listenerFunc: (context: NotificationContext) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

let androidMailNotifications: AndroidMailNotificationsPlugin | null = null;

function getAndroidMailNotifications(): AndroidMailNotificationsPlugin | null {
  if (Capacitor.getPlatform() !== "android" || typeof registerPlugin !== "function") return null;
  if (!androidMailNotifications) {
    androidMailNotifications = registerPlugin<AndroidMailNotificationsPlugin>("SuiteMail");
  }
  return androidMailNotifications;
}

export function normalizeNotificationTimestamp(
  value?: number | string | Date | null,
): number | undefined {
  if (value == null) return undefined;
  let ms: number;
  if (value instanceof Date) {
    ms = value.getTime();
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const numeric = Number(trimmed);
    ms = Number.isFinite(numeric) ? numeric : Date.parse(trimmed);
  } else {
    ms = value;
  }
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return Math.trunc(ms < 10_000_000_000 ? ms * 1000 : ms);
}

export async function requestMailNotificationPermission(): Promise<boolean> {
  if (Capacitor.getPlatform() === "android") {
    const current = await LocalNotifications.checkPermissions();
    return (current.display === "granted" ? current : await LocalNotifications.requestPermissions()).display === "granted";
  }
  if (typeof Notification === "undefined") return false;
  return Notification.permission === "granted" || (Notification.permission === "default" && await Notification.requestPermission() === "granted");
}

async function getNotificationSummary(accountId: string, threadId: string, signal: AbortSignal): Promise<string | null> {
  if ((await getSetting("ai_auto_summarize")) === "false" || signal.aborted) return null;
  const { isAiAvailable } = await import("../ai/providerManager");
  const available = !signal.aborted && await isAiAvailable();
  if (!available || signal.aborted) return null;
  const thread = await getThreadById(accountId, threadId);
  if (!thread || signal.aborted) return null;
  const { summarizeInboxThread } = await import("../ai/aiService");
  if (signal.aborted) return null;
  return summarizeInboxThread({
    accountId,
    id: threadId,
    subject: thread.subject,
    lastMessageAt: thread.last_message_at ?? 0,
    messageCount: thread.message_count,
  }, signal);
}

async function getNotificationPreview(snippet: string, context?: NotificationContext): Promise<string> {
  const fallback = snippet.replace(/\s+/g, " ").trim();
  if (!context?.accountId || !context.threadId) return fallback;

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(null);
      }, SUMMARY_TIMEOUT_MS);
    });
    const summary = await Promise.race([
      getNotificationSummary(context.accountId, context.threadId, controller.signal).catch(() => null),
      timeout,
    ]);
    return summary || fallback;
  } finally {
    clearTimeout(timer);
  }
}

async function notifyPlatform(
  title: string,
  body: string,
  context?: NotificationContext,
  snippet?: string,
  timestamp?: number | string | Date,
): Promise<void> {
  if (!notificationsEnabled) return;
  const when = normalizeNotificationTimestamp(timestamp);
  try {
    if (Capacitor.getPlatform() === "android") {
      if ((await LocalNotifications.checkPermissions()).display !== "granted") return;
      const preview = snippet === undefined ? "" : await getNotificationPreview(snippet, context);
      if (!notificationsEnabled) return;
      const formattedBody = preview ? `${body} — ${preview}` : body;
      const largeBody = preview ? `${body}\n${preview}` : undefined;
      const nativeNotifications = getAndroidMailNotifications();
      if (nativeNotifications?.showNotification) {
        await nativeNotifications.showNotification({
          id: ++nextNotificationId,
          title,
          body: formattedBody,
          ...(largeBody ? { largeBody } : {}),
          ...(when !== undefined ? { timestamp: when } : {}),
          extra: context ?? {},
        });
        return;
      }
      await LocalNotifications.schedule({ notifications: [
        {
          id: ++nextNotificationId,
          title,
          body: formattedBody,
          ...(largeBody ? { largeBody } : {}),
          smallIcon: "ic_launcher_foreground",
          isExactNotification: false,
          extra: context ?? {},
        },
      ] });
    } else if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      const options: NotificationOptions & { timestamp?: number } = when !== undefined
        ? { body, timestamp: when }
        : { body };
      const notification = new Notification(title, options);
      notification.onclick = () => openNotification(context);
    }
  } catch (error) {
    console.warn("Could not show a mail notification", error);
  }
}

let initialized = false;
let notificationsEnabled = true;

interface NotificationContext {
  threadId?: string;
  accountId?: string;
  fromAddress?: string;
  subject?: string;
}

let lastNotificationContext: NotificationContext | null = null;
const recentContexts = new Map<string, NotificationContext>();

export async function showAndFocusMainWindow(): Promise<void> {
  if (typeof window !== "undefined" && window.supermail?.isElectron && window.supermail.invoke) {
    await window.supermail.invoke('show_main_window');
    return;
  }
  if (typeof window !== "undefined") {
    window.focus();
  }
}

/**
 * Initialize notification permissions and action types.
 */
export async function initNotifications(): Promise<void> {
  if (initialized) return;
  initialized = true;

  notificationsEnabled = (await getSetting("notifications_enabled")) !== "false";
  addSettingChangeListener(({ key, value }) => {
    if (key === "notifications_enabled") notificationsEnabled = value !== "false";
  });
  if (Capacitor.getPlatform() === "android") {
    const nativeNotifications = getAndroidMailNotifications();
    if (nativeNotifications?.addListener) {
      await nativeNotifications.addListener("mailNotificationOpened", (context) => {
        openNotification(context);
      }).catch((error) => console.warn("Could not listen for mail notification clicks", error));
    }
    await LocalNotifications.addListener("localNotificationActionPerformed", ({ notification }) => {
      openNotification(notification.extra as NotificationContext | undefined);
    }).catch((error) => console.warn("Could not listen for mail notification clicks", error));
  }
  if (notificationsEnabled) {
    void requestMailNotificationPermission().catch(() => {});
  }
  digestChecker.start();
}

export async function sendEmailNotification(
  title: string,
  body: string,
  context?: NotificationContext,
  timestamp?: number | string | Date,
): Promise<void> {
  if (!notificationsEnabled) return;

  if (context) {
    lastNotificationContext = context;
    if (context.threadId) {
      recentContexts.set(context.threadId, context);
      // Keep only last 20 contexts
      if (recentContexts.size > 20) {
        const firstKey = recentContexts.keys().next().value;
        if (firstKey) recentContexts.delete(firstKey);
      }
    }
  }

  await notifyPlatform(title, body, context, undefined, timestamp);
}

/**
 * Show a notification for new emails.
 * Batches notifications to avoid spam during sync.
 */
let pendingCount = 0;
let pendingTimestamp: number | undefined;
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

export function queueNewEmailNotification(
  from: string,
  subject: string,
  threadId?: string,
  accountId?: string,
  fromAddress?: string,
  snippet = "",
  timestamp?: number | string | Date,
): void {
  if (!notificationsEnabled) return;
  void (async () => {
    if (accountId) {
      const preferences = await getAccountNotificationPreferences(accountId);
      if (!preferences.enabled) return;
      if (isDuringQuietHours(preferences)) {
        const vip = preferences.vipBypass && fromAddress
          && (await getVipSenders(accountId)).has(normalizeEmail(fromAddress));
        if (!vip) {
          if (preferences.digest) {
            const db = await getDb();
            await db.execute(`INSERT INTO quiet_mail_digest (account_id, count) VALUES ($1, 1)
              ON CONFLICT(account_id) DO UPDATE SET count = count + 1`, [accountId]);
          }
          return;
        }
      }
    }
    if (!notificationsEnabled) return;

    const emailTimestamp = normalizeNotificationTimestamp(timestamp);
    if (emailTimestamp !== undefined && (pendingTimestamp === undefined || emailTimestamp > pendingTimestamp)) {
      pendingTimestamp = emailTimestamp;
    }

    pendingCount++;
    const ctx = { threadId, accountId, fromAddress, subject };
    lastNotificationContext = ctx;

    if (!notifyTimer) notifyTimer = setTimeout(() => {
      const count = pendingCount;
      const when = pendingTimestamp;
      pendingCount = 0;
      pendingTimestamp = undefined;
      notifyTimer = null;
      if (count === 1) {
        void notifyPlatform(from, subject || "(No subject)", ctx, snippet, when);
      } else if (count > 1) {
        void notifyPlatform("SuiteMail", `${count} new emails`, undefined, undefined, when);
      }
    }, 2000);
  })().catch((error) => console.warn("Could not queue a mail notification", error));
}

/**
 * Determine if a new email should trigger a notification based on smart notification settings.
 * Pure function — no I/O, all config is passed in from the sync cycle.
 */
export function shouldNotifyForMessage(
  smartEnabled: boolean,
  allowedCategories: Set<string>,
  vipSenders: Set<string>,
  threadCategory: string | null,
  fromAddress?: string,
): boolean {
  if (!smartEnabled) return true; // Smart notifications off -> notify everything
  if (fromAddress && vipSenders.has(normalizeEmail(fromAddress))) return true; // VIP always notifies
  const category = threadCategory ?? "Primary"; // uncategorized defaults to Primary
  return allowedCategories.has(category);
}

/**
 * Show a notification for a follow-up reminder that fired.
 */
export function notifyFollowUpDue(
  subject: string,
  threadId?: string,
  accountId?: string,
): void {
  if (!notificationsEnabled) return;
  const ctx = { threadId, accountId, subject };
  lastNotificationContext = ctx;
  if (threadId) recentContexts.set(threadId, ctx);
  void notifyPlatform("Follow up needed", subject || "(No subject)", ctx);
}

/**
 * Show a notification for a snoozed email returning.
 */
export function notifySnoozeReturn(subject: string): void {
  if (!notificationsEnabled) return;
  notifyPlatform("Snoozed email returned", subject || "(No subject)");
}

function openNotification(context?: NotificationContext) {
  void showAndFocusMainWindow();
  if (context?.accountId) {
    const accounts = useAccountStore.getState();
    if (!accounts.accounts.some((account) => account.id === context.accountId)) return;
    accounts.setActiveAccount(context.accountId);
  }
  if (context?.threadId) navigateToLabel("all", { threadId: context.threadId });
  else if (context?.accountId) navigateToLabel("inbox");
}

let flushingDigest = false;
const digestChecker = createBackgroundChecker("QuietMailDigest", async () => {
  if (flushingDigest || !notificationsEnabled) return;
  flushingDigest = true;
  try {
    const db = await getDb();
    const rows = await db.select<{ account_id: string; count: number; email: string }[]>(
      "SELECT d.account_id, d.count, a.email FROM quiet_mail_digest d JOIN accounts a ON a.id = d.account_id",
    );
    for (const row of rows) {
      const preferences = await getAccountNotificationPreferences(row.account_id);
      if (preferences.enabled && preferences.digest && isDuringQuietHours(preferences)) continue;
      if (preferences.enabled && preferences.digest) {
        await notifyPlatform(row.email, `${row.count} ${row.count === 1 ? "email" : "emails"} arrived during quiet hours`, { accountId: row.account_id });
      }
      // Preserve any messages queued after this digest was read.
      await db.execute("UPDATE quiet_mail_digest SET count = count - $2 WHERE account_id = $1", [row.account_id, row.count]);
      await db.execute("DELETE FROM quiet_mail_digest WHERE account_id = $1 AND count <= 0", [row.account_id]);
    }
  } finally {
    flushingDigest = false;
  }
}, 30_000);

export function handleNotificationAction(actionId: string, threadId?: string): void {
  const ctx = (threadId ? recentContexts.get(threadId) : null) ?? lastNotificationContext;

  switch (actionId) {
    case "reply":
      if (ctx?.threadId && ctx.accountId) {
        showAndFocusMainWindow();
        useComposerStore.getState().openComposer({
          mode: "reply",
          threadId: ctx.threadId,
          to: ctx.fromAddress ? [ctx.fromAddress] : [],
          subject: ctx.subject?.startsWith("Re:") ? ctx.subject : `Re: ${ctx.subject ?? ""}`,
        });
      }
      break;
    case "archive":
      // Archive action handled via emailActions if desired
      break;
    default:
      if (ctx?.threadId) {
        showAndFocusMainWindow();
        navigateToLabel("inbox", { threadId: ctx.threadId });
      }
      break;
  }
}

export function isNotificationsEnabled(): boolean {
  return notificationsEnabled;
}

export function setNotificationsEnabled(enabled: boolean): void {
  notificationsEnabled = enabled;
}
