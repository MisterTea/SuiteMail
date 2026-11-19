import { describe, it, expect, vi, beforeEach } from "vitest";
import { suggestFilterWithPiAgent } from "@/services/ai/piEmailAgent";
import { getAffectedEmailsForFilter } from "@/services/filters/filterEngine";
import { insertFilter, getFiltersForAccount } from "@/services/db/filters";
import { ensureLabelOrFolder } from "@/services/db/labels";
import { setSetting } from "@/services/db/settings";

// Track API calls to Pi harness endpoint
const piHarnessCalls: { url: string; body: unknown }[] = [];

// The agent reaches the model through platformFetch, not the HTTP plugin directly.
vi.mock("@/platform", async () => {
  const actual = await vi.importActual<typeof import("@/platform")>("@/platform");
  return {
    ...actual,
    platformFetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/v1/models")) {
      return new Response(JSON.stringify({ data: [{ id: "gemma-4-e4b" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    const body = init?.body ? JSON.parse(init.body as string) : null;
    piHarnessCalls.push({ url, body });

    const messages = body?.messages || [];
    const lastMessage = messages[messages.length - 1];

    // Turn 1: User asks to create a filter -> Gemma 4 E4B on Pi harness first searches for the sender
    if (lastMessage?.role === "user" && !lastMessage?.content?.includes("Tool '")) {
      return new Response(
        JSON.stringify({
          id: "chatcmpl-pi-filter-1",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: body?.model || "gemma-4-e4b",
          choices: [
            {
              index: 0,
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_search_newsletters",
                    type: "function",
                    function: {
                      name: "search_emails",
                      arguments: JSON.stringify({
                        query: "Tech Weekly newsletter",
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Turn 2: Tool result returned -> Gemma 4 E4B on Pi harness invokes suggest_filter
    if (
      lastMessage?.role === "tool" &&
      lastMessage?.tool_call_id === "call_search_newsletters"
    ) {
      return new Response(
        JSON.stringify({
          id: "chatcmpl-pi-filter-2",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: body?.model || "gemma-4-e4b",
          choices: [
            {
              index: 0,
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_suggest_filter_1",
                    type: "function",
                    function: {
                      name: "suggest_filter",
                      arguments: JSON.stringify({
                        name: "Tech Weekly Newsletters",
                        newFolder: "Newsletters",
                        criteria: {
                          from: "newsletter@techweekly.com",
                        },
                        actions: {
                          applyLabel: "Newsletters",
                          archive: true,
                          markRead: true,
                        },
                        explanation:
                          "Creates Newsletters folder, automatically archives and marks all incoming Tech Weekly newsletters as read.",
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        id: "chatcmpl-fallback",
        choices: [{ message: { role: "assistant", content: "{}" } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
    }),
  };
});

// In-memory tables for system test
const dbMemory = {
  settings: new Map<string, string>(),
  messages: new Map<string, Record<string, unknown>>(),
  filterRules: new Map<string, Record<string, unknown>>(),
  labels: new Map<string, Record<string, unknown>>(),
};

vi.mock("@/services/db/connection", () => ({
  boolToInt: (b: boolean) => (b ? 1 : 0),
  getDb: vi.fn(() =>
    Promise.resolve({
      execute: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes("INSERT INTO settings")) {
          dbMemory.settings.set(params[0] as string, params[1] as string);
        }
        if (sql.includes("INSERT INTO filter_rules")) {
          dbMemory.filterRules.set(params[0] as string, {
            id: params[0],
            account_id: params[1],
            name: params[2],
            is_enabled: params[3],
            criteria_json: params[4],
            actions_json: params[5],
            sort_order: params[6],
            created_at: Math.floor(Date.now() / 1000),
          });
        }
        if (sql.includes("INSERT INTO labels")) {
          dbMemory.labels.set(params[0] as string, {
            id: params[0],
            account_id: params[1],
            name: params[2],
            type: params[3],
          });
        }
        return { rowsAffected: 1 };
      }),
      select: vi.fn(async (sql: string, params: unknown[]) => {
        // Query settings
        if (sql.includes("SELECT value FROM settings WHERE key")) {
          const val = dbMemory.settings.get(params[0] as string);
          return val !== undefined ? [{ value: val }] : [];
        }

        // Query labels
        if (sql.includes("FROM labels")) {
          return Array.from(dbMemory.labels.values()).filter(
            (l) => l.account_id === params[0],
          );
        }

        // Query min sort_order
        if (sql.includes("SELECT MIN(sort_order)")) {
          const rules = Array.from(dbMemory.filterRules.values()).filter(
            (r) => r.account_id === params[0],
          );
          if (rules.length === 0) return [{ min_order: null }];
          const min = Math.min(...rules.map((r) => r.sort_order as number));
          return [{ min_order: min }];
        }

        // Query filter_rules
        if (sql.includes("FROM filter_rules WHERE account_id = $1")) {
          const rules = Array.from(dbMemory.filterRules.values()).filter(
            (r) => r.account_id === params[0],
          );
          return rules.sort((a, b) => (a.sort_order as number) - (b.sort_order as number));
        }

        // Query messages
        if (sql.includes("FROM messages m")) {
          const msgs = Array.from(dbMemory.messages.values()).filter(
            (m) => m.account_id === params[0],
          );
          return msgs.map((m) => ({
            id: m.id,
            account_id: m.account_id,
            thread_id: m.thread_id,
            from_name: m.from_name,
            from_address: m.from_address,
            to_addresses: m.to_addresses,
            subject: m.subject,
            snippet: m.snippet,
            date: m.date,
            is_read: m.is_read,
            is_starred: m.is_starred,
            body_text: m.body_text,
            body_html: m.body_html,
            attachment_count: 0,
          }));
        }

        // FTS / Search
        if (sql.includes("FROM messages") || sql.includes("FROM messages_fts")) {
          const msgs = Array.from(dbMemory.messages.values());
          return msgs.map((m) => ({
            message_id: m.id,
            account_id: m.account_id,
            thread_id: m.thread_id,
            subject: m.subject,
            from_name: m.from_name,
            from_address: m.from_address,
            snippet: m.snippet,
            date: m.date,
            rank: -1,
          }));
        }

        return [];
      }),
    }),
  ),
}));

describe("System Test: Pi Agent Suggesting Filters with Affected Email Preview", () => {
  const accountId = "user-pi-filter-account";

  beforeEach(async () => {
    piHarnessCalls.length = 0;
    dbMemory.settings.clear();
    dbMemory.messages.clear();
    dbMemory.filterRules.clear();

    // 1. Configure SuperMail to use Pi harness with local Gemma 4 E4B
    await setSetting("ai_provider", "pi");
    await setSetting("pi_server_url", "http://localhost:18420");
    await setSetting("pi_model", "gemma-4-e4b");

    // Existing filter in the account (priority 0)
    dbMemory.filterRules.set("existing-filter-0", {
      id: "existing-filter-0",
      account_id: accountId,
      name: "Existing Default Rule",
      is_enabled: 1,
      criteria_json: JSON.stringify({ from: "random@spam.com" }),
      actions_json: JSON.stringify({ trash: true }),
      sort_order: 0,
      created_at: 1000,
    });

    // Populate inbox with sample emails
    dbMemory.messages.set("msg-newsletter-1", {
      id: "msg-newsletter-1",
      account_id: accountId,
      thread_id: "thread-news-1",
      from_name: "Tech Weekly",
      from_address: "newsletter@techweekly.com",
      to_addresses: "user@example.com",
      subject: "Tech Weekly Issue #88: Local AI on Pi Harness",
      snippet: "In this issue, we explore edge intelligence with Gemma 4...",
      date: 1774000000000,
      is_read: 0,
      is_starred: 0,
      body_text: "In this issue, we explore edge intelligence with Gemma 4...",
      body_html: "<p>In this issue...</p>",
    });

    dbMemory.messages.set("msg-newsletter-2", {
      id: "msg-newsletter-2",
      account_id: accountId,
      thread_id: "thread-news-2",
      from_name: "Tech Weekly",
      from_address: "newsletter@techweekly.com",
      to_addresses: "user@example.com",
      subject: "Tech Weekly Issue #89: Real-time Email Agents",
      snippet: "How to pair filter automation with intelligent agents...",
      date: 1774100000000,
      is_read: 0,
      is_starred: 0,
      body_text: "How to pair filter automation with intelligent agents...",
      body_html: "<p>How to pair...</p>",
    });

    dbMemory.messages.set("msg-personal-1", {
      id: "msg-personal-1",
      account_id: accountId,
      thread_id: "thread-personal-1",
      from_name: "Sarah Colleague",
      from_address: "sarah@company.com",
      to_addresses: "user@example.com",
      subject: "Project roadmap review",
      snippet: "Let's sync up tomorrow afternoon about the release.",
      date: 1774200000000,
      is_read: 1,
      is_starred: 1,
      body_text: "Let's sync up tomorrow afternoon about the release.",
      body_html: "<p>Let's sync up...</p>",
    });
  });

  it("suggests filter given English prompt, previews affected emails with highest priority, and adds filter", async () => {
    const userPrompt =
      "I want to automatically archive all newsletters from Tech Weekly and mark them as read";

    // 1. Pi Agent figures out the right filter
    const suggestionResult = await suggestFilterWithPiAgent({
      prompt: userPrompt,
      accountId,
    });

    expect(suggestionResult.filter).toBeDefined();
    expect(suggestionResult.filter.name).toBe("Tech Weekly Newsletters");
    expect(suggestionResult.filter.newFolder).toBe("Newsletters");
    expect(suggestionResult.filter.criteria.from).toBe("newsletter@techweekly.com");
    expect(suggestionResult.filter.actions.archive).toBe(true);
    expect(suggestionResult.filter.actions.markRead).toBe(true);

    // Verify multi-turn interaction with Pi harness (turn 1 search, turn 2 suggest)
    expect(piHarnessCalls).toHaveLength(2);
    expect(suggestionResult.toolCallsExecuted.map((t) => t.tool)).toEqual([
      "search_emails",
      "suggest_filter",
    ]);

    // 2. Client queries emails that would be affected by this new filter (assuming highest priority)
    const affectedEmails = await getAffectedEmailsForFilter(
      accountId,
      suggestionResult.filter.criteria,
      suggestionResult.filter.actions,
    );

    expect(affectedEmails).toHaveLength(2);
    expect(affectedEmails.map((e) => e.id).sort()).toEqual([
      "msg-newsletter-1",
      "msg-newsletter-2",
    ]);
    expect(affectedEmails[0]?.fromAddress).toBe("newsletter@techweekly.com");
    expect(affectedEmails[0]?.actionChanges).toContain("Archive from Inbox");
    expect(affectedEmails[0]?.actionChanges).toContain("Mark as read");

    // Verify unrelated personal email was NOT affected
    expect(affectedEmails.find((e) => e.id === "msg-personal-1")).toBeUndefined();

    // 3. User chooses to add the filter: new folder is created upon user agreement
    let finalLabelId = suggestionResult.filter.actions.applyLabel;
    if (suggestionResult.filter.newFolder) {
      finalLabelId = await ensureLabelOrFolder(accountId, suggestionResult.filter.newFolder);
    }
    expect(finalLabelId).toBeDefined();
    expect(dbMemory.labels.get(finalLabelId!)?.name).toBe("Newsletters");

    const filterId = await insertFilter({
      accountId,
      name: suggestionResult.filter.name,
      criteria: suggestionResult.filter.criteria,
      actions: {
        ...suggestionResult.filter.actions,
        applyLabel: finalLabelId,
      },
      highestPriority: true,
    });

    expect(filterId).toBeDefined();

    // 4. Verify the new filter is stored with highest priority (evaluated first)
    const filters = await getFiltersForAccount(accountId);
    expect(filters).toHaveLength(2);

    // New filter should be at index 0 (highest priority, sort_order -1 vs existing 0)
    expect(filters[0]?.id).toBe(filterId);
    expect(filters[0]?.name).toBe("Tech Weekly Newsletters");
    expect(filters[0]?.sort_order).toBeLessThan(filters[1]?.sort_order as number);
  });
});
