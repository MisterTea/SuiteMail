import type OpenAI from "openai";
import { getDb } from "@/services/db/connection";
import { buildSearchQuery } from "@/services/search/searchQueryBuilder";
import type { ParsedSearchQuery } from "@/services/search/searchParser";
import { getMessagesForThread, type DbMessage } from "@/services/db/messages";
import type { SearchResult } from "@/services/db/search";

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
];

/**
 * Execute a Pi harness email tool against the local SQLite database.
 */
export async function executePiEmailTool(
  toolName: string,
  args: Record<string, unknown>,
  accountId: string,
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

    default:
      return { text: `Error: unknown tool '${toolName}'` };
  }
}
