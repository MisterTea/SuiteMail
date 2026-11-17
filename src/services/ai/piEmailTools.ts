import type OpenAI from "openai";
import { getDb } from "@/services/db/connection";
import { buildSearchQuery } from "@/services/search/searchQueryBuilder";
import type { ParsedSearchQuery } from "@/services/search/searchParser";
import { getMessagesForThread, type DbMessage } from "@/services/db/messages";
import type { SearchResult } from "@/services/db/search";
import { buildRawEmail } from "@/utils/emailBuilder";
import { useAccountStore } from "@/stores/accountStore";
import {
  sendEmail,
  moveThread,
  trashThread,
  permanentDeleteThread,
  archiveThread,
  spamThread,
  addThreadLabel,
  removeThreadLabel,
} from "@/services/emailActions";
import {
  isMutableTool,
  MUTABLE_TOOLS,
  type ConsentRequest,
} from "./consent/types";
import { requestAgentConsent } from "./consent/consentStore";
import { buildConsentRequest } from "./consent/agentConsentHelper";

export { isMutableTool, MUTABLE_TOOLS };

export interface SearchEmailsArgs {
  query?: string;
  from?: string;
  to?: string;
  subject?: string;
  after?: string;
  before?: string;
  is_unread?: boolean;
  is_starred?: boolean;
  has_attachment?: boolean;
  limit?: number;
}

export interface GetThreadArgs {
  thread_id: string;
}

export interface GetEmailStatsArgs {
  type: "unread_count" | "total_count" | "top_senders" | "category_counts";
  days?: number;
}

export interface RunReadOnlySqlArgs {
  sql: string;
}

export interface ToolExecutionResult {
  text: string;
  data?: unknown;
  sourceMessages?: SearchResult[];
  consentRefused?: boolean;
}

export interface ExecutePiEmailToolOptions {
  onConsentRequest?: (request: ConsentRequest) => Promise<boolean>;
}

/**
 * Parse date string (YYYY-MM-DD or YYYY/MM/DD) to unix timestamp in seconds.
 */
export function parseDateString(dateStr: string): number | undefined {
  const normalized = dateStr.replace(/-/g, "/").trim();
  const parts = normalized.split("/");
  if (parts.length !== 3) return undefined;
  const year = parseInt(parts[0]!, 10);
  const month = parseInt(parts[1]!, 10);
  const day = parseInt(parts[2]!, 10);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return undefined;
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const date = new Date(year, month - 1, day);
  if (isNaN(date.getTime())) return undefined;
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return undefined;
  }
  return Math.floor(date.getTime() / 1000);
}

/**
 * Validate that an arbitrary SQL statement is strictly read-only and safe.
 */
export function isSafeReadOnlyQuery(sql: string): { safe: boolean; error?: string } {
  const trimmed = sql.trim();
  if (!trimmed) {
    return { safe: false, error: "Empty SQL query" };
  }
  // Must start with SELECT or WITH
  if (!/^(SELECT|WITH)\s+/i.test(trimmed)) {
    return { safe: false, error: "Only SELECT or WITH queries are permitted" };
  }
  // Disallow forbidden keywords that alter state or execute harmful commands
  const forbiddenPatterns = [
    /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE)\b/i,
    /\b(PRAGMA|ATTACH|DETACH|VACUUM|REINDEX|TRANSACTION|BEGIN|COMMIT|ROLLBACK)\b/i,
    /\b(EXEC|EXECUTE)\b/i,
    /;\s*\S/s, // multiple statements forbidden
  ];
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(trimmed)) {
      return { safe: false, error: `Forbidden operation detected in query: ${trimmed.match(pattern)?.[0]}` };
    }
  }
  return { safe: true };
}

/**
 * OpenAI tool specifications for Pi harness agent.
 */
