import { getMessagesForThread } from "@/services/db/messages";
import type { AffectedEmail, ConsentRequest, EmailDetails, ConsentType } from "./types";

/**
 * Fetch a summary of affected emails for a set of thread IDs.
 */
export async function getAffectedEmailsSummary(
  accountId: string,
  threadIds: string[],
): Promise<AffectedEmail[]> {
  const affected: AffectedEmail[] = [];

  for (const tid of threadIds) {
    try {
      const messages = await getMessagesForThread(accountId, tid);
      if (messages.length > 0) {
        // Take the latest message for subject and sender info
        const latest = messages[messages.length - 1];
        if (latest) {
          affected.push({
            id: latest.id,
            threadId: tid,
            subject: latest.subject || "(no subject)",
            sender: latest.from_name
              ? `${latest.from_name} <${latest.from_address}>`
              : latest.from_address || "Unknown",
            date: latest.date,
            snippet: latest.snippet || undefined,
          });
          continue;
        }
      }
    } catch {
      // Fallback below
    }

    affected.push({
      id: tid,
      threadId: tid,
      subject: `Thread ${tid}`,
      sender: "Unknown",
      date: Date.now(),
    });
  }

  return affected;
}

/**
 * Build a ConsentRequest object for a tool invocation.
 */
export async function buildConsentRequest(
  toolName: string,
  args: Record<string, unknown>,
  accountId: string,
): Promise<ConsentRequest> {
  const id = `consent-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  if (toolName === "send_email") {
    const to = Array.isArray(args.to)
      ? (args.to as string[])
      : typeof args.to === "string"
        ? [args.to]
        : [];
    const subject = typeof args.subject === "string" ? args.subject : "(no subject)";
    const body = typeof args.body === "string" ? args.body : "";
    const cc = Array.isArray(args.cc)
      ? (args.cc as string[])
      : typeof args.cc === "string"
        ? [args.cc]
        : undefined;
    const bcc = Array.isArray(args.bcc)
      ? (args.bcc as string[])
      : typeof args.bcc === "string"
        ? [args.bcc]
        : undefined;
    const threadId = typeof args.thread_id === "string" ? args.thread_id : undefined;

    return {
      id,
      type: "send_email",
      tool: toolName,
      title: "Confirm Sending Email",
      description: `The AI agent wants to send an email to ${to.join(", ")}`,
      args,
      emails: [
        {
          to,
          subject,
          body,
          cc,
          bcc,
          threadId,
        },
      ],
    };
  }

  if (toolName === "batch_send_emails") {
    const rawEmails = Array.isArray(args.emails) ? args.emails : [];
    const emails: EmailDetails[] = rawEmails.map((item: any) => ({
      to: Array.isArray(item.to) ? item.to : typeof item.to === "string" ? [item.to] : [],
      subject: typeof item.subject === "string" ? item.subject : "(no subject)",
      body: typeof item.body === "string" ? item.body : "",
      cc: Array.isArray(item.cc) ? item.cc : typeof item.cc === "string" ? [item.cc] : undefined,
      bcc: Array.isArray(item.bcc) ? item.bcc : typeof item.bcc === "string" ? [item.bcc] : undefined,
      threadId: typeof item.thread_id === "string" ? item.thread_id : undefined,
    }));

    return {
      id,
      type: "batch_send_emails",
      tool: toolName,
      title: `Confirm Sending Batch (${emails.length} Emails)`,
      description: `The AI agent wants to send a batch of ${emails.length} email(s)`,
      args,
      emails,
    };
  }

  if (toolName === "move_emails") {
    const threadIds = Array.isArray(args.thread_ids)
      ? (args.thread_ids as string[])
      : typeof args.thread_id === "string"
        ? [args.thread_id]
        : [];
    const folder = typeof args.folder === "string" ? args.folder.trim() : "";
    const affectedEmails = await getAffectedEmailsSummary(accountId, threadIds);

    return {
      id,
      type: "move_emails",
      tool: toolName,
      title: `Confirm Moving ${threadIds.length} Email(s)`,
      description: `The AI agent wants to move ${threadIds.length} email thread(s) to folder "${folder}"`,
      args,
      affectedEmails,
      changes: {
        action: "move",
        targetFolder: folder,
      },
    };
  }

  if (toolName === "relabel_emails") {
    const threadIds = Array.isArray(args.thread_ids)
      ? (args.thread_ids as string[])
      : typeof args.thread_id === "string"
        ? [args.thread_id]
        : [];
    const addLabels = Array.isArray(args.add_labels)
      ? (args.add_labels as string[])
      : typeof args.add_label === "string"
        ? [args.add_label]
        : [];
    const removeLabels = Array.isArray(args.remove_labels)
      ? (args.remove_labels as string[])
      : typeof args.remove_label === "string"
        ? [args.remove_label]
        : [];
    const affectedEmails = await getAffectedEmailsSummary(accountId, threadIds);

    return {
      id,
      type: "relabel_emails",
      tool: toolName,
      title: `Confirm Relabeling ${threadIds.length} Email(s)`,
      description: `The AI agent wants to modify labels on ${threadIds.length} email thread(s)`,
      args,
      affectedEmails,
      changes: {
        action: "relabel",
        addLabels,
        removeLabels,
      },
    };
  }

  if (toolName === "delete_emails") {
    const threadIds = Array.isArray(args.thread_ids)
      ? (args.thread_ids as string[])
      : typeof args.thread_id === "string"
        ? [args.thread_id]
        : [];
    const permanent = Boolean(args.permanent);
    const affectedEmails = await getAffectedEmailsSummary(accountId, threadIds);

    return {
      id,
      type: "delete_emails",
      tool: toolName,
      title: permanent
        ? `Confirm Permanently Deleting ${threadIds.length} Email(s)`
        : `Confirm Moving ${threadIds.length} Email(s) to Trash`,
      description: permanent
        ? `The AI agent wants to permanently delete ${threadIds.length} email thread(s)`
        : `The AI agent wants to move ${threadIds.length} email thread(s) to Trash`,
      args,
      affectedEmails,
      changes: {
        action: "delete",
        permanent,
      },
    };
  }

  // Generic mutable tool fallback
  return {
    id,
    type: "custom" as ConsentType,
    tool: toolName,
    title: `Confirm Action: ${toolName}`,
    description: `The AI agent wants to execute mutable operation '${toolName}'`,
    args,
  };
}
