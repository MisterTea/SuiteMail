import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPiEmailAgent, suggestFilterWithPiAgent } from "./piEmailAgent";

// Mock executePiEmailTool
vi.mock("./piEmailTools", async () => {
  const actual = await vi.importActual<typeof import("./piEmailTools")>("./piEmailTools");
  return {
    ...actual,
    executePiEmailTool: vi.fn(),
  };
});

import { executePiEmailTool } from "./piEmailTools";

// Mock settings
vi.mock("@/services/db/settings", () => ({
  getSetting: vi.fn((key: string) => {
    if (key === "pi_server_url") return Promise.resolve("http://localhost:3000");
    if (key === "pi_model") return Promise.resolve("gemma-4-e4b");
    return Promise.resolve(null);
  }),
}));

vi.mock("./llamaServer", () => ({
  DEFAULT_PI_SERVER_URL: "http://127.0.0.1:18420",
  ensureLlamaServer: vi.fn(async (url?: string) => url ?? "http://127.0.0.1:3000"),
}));

// Mock OpenAI
const mockCreateChatCompletion = vi.fn();
vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: mockCreateChatCompletion,
        },
      };
    },
  };
});

describe("piEmailAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes OpenAI tool calls and returns final answer with source messages", async () => {
    // Step 1: LLM invokes search_emails
    mockCreateChatCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_abc123",
                type: "function",
                function: {
                  name: "search_emails",
                  arguments: JSON.stringify({ query: "flight confirmation", from: "airline@example.com" }),
                },
              },
            ],
          },
        },
      ],
    });

    // Mock tool execution returning a source message
    vi.mocked(executePiEmailTool).mockResolvedValueOnce({
      text: "[1] Message ID: msg-flight-99 | Subject: Flight to JFK Confirmed",
      sourceMessages: [
        {
          message_id: "msg-flight-99",
          account_id: "acc-1",
          thread_id: "thread-flight-99",
          subject: "Flight to JFK Confirmed",
          from_name: "Airline",
          from_address: "airline@example.com",
          snippet: "Your flight is confirmed for March 20.",
          date: 1773500000000,
          rank: -1,
        },
      ],
    });

    // Step 2: LLM receives tool result and produces final answer
    mockCreateChatCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: "assistant",
            content: "Your flight to JFK is confirmed for March 20 according to the email from Airline.",
          },
        },
      ],
    });

    const result = await runPiEmailAgent({
      question: "When is my flight to JFK?",
      accountId: "acc-1",
    });

    expect(result.answer).toBe(
      "Your flight to JFK is confirmed for March 20 according to the email from Airline.",
    );
    expect(result.sourceMessages).toHaveLength(1);
    expect(result.sourceMessages[0]?.message_id).toBe("msg-flight-99");
    expect(result.toolCallsExecuted).toHaveLength(1);
    expect(result.toolCallsExecuted[0]?.tool).toBe("search_emails");
    expect(executePiEmailTool).toHaveBeenCalledWith(
      "search_emails",
      { query: "flight confirmation", from: "airline@example.com" },
      "acc-1",
    );
  });

  it("handles text-based JSON tool call output from compact local models", async () => {
    // Step 1: LLM outputs text-based JSON tool call
    mockCreateChatCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: "assistant",
            content: '```json\n{"tool": "get_email_stats", "parameters": {"type": "unread_count"}}\n```',
          },
        },
      ],
    });

    vi.mocked(executePiEmailTool).mockResolvedValueOnce({
      text: JSON.stringify({ unread_messages: 5, unread_threads: 3 }),
    });

    // Step 2: LLM receives tool result and provides final text
    mockCreateChatCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: "assistant",
            content: "You currently have 5 unread messages across 3 threads.",
          },
        },
      ],
    });

    const result = await runPiEmailAgent({
      question: "How many unread emails do I have?",
      accountId: "acc-1",
    });

    expect(result.answer).toBe("You currently have 5 unread messages across 3 threads.");
    expect(result.toolCallsExecuted).toHaveLength(1);
    expect(result.toolCallsExecuted[0]?.tool).toBe("get_email_stats");
  });

  it("returns direct answer when no tools are invoked", async () => {
    mockCreateChatCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: "assistant",
            content: "I am ready to help you manage and search your emails.",
          },
        },
      ],
    });

    const result = await runPiEmailAgent({
      question: "Hello! What can you do?",
      accountId: "acc-1",
    });

    expect(result.answer).toBe("I am ready to help you manage and search your emails.");
    expect(result.toolCallsExecuted).toHaveLength(0);
  });

  describe("suggestFilterWithPiAgent", () => {
    it("suggests filter via OpenAI tool call", async () => {
      mockCreateChatCompletion.mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_suggest_1",
                  type: "function",
                  function: {
                    name: "suggest_filter",
                    arguments: JSON.stringify({
                      name: "GitHub Notifications",
                      criteria: { from: "notifications@github.com" },
                      actions: { markRead: true, archive: true },
                      explanation: "Archives all GitHub notifications and marks them as read.",
                    }),
                  },
                },
              ],
            },
          },
        ],
      });

      const res = await suggestFilterWithPiAgent({
        prompt: "Archive all emails from GitHub notifications and mark as read",
        accountId: "acc-1",
      });

      expect(res.filter.name).toBe("GitHub Notifications");
      expect(res.filter.criteria.from).toBe("notifications@github.com");
      expect(res.filter.actions.markRead).toBe(true);
      expect(res.filter.actions.archive).toBe(true);
      expect(res.filter.explanation).toContain("GitHub");
      expect(res.toolCallsExecuted).toHaveLength(1);
      expect(res.toolCallsExecuted[0]?.tool).toBe("suggest_filter");
    });

    it("searches emails to discover sender then suggests filter", async () => {
      // Turn 1: agent calls search_emails
      mockCreateChatCompletion.mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_search_uber",
                  type: "function",
                  function: {
                    name: "search_emails",
                    arguments: JSON.stringify({ query: "Uber receipt" }),
                  },
                },
              ],
            },
          },
        ],
      });

      vi.mocked(executePiEmailTool).mockResolvedValueOnce({
        text: "Found message from receipts@uber.com with subject 'Your trip with Uber'",
        sourceMessages: [],
      });

      // Turn 2: agent calls suggest_filter
      mockCreateChatCompletion.mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_suggest_uber",
                  type: "function",
                  function: {
                    name: "suggest_filter",
                    arguments: JSON.stringify({
                      name: "Uber Receipts",
                      criteria: { from: "receipts@uber.com", subject: "receipt" },
                      actions: { applyLabel: "Receipts", star: true },
                      explanation: "Labels Uber receipts and stars them.",
                    }),
                  },
                },
              ],
            },
          },
        ],
      });

      const res = await suggestFilterWithPiAgent({
        prompt: "Label all my Uber receipts with Receipts and star them",
        accountId: "acc-1",
      });

      expect(res.filter.name).toBe("Uber Receipts");
      expect(res.filter.criteria.from).toBe("receipts@uber.com");
      expect(res.filter.actions.applyLabel).toBe("Receipts");
      expect(res.filter.actions.star).toBe(true);
      expect(res.toolCallsExecuted.map((t) => t.tool)).toEqual(["search_emails", "suggest_filter"]);
    });

    it("handles text-based JSON tool call from compact model", async () => {
      mockCreateChatCompletion.mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: "assistant",
              content:
                '```json\n{"tool": "suggest_filter", "parameters": {"name": "Trash Spam", "criteria": {"subject": "Free money"}, "actions": {"trash": true}}}\n```',
            },
          },
        ],
      });

      const res = await suggestFilterWithPiAgent({
        prompt: "Trash any email saying Free money in the subject",
        accountId: "acc-1",
      });

      expect(res.filter.name).toBe("Trash Spam");
      expect(res.filter.criteria.subject).toBe("Free money");
      expect(res.filter.actions.trash).toBe(true);
    });

    it("extracts filter directly from JSON in message content", async () => {
      mockCreateChatCompletion.mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: "assistant",
              content:
                'Here is the suggested filter:\n```json\n{\n  "name": "Substack Newsletters",\n  "criteria": { "from": "substack.com" },\n  "actions": { "archive": true, "markRead": true }\n}\n```',
            },
          },
        ],
      });

      const res = await suggestFilterWithPiAgent({
        prompt: "Archive all substack newsletters",
        accountId: "acc-1",
      });

      expect(res.filter.name).toBe("Substack Newsletters");
      expect(res.filter.criteria.from).toBe("substack.com");
      expect(res.filter.actions.archive).toBe(true);
    });

    it("replaces the SDK connection error with the server address", async () => {
      mockCreateChatCompletion.mockRejectedValueOnce(new Error("Connection error."));

      await expect(
        suggestFilterWithPiAgent({
          prompt: "Archive newsletters",
          accountId: "acc-1",
        }),
      ).rejects.toThrow(/127\.0\.0\.1:3000/);
    });
  });
});
