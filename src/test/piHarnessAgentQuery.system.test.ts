import { describe, it, expect, vi, beforeEach } from "vitest";
import { askMyInbox } from "@/services/ai/askInbox";
import { setSetting } from "@/services/db/settings";
import { upsertMessage, getMessagesForThread } from "@/services/db/messages";
import { upsertThread } from "@/services/db/threads";

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

    // Simulate multi-turn agent response for Gemma 4 E4B on Pi harness
    const messages = body?.messages || [];
    const lastMessage = messages[messages.length - 1];

    // Turn 1: User asks question -> Gemma 4 E4B decides to call search_emails
    if (lastMessage?.role === "user" && !lastMessage?.content?.includes("Tool '")) {
      return new Response(
        JSON.stringify({
          id: "chatcmpl-pi-agent-1",
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
                    id: "call_search_1",
                    type: "function",
                    function: {
                      name: "search_emails",
                      arguments: JSON.stringify({
                        query: "flight San Francisco",
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

    // Turn 2: Tool result returned -> Gemma 4 E4B calls get_thread to get full confirmation details
    if (lastMessage?.role === "tool" && lastMessage?.tool_call_id === "call_search_1") {
      return new Response(
        JSON.stringify({
          id: "chatcmpl-pi-agent-2",
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
                    id: "call_thread_2",
                    type: "function",
                    function: {
                      name: "get_thread",
                      arguments: JSON.stringify({
                        thread_id: "thread-flight-sf-2026",
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

    // Turn 3: Full thread returned -> Gemma 4 E4B synthesizes final answer
    if (lastMessage?.role === "tool" && lastMessage?.tool_call_id === "call_thread_2") {
      return new Response(
        JSON.stringify({
          id: "chatcmpl-pi-agent-3",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: body?.model || "gemma-4-e4b",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content:
                  "Your flight to San Francisco is scheduled for March 25, 2026 at 09:15 AM (Flight UA-402, Confirmation #SF-9042). The confirmation email was sent by United Airlines (reservations@united.com).",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Fallback response
    return new Response(
      JSON.stringify({
        id: "chatcmpl-fallback",
        choices: [{ message: { role: "assistant", content: "No further information." } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
    }),
  };
});

// Mock Database with memory tables for system test
const dbMemory = {
  settings: new Map<string, string>(),
  threads: new Map<string, Record<string, unknown>>(),
  messages: new Map<string, Record<string, unknown>>(),
};

vi.mock("@/services/db/connection", () => ({
  getDb: vi.fn(() =>
    Promise.resolve({
      execute: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes("INSERT INTO settings")) {
          dbMemory.settings.set(params[0] as string, params[1] as string);
        }
        return { rowsAffected: 1 };
      }),
      select: vi.fn(async (sql: string, params: unknown[]) => {
        // Query settings
        if (sql.includes("SELECT value FROM settings WHERE key")) {
          const val = dbMemory.settings.get(params[0] as string);
          return val !== undefined ? [{ value: val }] : [];
        }

        // Query getMessagesForThread
        if (sql.includes("WHERE account_id = $1 AND thread_id = $2")) {
          return Array.from(dbMemory.messages.values()).filter(
            (m) => m.account_id === params[0] && m.thread_id === params[1],
          );
        }

        // Query search_emails / messages
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

describe("System Test: Pi Harness + Gemma 4 E4B with SQLite Tool Calling", () => {
  const accountId = "user-system-account";

  beforeEach(async () => {
    piHarnessCalls.length = 0;
    dbMemory.settings.clear();
    dbMemory.threads.clear();
    dbMemory.messages.clear();

    // 1. Configure SuperMail to use Pi harness with local Gemma 4 E4B
    await setSetting("ai_provider", "pi");
    await setSetting("pi_server_url", "http://localhost:18420");
    await setSetting("pi_model", "gemma-4-e4b");

    // 2. Populate SQLite database with sample flight booking emails
    dbMemory.threads.set("thread-flight-sf-2026", {
      id: "thread-flight-sf-2026",
      account_id: accountId,
      subject: "United Airlines Flight Confirmation - San Francisco (SFO)",
      snippet: "Your flight UA-402 to San Francisco is confirmed for March 25, 2026.",
      last_message_at: 1774426500000,
    });

    dbMemory.messages.set("msg-flight-sf-001", {
      id: "msg-flight-sf-001",
      account_id: accountId,
      thread_id: "thread-flight-sf-2026",
      from_name: "United Airlines",
      from_address: "reservations@united.com",
      to_addresses: "user@example.com",
      subject: "United Airlines Flight Confirmation - San Francisco (SFO)",
      snippet: "Your flight UA-402 to San Francisco is confirmed for March 25, 2026.",
      date: 1774426500000,
      is_read: 1,
      is_starred: 1,
      body_text:
        "Dear Customer,\n\nYour flight UA-402 from Chicago (ORD) to San Francisco (SFO) is confirmed for March 25, 2026 at 09:15 AM.\nBooking Reference: #SF-9042.\nSeat: 14A.\n\nThank you for flying with United.",
      body_html: "<p>Dear Customer, your flight UA-402...</p>",
    });
  });

  it("answers natural language email questions using Pi harness Gemma 4 E4B and local SQLite tools", async () => {
    const question = "When is my flight to San Francisco and who sent the confirmation?";

    // Run Ask My Inbox with Pi harness active
    const result = await askMyInbox(question, accountId);

    // Verify final synthesized answer accurately contains facts retrieved from SQLite
    expect(result.answer).toContain("March 25, 2026");
    expect(result.answer).toContain("United Airlines");
    expect(result.answer).toContain("UA-402");
    expect(result.answer).toContain("#SF-9042");

    // Verify source message is provided for UI deep-linking
    expect(result.sourceMessages).toHaveLength(1);
    expect(result.sourceMessages[0]?.message_id).toBe("msg-flight-sf-001");
    expect(result.sourceMessages[0]?.from_address).toBe("reservations@united.com");

    // Verify interactions with local Pi harness
    expect(piHarnessCalls.length).toBe(3);

    // Turn 1 check: Called /v1/chat/completions with tools specification and gemma-4-e4b
    const firstCall = piHarnessCalls[0];
    expect(firstCall?.url).toContain("http://127.0.0.1:18420/v1/chat/completions");
    expect((firstCall?.body as any)?.model).toBe("gemma-4-e4b");
    const tools = (firstCall?.body as any)?.tools;
    expect(tools.map((t: any) => t.function.name)).toEqual([
      "search_emails",
      "semantic_search_emails",
      "get_thread",
      "get_email_stats",
      "run_readonly_sql",
      "list_labels",
      "suggest_filter",
      "send_email",
      "batch_send_emails",
      "move_emails",
      "relabel_emails",
      "delete_emails",
    ]);

    // Turn 2 check: Verified tool result for search_emails was passed back into conversation
    const secondCall = piHarnessCalls[1];
    const messagesStep2 = (secondCall?.body as any)?.messages;
    const toolMsg1 = messagesStep2.find((m: any) => m.role === "tool" && m.tool_call_id === "call_search_1");
    expect(toolMsg1).toBeDefined();
    expect(toolMsg1.content).toContain("msg-flight-sf-001");

    // Turn 3 check: Verified tool result for get_thread was passed back into conversation
    const thirdCall = piHarnessCalls[2];
    const messagesStep3 = (thirdCall?.body as any)?.messages;
    const toolMsg2 = messagesStep3.find((m: any) => m.role === "tool" && m.tool_call_id === "call_thread_2");
    expect(toolMsg2).toBeDefined();
    expect(toolMsg2.content).toContain("#SF-9042");
    expect(toolMsg2.content).toContain("Booking Reference");
  });
});
