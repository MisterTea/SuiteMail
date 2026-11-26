import { addSettingChangeListener, getSetting } from "../db/settings";
import { useComposerStore } from "../../stores/composerStore";
import { navigateToLabel } from "../../router/navigate";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { getDb } from "../db/connection";
import { getMessagesForThread } from "../db/messages";
import { getThreadById } from "../db/threads";
import { getVipSenders } from "../db/notificationVips";
import { useAccountStore } from "@/stores/accountStore";
import { getAccountNotificationPreferences, isDuringQuietHours } from "./notificationPreferences";
import { createBackgroundChecker } from "../backgroundCheckers";
import { normalizeEmail } from "@/utils/emailUtils";
import { isNoReplyAddress } from "@/utils/noReply";

let nextNotificationId = Date.now() % 1_000_000_000;
const SUMMARY_TIMEOUT_MS = 5_000;

export type AndroidNotificationActionType = "archive" | "mark_read" | "reply";

export interface AndroidNotificationActionEvent {
  id?: string;
  action: AndroidNotificationActionType;
  replyText?: string;
  context?: NotificationContext;
}

interface AndroidMailNotificationsPlugin {
  showNotification(options: {
    id: number;
    title: string;
    body: string;
    largeBody?: string;
    timestamp?: number;
    group?: string;
    groupTitle?: string;
    extra?: NotificationContext;
    smartReplies?: string[];
  }): Promise<void>;
  getPendingNotificationActions?(): Promise<{ actions: AndroidNotificationActionEvent[] }>;
  acknowledgeNotificationAction?(options: { id: string }): Promise<void>;
  addListener(
    eventName: "mailNotificationOpened",
    listenerFunc: (context: NotificationContext) => void,
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    eventName: "mailNotificationAction",
    listenerFunc: (event: AndroidNotificationActionEvent) => void,
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
  const platform = Capacitor.getPlatform();
  if (platform === "android" || platform === "ios") {
    const current = await LocalNotifications.checkPermissions();
    return (current.display === "granted" ? current : await LocalNotifications.requestPermissions()).display === "granted";
  }
  if (typeof Notification === "undefined") return false;
  return Notification.permission === "granted" || (Notification.permission === "default" && await Notification.requestPermission() === "granted");
}

async function getNotificationSummary(accountId: string, threadId: string, signal: AbortSignal): Promise<string | null> {
  const { getMailboxAiBoolean } = await import("../ai/mailboxAiSettings");
  if (!(await getMailboxAiBoolean("ai_auto_summarize", accountId)) || signal.aborted) return null;
  const { isAiAvailable } = await import("../ai/providerManager");
  const available = !signal.aborted && await isAiAvailable(accountId);
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

async function getNotificationSmartReplies(context?: NotificationContext): Promise<string[]> {
  if (!context?.accountId || !context.threadId) return [];
  if (isNoReplyAddress(context.fromAddress ?? null)) return [];

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const fetchReplies = async (): Promise<string[]> => {
      const { isAiAvailable } = await import("../ai/providerManager");
      if (!(await isAiAvailable(context.accountId))) return [];
      const aiService = await import("../ai/aiService");
      if (typeof aiService.generateSmartReplies !== "function") return [];
      const messages = await getMessagesForThread(context.accountId!, context.threadId!);
      if (!messages || messages.length === 0) return [];
      const replies = await aiService.generateSmartReplies(context.threadId!, context.accountId!, messages);
      return Array.isArray(replies)
        ? replies.map((r) => r.trim()).filter(Boolean).slice(0, 3)
        : [];
    };
    const timeout = new Promise<string[]>((resolve) => {
      timer = setTimeout(() => resolve([]), SUMMARY_TIMEOUT_MS);
    });
    return await Promise.race([
      fetchReplies().catch(() => []),
      timeout,
    ]);
  } catch {
    return [];
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
  const accountId = context?.accountId;
  const group = accountId ? `mailbox:${accountId}` : undefined;
  const groupTitle = accountId
    ? useAccountStore.getState().accounts.find((account) => account.id === accountId)?.email
    : undefined;
  try {
    const platform = Capacitor.getPlatform();
    if (platform === "android" || platform === "ios") {
      if ((await LocalNotifications.checkPermissions()).display !== "granted") return;
      const preview = snippet === undefined ? "" : await getNotificationPreview(snippet, context);
      const smartReplies = platform === "android" && snippet !== undefined ? await getNotificationSmartReplies(context) : [];
      if (!notificationsEnabled) return;
      const formattedBody = preview ? `${body} — ${preview}` : body;
      const largeBody = preview ? `${body}\n${preview}` : undefined;
      if (platform === "android") {
        const nativeNotifications = getAndroidMailNotifications();
        if (nativeNotifications?.showNotification) {
          await nativeNotifications.showNotification({
            id: ++nextNotificationId,
            title,
            body: formattedBody,
            ...(largeBody ? { largeBody } : {}),
            ...(when !== undefined ? { timestamp: when } : {}),
            group,
            groupTitle,
            extra: context ?? {},
            ...(smartReplies.length > 0 ? { smartReplies } : {}),
          });
          return;
        }
      }
      await LocalNotifications.schedule({ notifications: [
        {
          id: ++nextNotificationId,
          title,
          body: formattedBody,
          ...(largeBody ? { largeBody } : {}),
          ...(platform === "android" ? { smallIcon: "ic_launcher_foreground", isExactNotification: false } : {}),
          group,
          extra: context ?? {},
        },
      ] });
    } else if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      const desktop = typeof window !== "undefined" ? window.supermail : undefined;
      if (group && desktop?.isElectron && desktop.invoke && desktop.on
        && await desktop.invoke<boolean>("show_grouped_mail_notification", {
          title, body, group, groupTitle, accountId, threadId: context?.threadId,
        })) return;

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
  const platform = Capacitor.getPlatform();
  if (platform === "android" || platform === "ios") {
    if (platform === "android") {
      const nativeNotifications = getAndroidMailNotifications();
      if (nativeNotifications?.addListener) {
        await nativeNotifications.addListener("mailNotificationOpened", (context) => {
          openNotification(context);
        }).catch((error) => console.warn("Could not listen for mail notification clicks", error));
        await nativeNotifications.addListener("mailNotificationAction", (event) => {
          void handleAndroidNotificationAction(event);
        }).catch((error) => console.warn("Could not listen for mail notification actions", error));
      }
      if (nativeNotifications?.getPendingNotificationActions) {
        void nativeNotifications.getPendingNotificationActions()
          .then(({ actions }) => {
            for (const event of actions ?? []) {
              void handleAndroidNotificationAction(event);
            }
          })
          .catch((error) => console.warn("Could not load pending mail notification actions", error));
      }
    }
    await LocalNotifications.addListener("localNotificationActionPerformed", ({ notification }) => {
      openNotification(notification.extra as NotificationContext | undefined);
    }).catch((error) => console.warn("Could not listen for mail notification clicks", error));
  } else if (typeof window !== "undefined" && window.supermail?.isElectron) {
    window.supermail.on?.("supermail:mail-notification-opened", (context) => {
      openNotification(context as NotificationContext);
    });
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
interface PendingMailBatch {
  count: number;
  timestamp?: number;
}

const pendingMailBatches = new Map<string | undefined, PendingMailBatch>();

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

    const ctx = { threadId, accountId, fromAddress, subject };
    lastNotificationContext = ctx;
    const emailTimestamp = normalizeNotificationTimestamp(timestamp);
    const batch = pendingMailBatches.get(accountId);
    if (batch) {
      batch.count++;
      if (emailTimestamp !== undefined && (batch.timestamp === undefined || emailTimestamp > batch.timestamp)) {
        batch.timestamp = emailTimestamp;
      }
      return;
    }

    const newBatch = { count: 1, timestamp: emailTimestamp };
    pendingMailBatches.set(accountId, newBatch);
    setTimeout(() => {
      pendingMailBatches.delete(accountId);
      const { count, timestamp: when } = newBatch;
      if (count === 1) {
        void notifyPlatform(from, subject || "(No subject)", ctx, snippet, when);
      } else {
        const account = useAccountStore.getState().accounts.find((account) => account.id === accountId);
        void notifyPlatform(account?.email ?? "SuiteMail", `${count} new emails`, { accountId }, undefined, when);
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

const handledNotificationActions = new Set<string>();

function rememberHandledAction(id: string): boolean {
  if (handledNotificationActions.has(id)) return false;
  handledNotificationActions.add(id);
  if (handledNotificationActions.size > 100) {
    const oldest = handledNotificationActions.values().next().value;
    if (oldest) handledNotificationActions.delete(oldest);
  }
  return true;
}

async function resolveAccountEmail(accountId: string): Promise<string | null> {
  const inStore = useAccountStore.getState().accounts.find((account) => account.id === accountId);
  if (inStore?.email) return inStore.email;
  try {
    const { getAllAccounts } = await import("../db/accounts");
    const accounts = await getAllAccounts();
    return accounts.find((account) => account.id === accountId)?.email ?? null;
  } catch {
    return null;
  }
}

export async function handleAndroidNotificationAction(event: AndroidNotificationActionEvent): Promise<void> {
  if (event.id && !rememberHandledAction(event.id)) return;

  const nativeNotifications = getAndroidMailNotifications();
  const acknowledge = () => {
    if (event.id && nativeNotifications?.acknowledgeNotificationAction) {
      void nativeNotifications.acknowledgeNotificationAction({ id: event.id }).catch(() => {});
    }
  };

  const accountId = event.context?.accountId;
  const threadId = event.context?.threadId;
  if (!accountId || !threadId) {
    acknowledge();
    return;
  }

  try {
    const messages = await getMessagesForThread(accountId, threadId).catch(() => []);
    const messageIds = messages.map((m) => m.id);

    if (event.action === "archive") {
      const { archiveThread } = await import("../emailActions");
      await archiveThread(accountId, threadId, messageIds);
      return;
    }

    if (event.action === "mark_read") {
      const { markThreadRead } = await import("../emailActions");
      await markThreadRead(accountId, threadId, messageIds, true);
      return;
    }

    if (event.action === "reply") {
      const replyText = event.replyText?.trim();
      if (!replyText) return;

      const accountEmail = await resolveAccountEmail(accountId);
      if (!accountEmail) return;

      const lastMessage = messages[messages.length - 1];
      const recipient = lastMessage?.reply_to ?? lastMessage?.from_address ?? event.context?.fromAddress;
      if (!recipient) return;

      const rawSubject = lastMessage?.subject ?? event.context?.subject ?? "";
      const subject = /^re:/i.test(rawSubject) ? rawSubject : `Re: ${rawSubject}`;
      const { escapeHtml } = await import("../../utils/sanitize");
      let htmlBody = `<p>${escapeHtml(replyText).replace(/\r?\n/g, "<br>")}</p>`;
      try {
        const { getDefaultSignature } = await import("../db/signatures");
        const sig = await getDefaultSignature(accountId);
        if (sig?.body_html) {
          htmlBody += `<div style="margin-top:16px;border-top:1px solid #e5e5e5;padding-top:12px">${sig.body_html}</div>`;
        }
      } catch {
        // Ignore signature lookup errors
      }

      const inReplyTo = lastMessage?.message_id_header ?? lastMessage?.id ?? undefined;
      const referencesParts = [
        lastMessage?.references_header?.trim(),
        lastMessage?.message_id_header?.trim(),
      ].filter((part): part is string => Boolean(part));
      const references = referencesParts.length > 0 ? referencesParts.join(" ") : undefined;

      const { buildRawEmail } = await import("../../utils/emailBuilder");
      const raw = buildRawEmail({
        from: accountEmail,
        to: [recipient],
        subject,
        htmlBody,
        inReplyTo,
        references,
        threadId,
      });

      const { sendEmail, markThreadRead } = await import("../emailActions");
      const result = await sendEmail(accountId, raw, threadId);
      if (result.success) {
        try {
          await markThreadRead(accountId, threadId, messageIds, true);
        } catch {
          // Best-effort mark as read after replying
        }
        try {
          const { upsertContact } = await import("../db/contacts");
          await upsertContact(recipient, null);
        } catch {
          // Best-effort contact frequency update
        }
      }
    }
  } catch (error) {
    console.warn("Could not execute mail notification action", event.action, error);
  } finally {
    acknowledge();
  }
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
