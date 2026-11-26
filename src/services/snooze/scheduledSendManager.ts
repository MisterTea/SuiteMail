import {
  claimScheduledEmail,
  failStaleScheduledSends,
  getPendingScheduledEmails,
  getScheduledEmailsMissingRawMime,
  insertScheduledEmail,
  setScheduledEmailRawMime,
  updateScheduledEmailStatus,
  type NewScheduledEmail,
} from "../db/scheduledEmails";
import { getGmailClient } from "../gmail/tokenManager";
import { buildRawEmail, type EmailAttachment } from "@/utils/emailBuilder";
import { getAccount } from "../db/accounts";
import { createBackgroundChecker } from "../backgroundCheckers";
import { hasNativeScheduledSend, runNativeScheduledSends } from "./nativeScheduledSend";

/**
 * Next occurrence of a recurring scheduled email, in the device's local time.
 * The native senders (ScheduledSendRules.java, BackgroundMail.swift) implement
 * the same rules; keep them in step.
 */
export function calculateNextScheduledOccurrence(
  currentTimestamp: number,
  rule: string,
): number {
  const date = new Date(currentTimestamp * 1000);
  switch (rule.toLowerCase()) {
    case "daily": {
      date.setDate(date.getDate() + 1);
      break;
    }
    case "weekdays": {
      do {
        date.setDate(date.getDate() + 1);
      } while (date.getDay() === 0 || date.getDay() === 6);
      break;
    }
    case "weekly": {
      date.setDate(date.getDate() + 7);
      break;
    }
    case "monthly": {
      date.setMonth(date.getMonth() + 1);
      break;
    }
    default: {
      date.setDate(date.getDate() + 7);
      break;
    }
  }
  return Math.floor(date.getTime() / 1000);
}

const splitAddresses = (value: string | null | undefined) =>
  value ? value.split(",").map((a) => a.trim()).filter(Boolean) : undefined;

/**
 * Build the base64url MIME for a scheduled email. It is stored with the row so
 * the Android/iOS background jobs can send it without running JS; they replace
 * the Date and Message-ID headers at send time.
 */
export function buildScheduledRawMime(email: NewScheduledEmail, accountEmail: string): string {
  let attachments: EmailAttachment[] | undefined;
  if (email.attachmentPaths) {
    try {
      attachments = JSON.parse(email.attachmentPaths) as EmailAttachment[];
    } catch {
      console.warn("Failed to parse attachments for a scheduled email");
    }
  }
  return buildRawEmail({
    from: email.fromAddress ?? accountEmail,
    to: splitAddresses(email.toAddresses) ?? [],
    cc: splitAddresses(email.ccAddresses),
    bcc: splitAddresses(email.bccAddresses),
    subject: email.subject ?? "",
    htmlBody: email.bodyHtml,
    threadId: email.threadId ?? undefined,
    inReplyTo: email.replyToMessageId ?? undefined,
    attachments,
  });
}

type ScheduledRow = Awaited<ReturnType<typeof getPendingScheduledEmails>>[number];

function toNewScheduledEmail(email: ScheduledRow): NewScheduledEmail {
  return {
    accountId: email.account_id,
    fromAddress: email.from_address,
    toAddresses: email.to_addresses,
    ccAddresses: email.cc_addresses,
    bccAddresses: email.bcc_addresses,
    subject: email.subject,
    bodyHtml: email.body_html,
    replyToMessageId: email.reply_to_message_id,
    threadId: email.thread_id,
    scheduledAt: email.scheduled_at,
    signatureId: email.signature_id,
    attachmentPaths: email.attachment_paths,
    recurrenceRule: email.recurrence_rule,
  };
}

/** Rows scheduled before raw_mime existed can't be sent natively until JS builds their MIME. */
export async function prepareScheduledRawMime(): Promise<void> {
  for (const email of await getScheduledEmailsMissingRawMime()) {
    const account = await getAccount(email.account_id);
    if (!account) continue;
    try {
      await setScheduledEmailRawMime(email.id, buildScheduledRawMime(toNewScheduledEmail(email), account.email));
    } catch (err) {
      console.warn(`Failed to prepare scheduled email ${email.id}:`, err);
    }
  }
}

/**
 * Desktop sender. Android and iOS send scheduled mail only from the native
 * background job (see checkNativeScheduledEmails).
 */
export async function checkScheduledEmails(): Promise<void> {
  await failStaleScheduledSends();
  const pending = await getPendingScheduledEmails();

  for (const email of pending) {
    // Atomic pending → sending claim; whoever loses the race skips the row.
    if (!await claimScheduledEmail(email.id)) continue;
    try {
      const account = await getAccount(email.account_id);
      if (!account) {
        await updateScheduledEmailStatus(email.id, "failed");
        continue;
      }

      const client = await getGmailClient(email.account_id);
      const raw = buildScheduledRawMime(toNewScheduledEmail(email), account.email);

      await client.sendMessage(raw, email.thread_id ?? undefined);
      await updateScheduledEmailStatus(email.id, "sent");

      // Auto-schedule next occurrence if recurring
      if (email.recurrence_rule && email.recurrence_rule !== "none") {
        const next: NewScheduledEmail = {
          ...toNewScheduledEmail(email),
          scheduledAt: calculateNextScheduledOccurrence(email.scheduled_at, email.recurrence_rule),
        };
        await insertScheduledEmail({ ...next, rawMime: buildScheduledRawMime(next, account.email) });
      }
    } catch (err) {
      console.error(`Failed to send scheduled email ${email.id}:`, err);
      // Distinguish transient vs permanent errors
      const message = err instanceof Error ? err.message : String(err);
      const isTransient = message.includes("5") && /\b5\d{2}\b/.test(message)
        || message.toLowerCase().includes("network")
        || message.toLowerCase().includes("timeout")
        || message.toLowerCase().includes("econnrefused");
      // Revert to pending for transient errors (allows retry), mark failed for permanent
      await updateScheduledEmailStatus(email.id, isTransient ? "pending" : "failed");
    }
  }
}

/**
 * Android/iOS: the native background sender is the only code path that sends
 * scheduled mail. The OS doesn't run it while the app is in the foreground, so
 * the app asks it to run on this interval and whenever it comes back to the
 * foreground.
 */
export async function checkNativeScheduledEmails(): Promise<void> {
  await prepareScheduledRawMime();
  await runNativeScheduledSends();
}

const runOnResume = () => {
  if (document.visibilityState === "visible") void scheduledSendChecker.run();
};

const scheduledSendChecker = (() => {
  const run = () => (hasNativeScheduledSend() ? checkNativeScheduledEmails() : checkScheduledEmails())
    .catch((err) => console.error("[ScheduledSend] check failed:", err));
  const interval = createBackgroundChecker("ScheduledSend", run);
  return {
    run,
    start() {
      interval.start();
      if (hasNativeScheduledSend()) document.addEventListener("visibilitychange", runOnResume);
    },
    stop() {
      interval.stop();
      document.removeEventListener("visibilitychange", runOnResume);
    },
  };
})();

export const startScheduledSendChecker = scheduledSendChecker.start;
export const stopScheduledSendChecker = scheduledSendChecker.stop;