export const PI_EMAIL_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_emails",
      description: "Search emails in the local SQLite database using full-text search (FTS5) and metadata filters (from, to, subject, dates, unread, etc.).",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Free text keywords to search across message bodies and subjects using SQLite FTS5.",
          },
          from: {
            type: "string",
            description: "Filter by sender email address or display name.",
          },
          to: {
            type: "string",
            description: "Filter by recipient email address.",
          },
          subject: {
            type: "string",
            description: "Filter by words in the email subject.",
          },
          after: {
            type: "string",
            description: "Start date filter in YYYY-MM-DD or YYYY/MM/DD format.",
          },
          before: {
            type: "string",
            description: "End date filter in YYYY-MM-DD or YYYY/MM/DD format.",
          },
          is_unread: {
            type: "boolean",
            description: "True for unread emails only, false for read emails only.",
          },
          is_starred: {
            type: "boolean",
            description: "Filter to starred emails.",
          },
          has_attachment: {
            type: "boolean",
            description: "Filter to emails with attachments.",
          },
          limit: {
            type: "number",
            description: "Maximum results to return (default 10, max 25).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "semantic_search_emails",
      description: "Perform semantic vector search to find emails by meaning, concept, or topic when exact keywords or synonyms may differ. Returns the most semantically relevant messages with similarity scores.",
      parameters: {
        type: "object",
        properties: {
          concept: {
            type: "string",
            description: "The concept, topic, or question to semantically match against emails.",
          },
          limit: {
            type: "number",
            description: "Maximum number of results to return (default 5, max 15).",
          },
        },
        required: ["concept"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_thread",
      description: "Retrieve the complete email thread history and message bodies for a specific thread ID.",
      parameters: {
        type: "object",
        properties: {
          thread_id: {
            type: "string",
            description: "The thread ID returned from search_emails.",
          },
        },
        required: ["thread_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_email_stats",
      description: "Get aggregated email statistics from SQLite, such as unread counts, total counts, top senders, or category distributions.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["unread_count", "total_count", "top_senders", "category_counts"],
            description: "Type of statistic to compute.",
          },
          days: {
            type: "number",
            description: "Lookback window in days (default 30).",
          },
        },
        required: ["type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_readonly_sql",
      description: "Execute a read-only SQLite SELECT statement against the local database for custom aggregations or relational queries.",
      parameters: {
        type: "object",
        properties: {
          sql: {
            type: "string",
            description: "A read-only SQLite SELECT statement.",
          },
        },
        required: ["sql"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_labels",
      description: "List all existing email labels (name, id, and type) available in this account.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_filter",
      description: "Propose a structured email filter rule matching the user's requirements.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "A short, descriptive name for the filter rule.",
          },
          newFolder: {
            type: "string",
            description: "Name of a new folder/label to create for the filtered emails to go to, if applicable.",
          },
          criteria: {
            type: "object",
            description: "Matching criteria. Leave unspecified if not part of the rule.",
            properties: {
              from: { type: "string", description: "Sender email address or display name substring." },
              to: { type: "string", description: "Recipient email address substring." },
              subject: { type: "string", description: "Subject text substring." },
              body: { type: "string", description: "Body text substring." },
              hasAttachment: { type: "boolean", description: "Whether the message must have attachments." },
            },
          },
          actions: {
            type: "object",
            description: "Actions to take on matching emails.",
            properties: {
              applyLabel: { type: "string", description: "Label name or label ID to apply." },
              archive: { type: "boolean", description: "Archive message (remove from INBOX)." },
              star: { type: "boolean", description: "Star the message." },
              markRead: { type: "boolean", description: "Mark message as read." },
              trash: { type: "boolean", description: "Move message to trash." },
            },
          },
          explanation: {
            type: "string",
            description: "A short explanation of how the filter achieves the user's intent.",
          },
        },
        required: ["name", "criteria", "actions"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_email",
      description: "Send an email. Note: This is a mutable operation that requires explicit user confirmation via a popover before sending.",
      parameters: {
        type: "object",
        properties: {
          to: {
            type: "array",
            items: { type: "string" },
            description: "List of recipient email addresses.",
          },
          subject: {
            type: "string",
            description: "Subject line of the email.",
          },
          body: {
            type: "string",
            description: "Body content of the email (plain text or formatted HTML).",
          },
          cc: {
            type: "array",
            items: { type: "string" },
            description: "Optional list of CC email addresses.",
          },
          bcc: {
            type: "array",
            items: { type: "string" },
            description: "Optional list of BCC email addresses.",
          },
          thread_id: {
            type: "string",
            description: "Optional thread ID if this email is a reply within an existing thread.",
          },
        },
        required: ["to", "subject", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "batch_send_emails",
      description: "Send a batch of multiple emails. Note: This mutable operation requires explicit user consent via a popover with all email details before sending.",
      parameters: {
        type: "object",
        properties: {
          emails: {
            type: "array",
            description: "Array of email objects to send.",
            items: {
              type: "object",
              properties: {
                to: {
                  type: "array",
                  items: { type: "string" },
                  description: "Recipient email addresses.",
                },
                subject: {
                  type: "string",
                  description: "Subject of the email.",
                },
                body: {
                  type: "string",
                  description: "Body content of the email.",
                },
                cc: {
                  type: "array",
                  items: { type: "string" },
                },
                bcc: {
                  type: "array",
                  items: { type: "string" },
                },
                thread_id: {
                  type: "string",
                },
              },
              required: ["to", "subject", "body"],
            },
          },
        },
        required: ["emails"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "move_emails",
      description: "Move one or more email threads to a folder (e.g. 'Archive', 'Trash', 'Spam', 'Inbox', or custom folder). Note: This is a mutable operation that requires explicit user consent showing the affected emails.",
      parameters: {
        type: "object",
        properties: {
          thread_ids: {
            type: "array",
            items: { type: "string" },
            description: "List of thread IDs to move.",
          },
          folder: {
            type: "string",
            description: "Destination folder name or mailbox path (e.g. 'Archive', 'Trash', 'Spam', 'Inbox').",
          },
        },
        required: ["thread_ids", "folder"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "relabel_emails",
      description: "Apply or remove labels on one or more email threads. Note: This is a mutable operation that requires explicit user consent showing the affected emails and label changes.",
      parameters: {
        type: "object",
        properties: {
          thread_ids: {
            type: "array",
            items: { type: "string" },
            description: "List of thread IDs to modify.",
          },
          add_labels: {
            type: "array",
            items: { type: "string" },
            description: "Labels to add to the threads.",
          },
          remove_labels: {
            type: "array",
            items: { type: "string" },
            description: "Labels to remove from the threads.",
          },
        },
        required: ["thread_ids"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_emails",
      description: "Delete one or more email threads (moves to Trash by default, or permanently deletes if permanent=true). Note: This is a mutable operation that requires explicit user consent.",
      parameters: {
        type: "object",
        properties: {
          thread_ids: {
            type: "array",
            items: { type: "string" },
            description: "List of thread IDs to delete.",
          },
          permanent: {
            type: "boolean",
            description: "Set to true to permanently delete. Defaults to false (moves to Trash).",
          },
        },
        required: ["thread_ids"],
      },
    },
  },
];

/**
 * Execute a Pi harness email tool against the local SQLite database.
 */
export async function executePiEmailTool(
  toolName: string,
  args: Record<string, unknown>,
  accountId: string,
  options?: ExecutePiEmailToolOptions,
): Promise<ToolExecutionResult> {
  switch (toolName) {
    case "search_emails": {
      const parsed: ParsedSearchQuery = {
        freeText: typeof args.query === "string" ? args.query.trim() : "",
      };
      if (typeof args.from === "string" && args.from.trim()) parsed.from = args.from.trim();
      if (typeof args.to === "string" && args.to.trim()) parsed.to = args.to.trim();
      if (typeof args.subject === "string" && args.subject.trim()) parsed.subject = args.subject.trim();
      if (typeof args.after === "string" && args.after.trim()) {
        const ts = parseDateString(args.after);
        if (ts !== undefined) parsed.after = ts;
      }
      if (typeof args.before === "string" && args.before.trim()) {
        const ts = parseDateString(args.before);
        if (ts !== undefined) parsed.before = ts;
      }
      if (typeof args.is_unread === "boolean") {
        if (args.is_unread) parsed.isUnread = true;
        else parsed.isRead = true;
      }
      if (typeof args.is_starred === "boolean" && args.is_starred) parsed.isStarred = true;
      if (typeof args.has_attachment === "boolean" && args.has_attachment) parsed.hasAttachment = true;

      const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 25);
      const { sql, params } = buildSearchQuery(parsed, accountId, limit);
      const db = await getDb();
      const rows = await db.select<SearchResult[]>(sql, params);

      if (rows.length === 0) {
        return { text: "No matching emails found in local database.", sourceMessages: [] };
      }

      const formatted = rows
        .map((r, i) => {
          const date = new Date(r.date > 1e11 ? r.date : r.date * 1000);
          const dateStr = date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          });
          const sender = r.from_name
            ? `${r.from_name} <${r.from_address}>`
            : (r.from_address ?? "Unknown");
          return `[${i + 1}] Message ID: ${r.message_id} | Thread ID: ${r.thread_id}\nFrom: ${sender}\nDate: ${dateStr}\nSubject: ${r.subject ?? "(no subject)"}\nSnippet: ${r.snippet ?? "(no preview)"}`;
        })
        .join("\n\n");

      return { text: formatted, sourceMessages: rows };
    }

    case "semantic_search_emails": {
      const concept = typeof args.concept === "string" ? args.concept.trim() : "";
      if (!concept) {
        return { text: "Error: concept is required for semantic search." };
      }
      const limit = Math.min(Math.max(1, typeof args.limit === "number" ? args.limit : 5), 15);
      const { searchSimilarMessages } = await import("./embeddingService");
      const results = await searchSimilarMessages(accountId, concept, limit);

      if (results.length === 0) {
        return { text: `No semantically similar emails found for concept: "${concept}". Try keyword search with search_emails.` };
      }

      const formatted = results
        .map((r, i) => {
          const date = new Date(r.date > 1e11 ? r.date : r.date * 1000);
          const dateStr = date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          });
          const sender = r.fromName
            ? `${r.fromName} <${r.fromAddress}>`
            : (r.fromAddress ?? "Unknown");
          return `[${i + 1}] Similarity: ${Math.round(r.similarityScore * 100)}% | Message ID: ${r.messageId} | Thread ID: ${r.threadId}\nFrom: ${sender}\nDate: ${dateStr}\nSubject: ${r.subject}\nSnippet: ${r.snippet ?? "(no preview)"}`;
        })
        .join("\n\n");

      const sourceMessages: SearchResult[] = results.map((r) => ({
        message_id: r.messageId,
        account_id: accountId,
        thread_id: r.threadId,
        subject: r.subject,
        from_name: r.fromName,
        from_address: r.fromAddress,
        snippet: r.snippet,
        date: r.date,
        rank: -r.similarityScore,
      }));

      return { text: formatted, sourceMessages, data: results };
    }

    case "get_thread": {
      const threadId = typeof args.thread_id === "string" ? args.thread_id.trim() : "";
      if (!threadId) {
        return { text: "Error: thread_id is required." };
      }

      const messages: DbMessage[] = await getMessagesForThread(accountId, threadId);
      if (messages.length === 0) {
        return { text: `No messages found for thread ID: ${threadId}` };
      }

      const formatted = messages
        .map((m, idx) => {
          const date = new Date(m.date > 1e11 ? m.date : m.date * 1000);
          const dateStr = date.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
          const sender = m.from_name
            ? `${m.from_name} <${m.from_address}>`
            : (m.from_address ?? "Unknown");
          let body = m.body_text?.trim();
          if (!body && m.snippet) body = m.snippet;
          if (!body && m.body_html) {
            body = m.body_html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          }
          if (body && body.length > 2500) {
            body = body.slice(0, 2500) + "... [truncated]";
          }
          return `--- Message ${idx + 1} of ${messages.length} (ID: ${m.id}) ---\nFrom: ${sender}\nTo: ${m.to_addresses ?? ""}\nDate: ${dateStr}\nSubject: ${m.subject ?? "(no subject)"}\n\n${body ?? "(empty body)"}`;
        })
        .join("\n\n");

      return { text: formatted, data: messages };
    }

    case "get_email_stats": {
      const type = args.type as string;
      const db = await getDb();

      if (type === "unread_count") {
        const unreadMessages = await db.select<{ count: number }[]>(
          "SELECT COUNT(*) as count FROM messages WHERE account_id = $1 AND is_read = 0",
          [accountId],
        );
        const unreadThreads = await db.select<{ count: number }[]>(
          "SELECT COUNT(*) as count FROM threads WHERE account_id = $1 AND is_read = 0",
          [accountId],
        );
        return {
          text: JSON.stringify(
            {
              unread_messages: unreadMessages[0]?.count ?? 0,
              unread_threads: unreadThreads[0]?.count ?? 0,
            },
            null,
            2,
          ),
        };
      }

      if (type === "total_count") {
        const totalMessages = await db.select<{ count: number }[]>(
          "SELECT COUNT(*) as count FROM messages WHERE account_id = $1",
          [accountId],
        );
        const totalThreads = await db.select<{ count: number }[]>(
          "SELECT COUNT(*) as count FROM threads WHERE account_id = $1",
          [accountId],
        );
        return {
          text: JSON.stringify(
            {
              total_messages: totalMessages[0]?.count ?? 0,
              total_threads: totalThreads[0]?.count ?? 0,
            },
            null,
            2,
          ),
        };
      }

      if (type === "top_senders") {
        const days = Math.min(Math.max(Number(args.days) || 30, 1), 365);
        const cutoffSec = Math.floor(Date.now() / 1000) - days * 86400;
        const cutoffMs = Date.now() - days * 86400 * 1000;
        const rows = await db.select<{ from_address: string; from_name: string | null; count: number }[]>(
          `SELECT from_address, from_name, COUNT(*) as count
           FROM messages
           WHERE account_id = $1 AND (date > $2 OR date > $3)
           GROUP BY from_address
           ORDER BY count DESC
           LIMIT 10`,
          [accountId, cutoffSec, cutoffMs],
        );
        return { text: JSON.stringify(rows, null, 2), data: rows };
      }

      if (type === "category_counts") {
        const rows = await db.select<{ category: string; count: number }[]>(
          `SELECT category, COUNT(*) as count
           FROM thread_categories
           WHERE account_id = $1
           GROUP BY category`,
          [accountId],
        );
        return { text: JSON.stringify(rows, null, 2), data: rows };
      }

      return { text: `Unknown stats type: ${type}` };
    }

    case "run_readonly_sql": {
      const sql = typeof args.sql === "string" ? args.sql : "";
      const check = isSafeReadOnlyQuery(sql);
      if (!check.safe) {
        return { text: `Query rejected: ${check.error}` };
      }

      let query = sql.trim().replace(/;+$/, "");
      if (!/\bLIMIT\s+\d+/i.test(query)) {
        query += " LIMIT 50";
      }

      const db = await getDb();
      try {
        const rows = await db.select<Record<string, unknown>[]>(query);
        if (rows.length === 0) {
          return { text: "Query returned 0 rows.", data: [] };
        }
        return { text: JSON.stringify(rows, null, 2), data: rows };
      } catch (err) {
        return { text: `SQL execution error: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    case "list_labels": {
      const db = await getDb();
      try {
        const rows = await db.select<{ id: string; name: string; type: string }[]>(
          "SELECT id, name, type FROM labels WHERE account_id = $1 ORDER BY name ASC",
          [accountId],
        );
        return { text: JSON.stringify(rows, null, 2), data: rows };
      } catch (err) {
        return { text: `Failed to list labels: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    case "suggest_filter": {
      return {
        text: "Filter suggestion captured successfully.",
        data: args,
      };
    }

    case "send_email": {
      const to = Array.isArray(args.to)
        ? (args.to as string[])
        : typeof args.to === "string"
          ? [args.to]
          : [];
      if (to.length === 0) {
        return { text: "Error: 'to' recipient email address is required." };
      }
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

      const consentRequest = await buildConsentRequest("send_email", args, accountId);
      const granted = options?.onConsentRequest
        ? await options.onConsentRequest(consentRequest)
        : await requestAgentConsent(consentRequest);

      if (!granted) {
        return {
          text: `Consent was refused by the user for sending email to ${to.join(", ")}. Action was cancelled.`,
          consentRefused: true,
        };
      }

      try {
        let fromAddress: string | undefined;
        try {
          const account = useAccountStore.getState().accounts.find((a) => a.id === accountId);
          fromAddress = account?.email;
        } catch {
          // ignore
        }

        const raw = buildRawEmail({
          from: fromAddress || "me",
          to,
          cc,
          bcc,
          subject,
          htmlBody: body.includes("<") && body.includes(">") ? body : `<p>${body.replace(/\n/g, "<br/>")}</p>`,
          threadId,
        });

        const sendResult = await sendEmail(accountId, raw, threadId);
        if (!sendResult.success) {
          return { text: `Failed to send email: ${sendResult.error ?? "Unknown error"}` };
        }
        return { text: `Email sent successfully to ${to.join(", ")}.` };
      } catch (err) {
        return { text: `Error sending email: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    case "batch_send_emails": {
      const rawEmails = Array.isArray(args.emails) ? (args.emails as Record<string, unknown>[]) : [];
      if (rawEmails.length === 0) {
        return { text: "Error: 'emails' list cannot be empty for batch send." };
      }

      const consentRequest = await buildConsentRequest("batch_send_emails", args, accountId);
      const granted = options?.onConsentRequest
        ? await options.onConsentRequest(consentRequest)
        : await requestAgentConsent(consentRequest);

      if (!granted) {
        return {
          text: `Consent was refused by the user for sending a batch of ${rawEmails.length} emails. Action was cancelled.`,
          consentRefused: true,
        };
      }

      let fromAddress: string | undefined;
      try {
        const account = useAccountStore.getState().accounts.find((a) => a.id === accountId);
        fromAddress = account?.email;
      } catch {
        // ignore
      }

      let sentCount = 0;
      const errors: string[] = [];
      for (const item of rawEmails) {
        const to = Array.isArray(item.to) ? (item.to as string[]) : typeof item.to === "string" ? [item.to] : [];
        const subject = typeof item.subject === "string" ? item.subject : "(no subject)";
        const body = typeof item.body === "string" ? item.body : "";
        const cc = Array.isArray(item.cc) ? (item.cc as string[]) : typeof item.cc === "string" ? [item.cc] : undefined;
        const bcc = Array.isArray(item.bcc) ? (item.bcc as string[]) : typeof item.bcc === "string" ? [item.bcc] : undefined;
        const threadId = typeof item.thread_id === "string" ? item.thread_id : undefined;

        try {
          const raw = buildRawEmail({
            from: fromAddress || "me",
            to,
            cc,
            bcc,
            subject,
            htmlBody: body.includes("<") && body.includes(">") ? body : `<p>${body.replace(/\n/g, "<br/>")}</p>`,
            threadId,
          });
          const res = await sendEmail(accountId, raw, threadId);
          if (res.success) {
            sentCount++;
          } else {
            errors.push(`Failed sending to ${to.join(", ")}: ${res.error}`);
          }
        } catch (e) {
          errors.push(`Failed sending to ${to.join(", ")}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      if (errors.length > 0) {
        return { text: `Sent ${sentCount} of ${rawEmails.length} emails. Errors:\n${errors.join("\n")}` };
      }
      return { text: `Successfully sent all ${sentCount} emails in the batch.` };
    }

    case "move_emails": {
      const threadIds = Array.isArray(args.thread_ids)
        ? (args.thread_ids as string[])
        : typeof args.thread_id === "string"
          ? [args.thread_id]
          : [];
      const folder = typeof args.folder === "string" ? args.folder.trim() : "";
      if (threadIds.length === 0 || !folder) {
        return { text: "Error: 'thread_ids' and 'folder' are required to move emails." };
      }

      const consentRequest = await buildConsentRequest("move_emails", args, accountId);
      const granted = options?.onConsentRequest
        ? await options.onConsentRequest(consentRequest)
        : await requestAgentConsent(consentRequest);

      if (!granted) {
        return {
          text: `Consent was refused by the user for moving ${threadIds.length} email thread(s) to '${folder}'. Action was cancelled.`,
          consentRefused: true,
        };
      }

      const folderLower = folder.toLowerCase();
      for (const tid of threadIds) {
        let messageIds: string[] = [];
        try {
          const msgs = await getMessagesForThread(accountId, tid);
          messageIds = msgs.map((m) => m.id);
        } catch {
          // ignore
        }
        if (folderLower === "trash") {
          await trashThread(accountId, tid, messageIds);
        } else if (folderLower === "archive") {
          await archiveThread(accountId, tid, messageIds);
        } else if (folderLower === "spam") {
          await spamThread(accountId, tid, messageIds, true);
        } else {
          await moveThread(accountId, tid, messageIds, folder);
        }
      }

      return { text: `Successfully moved ${threadIds.length} email thread(s) to '${folder}'.` };
    }

    case "relabel_emails": {
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

      if (threadIds.length === 0 || (addLabels.length === 0 && removeLabels.length === 0)) {
        return { text: "Error: 'thread_ids' and at least one of 'add_labels' or 'remove_labels' are required." };
      }

      const consentRequest = await buildConsentRequest("relabel_emails", args, accountId);
      const granted = options?.onConsentRequest
        ? await options.onConsentRequest(consentRequest)
        : await requestAgentConsent(consentRequest);

      if (!granted) {
        return {
          text: `Consent was refused by the user for updating labels on ${threadIds.length} email thread(s). Action was cancelled.`,
          consentRefused: true,
        };
      }

      for (const tid of threadIds) {
        for (const l of addLabels) {
          await addThreadLabel(accountId, tid, l);
        }
        for (const l of removeLabels) {
          await removeThreadLabel(accountId, tid, l);
        }
      }

      return { text: `Successfully updated labels on ${threadIds.length} email thread(s).` };
    }

    case "delete_emails": {
      const threadIds = Array.isArray(args.thread_ids)
        ? (args.thread_ids as string[])
        : typeof args.thread_id === "string"
          ? [args.thread_id]
          : [];
      const permanent = Boolean(args.permanent);

      if (threadIds.length === 0) {
        return { text: "Error: 'thread_ids' is required to delete emails." };
      }

      const consentRequest = await buildConsentRequest("delete_emails", args, accountId);
      const granted = options?.onConsentRequest
        ? await options.onConsentRequest(consentRequest)
        : await requestAgentConsent(consentRequest);

      if (!granted) {
        return {
          text: `Consent was refused by the user for deleting ${threadIds.length} email thread(s). Action was cancelled.`,
          consentRefused: true,
        };
      }

      for (const tid of threadIds) {
        let messageIds: string[] = [];
        try {
          const msgs = await getMessagesForThread(accountId, tid);
          messageIds = msgs.map((m) => m.id);
        } catch {
          // ignore
        }
        if (permanent) {
          await permanentDeleteThread(accountId, tid, messageIds);
        } else {
          await trashThread(accountId, tid, messageIds);
        }
      }

      return {
        text: `Successfully ${permanent ? "permanently deleted" : "moved to trash"} ${threadIds.length} email thread(s).`,
      };
    }

    default:
      return { text: `Error: unknown tool '${toolName}'` };
  }
}
