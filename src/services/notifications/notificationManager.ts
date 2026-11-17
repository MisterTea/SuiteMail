import { isTauri } from "@/platform";
import { getSetting } from "../db/settings";
import { useComposerStore } from "../../stores/composerStore";
import { navigateToLabel } from "../../router/navigate";
import { normalizeEmail } from "@/utils/emailUtils";

async function notifyPlatform(title: string, body: string): Promise<void> {
  if (isTauri()) {
    try {
      const { sendNotification } = await import("@tauri-apps/plugin-notification");
      sendNotification({ title, body, actionTypeId: "email" });
      return;
    } catch {
      // Fall through to web Notification
    }
  }

  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification(title, { body });
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

async function showAndFocusMainWindow(): Promise<void> {
  if (isTauri()) {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const mainWindow = await WebviewWindow.getByLabel("main");
      if (mainWindow) {
        await mainWindow.show();
        await mainWindow.setFocus();
      }
    } catch {}
  } else if (typeof window !== "undefined") {
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

  if (isTauri()) {
    try {
      const { isPermissionGranted, requestPermission, registerActionTypes, onAction } = await import(
        "@tauri-apps/plugin-notification"
      );
      let granted = await isPermissionGranted();
      if (!granted) {
        const permission = await requestPermission();
        granted = permission === "granted";
      }

      if (!granted) {
        notificationsEnabled = false;
        return;
      }

      await registerActionTypes([
        { id: "default", actions: [] },
        {
          id: "email",
          actions: [
            { id: "reply", title: "Reply" },
            { id: "archive", title: "Archive" },
          ],
        },
      ]);

      await onAction(async (event) => {
        const actionId = event.actionTypeId;
        const ctx = lastNotificationContext;

        if (actionId === "reply" && ctx?.threadId && ctx?.accountId) {
          await showAndFocusMainWindow();
          useComposerStore.getState().openComposer({
            mode: "reply",
            threadId: ctx.threadId,
            to: ctx.fromAddress ? [ctx.fromAddress] : [],
            subject: ctx.subject ? `Re: ${ctx.subject.replace(/^Re:\s*/i, "")}` : "",
          });
        } else if (actionId === "archive" && ctx?.threadId && ctx?.accountId) {
          const { archiveThread } = await import("../emailActions");
          await archiveThread(ctx.accountId, ctx.threadId, []);
        } else if (ctx?.threadId) {
          await showAndFocusMainWindow();
          navigateToLabel("inbox", { threadId: ctx.threadId });
        }
      });
      return;
    } catch {}
  }

  if (typeof Notification !== "undefined" && Notification.permission !== "granted") {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        notificationsEnabled = false;
      }
    } catch {}
  }
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
  if (!smartEnabled) return true; // Smart notifications off → notify everything
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
