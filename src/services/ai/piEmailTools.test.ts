import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseDateString,
  isSafeReadOnlyQuery,
  PI_EMAIL_TOOLS,
  executePiEmailTool,
} from "./piEmailTools";

// Mock DB connection and messages
const mockSelect = vi.fn();
const mockExecute = vi.fn();
vi.mock("@/services/db/connection", () => ({
  getDb: vi.fn(() => Promise.resolve({
    select: mockSelect,
    execute: mockExecute,
  })),
}));

vi.mock("@/services/db/messages", () => ({
  getMessagesForThread: vi.fn(),
}));

import { getMessagesForThread } from "@/services/db/messages";

describe("piEmailTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("parseDateString", () => {
    it("parses YYYY-MM-DD correctly", () => {
      const ts = parseDateString("2026-03-15");
      expect(ts).toBeDefined();
      expect(typeof ts).toBe("number");
      const d = new Date(ts! * 1000);
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(2); // March is 2
      expect(d.getDate()).toBe(15);
    });

    it("parses YYYY/MM/DD correctly", () => {
      const ts = parseDateString("2026/11/05");
      expect(ts).toBeDefined();
      const d = new Date(ts! * 1000);
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(10); // Nov is 10
      expect(d.getDate()).toBe(5);
    });

    it("returns undefined for invalid date strings", () => {
      expect(parseDateString("invalid")).toBeUndefined();
      expect(parseDateString("2026-99-99")).toBeUndefined();
      expect(parseDateString("")).toBeUndefined();
    });
  });

  describe("isSafeReadOnlyQuery", () => {
    it("allows valid SELECT queries", () => {
      expect(isSafeReadOnlyQuery("SELECT * FROM messages WHERE is_read = 0").safe).toBe(true);
      expect(isSafeReadOnlyQuery("  select count(*) from threads  ").safe).toBe(true);
      expect(isSafeReadOnlyQuery("WITH recent AS (SELECT * FROM messages) SELECT * FROM recent").safe).toBe(true);
    });

    it("rejects non-SELECT or state modifying statements", () => {
      expect(isSafeReadOnlyQuery("DELETE FROM messages").safe).toBe(false);
      expect(isSafeReadOnlyQuery("UPDATE threads SET is_read = 1").safe).toBe(false);
      expect(isSafeReadOnlyQuery("INSERT INTO messages (id) VALUES ('x')").safe).toBe(false);
      expect(isSafeReadOnlyQuery("DROP TABLE messages").safe).toBe(false);
      expect(isSafeReadOnlyQuery("ALTER TABLE messages ADD COLUMN x TEXT").safe).toBe(false);
      expect(isSafeReadOnlyQuery("PRAGMA table_info(messages)").safe).toBe(false);
    });

    it("rejects multiple statements separated by semicolon", () => {
      expect(isSafeReadOnlyQuery("SELECT 1; DROP TABLE messages").safe).toBe(false);
    });

    it("rejects empty queries", () => {
      expect(isSafeReadOnlyQuery("").safe).toBe(false);
      expect(isSafeReadOnlyQuery("   ").safe).toBe(false);
    });
  });

  describe("PI_EMAIL_TOOLS specification", () => {
    it("defines the expected function tools", () => {
      const toolNames = PI_EMAIL_TOOLS.map((t) => t.function.name);
      expect(toolNames).toContain("search_emails");
      expect(toolNames).toContain("get_thread");
      expect(toolNames).toContain("get_email_stats");
      expect(toolNames).toContain("run_readonly_sql");
    });
  });

  describe("executePiEmailTool", () => {
    it("executes search_emails and returns formatted message list", async () => {
      mockSelect.mockResolvedValueOnce([
        {
          message_id: "msg-101",
          account_id: "acc-1",
          thread_id: "thread-55",
          subject: "Q3 Budget Review",
          from_name: "Sarah Chen",
          from_address: "sarah@example.com",
          snippet: "Here is the finalized quarterly budget spreadsheet.",
          date: 1773500000000,
          rank: -1.5,
        },
      ]);

      const result = await executePiEmailTool(
        "search_emails",
        { query: "budget", from: "sarah@example.com", is_unread: true },
        "acc-1",
      );

      expect(result.text).toContain("Message ID: msg-101");
      expect(result.text).toContain("Thread ID: thread-55");
      expect(result.text).toContain("Sarah Chen <sarah@example.com>");
      expect(result.text).toContain("Q3 Budget Review");
      expect(result.sourceMessages).toHaveLength(1);
    });

    it("handles search_emails with no matches gracefully", async () => {
      mockSelect.mockResolvedValueOnce([]);

      const result = await executePiEmailTool(
        "search_emails",
        { query: "nonexistent keywords" },
        "acc-1",
      );

      expect(result.text).toContain("No matching emails found");
      expect(result.sourceMessages).toHaveLength(0);
    });

    it("executes get_thread and formats message bodies", async () => {
      vi.mocked(getMessagesForThread).mockResolvedValueOnce([
        {
          id: "msg-1",
          account_id: "acc-1",
          thread_id: "t-100",
          from_address: "alex@example.com",
          from_name: "Alex",
          to_addresses: "user@example.com",
          cc_addresses: null,
          bcc_addresses: null,
          reply_to: null,
          subject: "Project Phoenix Kickoff",
          snippet: "Let's meet tomorrow.",
          date: 1773500000000,
          is_read: 1,
          is_starred: 0,
          body_html: "<p>Let's meet tomorrow at 10 AM.</p>",
          body_text: "Let's meet tomorrow at 10 AM.",
          body_cached: 1,
          raw_size: 500,
          internal_date: 1773500000000,
          list_unsubscribe: null,
          list_unsubscribe_post: null,
          auth_results: null,
          message_id_header: null,
          references_header: null,
          in_reply_to_header: null,
          imap_uid: null,
          imap_folder: null,
        },
      ]);

      const result = await executePiEmailTool("get_thread", { thread_id: "t-100" }, "acc-1");
      expect(result.text).toContain("Project Phoenix Kickoff");
      expect(result.text).toContain("Let's meet tomorrow at 10 AM.");
      expect(result.text).toContain("Alex <alex@example.com>");
    });

    it("executes get_email_stats for unread_count and total_count", async () => {
      mockSelect
        .mockResolvedValueOnce([{ count: 4 }]) // unread messages
        .mockResolvedValueOnce([{ count: 2 }]); // unread threads

      const unreadResult = await executePiEmailTool(
        "get_email_stats",
        { type: "unread_count" },
        "acc-1",
      );

      expect(unreadResult.text).toContain('"unread_messages": 4');
      expect(unreadResult.text).toContain('"unread_threads": 2');

      mockSelect
        .mockResolvedValueOnce([{ count: 150 }]) // total messages
        .mockResolvedValueOnce([{ count: 80 }]); // total threads

      const totalResult = await executePiEmailTool(
        "get_email_stats",
        { type: "total_count" },
        "acc-1",
      );

      expect(totalResult.text).toContain('"total_messages": 150');
      expect(totalResult.text).toContain('"total_threads": 80');
    });

    it("executes get_email_stats for top_senders", async () => {
      mockSelect.mockResolvedValueOnce([
        { from_address: "boss@corp.com", from_name: "The Boss", count: 28 },
      ]);

      const result = await executePiEmailTool(
        "get_email_stats",
        { type: "top_senders", days: 14 },
        "acc-1",
      );

      expect(result.text).toContain("boss@corp.com");
      expect(result.text).toContain("28");
    });

    it("executes safe run_readonly_sql and enforces LIMIT", async () => {
      mockSelect.mockResolvedValueOnce([{ subject: "Hello", count: 1 }]);

      const result = await executePiEmailTool(
        "run_readonly_sql",
        { sql: "SELECT subject, count(*) as count FROM messages GROUP BY subject" },
        "acc-1",
      );

      expect(mockSelect).toHaveBeenCalledWith(
        expect.stringContaining("LIMIT 50"),
      );
      expect(result.text).toContain("Hello");
    });

    it("rejects unsafe run_readonly_sql queries without running SQL", async () => {
      const result = await executePiEmailTool(
        "run_readonly_sql",
        { sql: "DELETE FROM messages WHERE id = 'bad'" },
        "acc-1",
      );

      expect(result.text).toContain("Query rejected");
      expect(mockSelect).not.toHaveBeenCalled();
    });

    it("executes list_labels tool returning account labels", async () => {
      mockSelect.mockResolvedValueOnce([
        { id: "lbl-work", name: "Work", type: "user" },
        { id: "lbl-finance", name: "Finance", type: "user" },
      ]);

      const result = await executePiEmailTool("list_labels", {}, "acc-1");

      expect(mockSelect).toHaveBeenCalledWith(
        expect.stringContaining("SELECT id, name, type FROM labels"),
        ["acc-1"],
      );
      expect(result.text).toContain("Work");
      expect(result.text).toContain("Finance");
    });

    it("executes suggest_filter tool returning captured filter args", async () => {
      const args = {
        name: "Test Rule",
        criteria: { from: "test@domain.com" },
        actions: { markRead: true },
      };

      const result = await executePiEmailTool("suggest_filter", args, "acc-1");

      expect(result.text).toContain("Filter suggestion captured");
      expect(result.data).toEqual(args);
    });
  });
});
