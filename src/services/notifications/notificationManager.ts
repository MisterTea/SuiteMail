import { getSetting } from "../db/settings";
import { useComposerStore } from "../../stores/composerStore";
import { navigateToLabel } from "../../router/navigate";
import { normalizeEmail } from "@/utils/emailUtils";

async function notifyPlatform(title: string, body: string): Promise<void> {
  if (typeof Notification !== "undefined") {
    if (Notification.permission === "granted") {
      new Notification(title, { body });
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then((permission) => {
        if (permission === "granted") new Notification(title, { body });
      });
    }
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

  const setting = await getSetting("notifications_enabled");
  notificationsEnabled = setting !== "false";
  if (!notificationsEnabled) return;

  if (typeof Notification !== "undefined" && Notification.permission !== "granted" && Notification.permission !== "denied") {
    await Notification.requestPermission();
  }
}

export async function sendEmailNotification(
  title: string,
  body: string,
  context?: NotificationContext,
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

  await notifyPlatform(title, body);
}

/**
 * Show a notification for new emails.
 * Batches notifications to avoid spam during sync.
 */
let pendingCount = 0;
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

export function queueNewEmailNotification(
  from: string,
  subject: string,
  threadId?: string,
  accountId?: string,
  fromAddress?: string,
): void {
  if (!notificationsEnabled) return;

  pendingCount++;

  // Store context for action handling
  const ctx = { threadId, accountId, fromAddress, subject };
  lastNotificationContext = ctx;
  if (threadId) recentContexts.set(threadId, ctx);

  // Debounce: wait 2s before showing, to batch during sync
  if (notifyTimer) clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    if (pendingCount === 1) {
      notifyPlatform(from, subject || "(No subject)");
    } else if (pendingCount > 1) {
      notifyPlatform("SuiteMail", `${pendingCount} new emails`);
    }
    pendingCount = 0;
    notifyTimer = null;
  }, 2000);
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
  notifyPlatform("Follow up needed", subject || "(No subject)");
}

/**
 * Show a notification for a snoozed email returning.
 */
export function notifySnoozeReturn(subject: string): void {
  if (!notificationsEnabled) return;
  notifyPlatform("Snoozed email returned", subject || "(No subject)");
}

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
