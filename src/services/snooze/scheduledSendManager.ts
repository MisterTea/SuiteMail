import {
  getPendingScheduledEmails,
  updateScheduledEmailStatus,
  insertScheduledEmail,
} from "../db/scheduledEmails";
import { getGmailClient } from "../gmail/tokenManager";
import { buildRawEmail, type EmailAttachment } from "@/utils/emailBuilder";
import { getAccount } from "../db/accounts";
import { createBackgroundChecker } from "../backgroundCheckers";

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

/**
 * Check for scheduled emails that are ready to be sent.
 */
async function checkScheduledEmails(): Promise<void> {
  const pending = await getPendingScheduledEmails();

  for (const email of pending) {
    try {
      const account = await getAccount(email.account_id);
      if (!account) {
        await updateScheduledEmailStatus(email.id, "failed");
        continue;
      }

      // Mark as "sending" BEFORE attempting send to prevent duplicate sends
      await updateScheduledEmailStatus(email.id, "sending");

      const client = await getGmailClient(email.account_id);

      // Parse attachments from JSON if present
      let attachments: EmailAttachment[] | undefined;
      if (email.attachment_paths) {
        try {
          attachments = JSON.parse(email.attachment_paths) as EmailAttachment[];
        } catch {
          console.warn(`Failed to parse attachment_paths for scheduled email ${email.id}`);
        }
      }

      const raw = buildRawEmail({
        from: email.from_address ?? account.email,
        to: email.to_addresses.split(",").map((a) => a.trim()),
        cc: email.cc_addresses
          ? email.cc_addresses.split(",").map((a) => a.trim())
          : undefined,
        bcc: email.bcc_addresses
          ? email.bcc_addresses.split(",").map((a) => a.trim())
          : undefined,
        subject: email.subject ?? "",
        htmlBody: email.body_html,
        threadId: email.thread_id ?? undefined,
        inReplyTo: email.reply_to_message_id ?? undefined,
        attachments,
      });

      await client.sendMessage(raw, email.thread_id ?? undefined);
      await updateScheduledEmailStatus(email.id, "sent");

      // Auto-schedule next occurrence if recurring
      if (email.recurrence_rule && email.recurrence_rule !== "none") {
        const nextTimestamp = calculateNextScheduledOccurrence(
          email.scheduled_at,
          email.recurrence_rule,
        );
        await insertScheduledEmail({
          accountId: email.account_id,
          fromAddress: email.from_address,
          toAddresses: email.to_addresses,
          ccAddresses: email.cc_addresses,
          bccAddresses: email.bcc_addresses,
          subject: email.subject,
          bodyHtml: email.body_html,
          replyToMessageId: email.reply_to_message_id,
          threadId: email.thread_id,
          scheduledAt: nextTimestamp,
          signatureId: email.signature_id,
          attachmentPaths: email.attachment_paths,
          recurrenceRule: email.recurrence_rule,
        });
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

const scheduledSendChecker = createBackgroundChecker("ScheduledSend", checkScheduledEmails);
export const startScheduledSendChecker = scheduledSendChecker.start;
export const stopScheduledSendChecker = scheduledSendChecker.stop;
