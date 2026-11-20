import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPiEmailAgent, suggestFilterWithPiAgent } from "./piEmailAgent";

import { getAffectedEmailsForFilter, type AffectedEmail } from "@/services/filters/filterEngine";
vi.mock("@/services/filters/filterEngine", () => ({ getAffectedEmailsForFilter: vi.fn() }));

const mockAiCoreComplete = vi.fn();
vi.mock("./providers/aicoreProvider", () => ({
  createAiCoreProvider: () => ({ complete: mockAiCoreComplete }),
}));

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
    const filter = { name: "Automated GitHub", criteria: { from: "notifications@github.com", subject: "workflow run" }, actions: { markRead: true } };
    const tool = (name: string, args: unknown) => ({ choices: [{ message: {
      role: "assistant", content: null, tool_calls: [{ id: `call_${name}`, type: "function",
        function: { name, arguments: JSON.stringify(args) } }],
    } }] });
    const search = () => mockCreateChatCompletion.mockResolvedValueOnce(tool("search_emails", { query: "GitHub" }));
    const propose = (value = filter) => mockCreateChatCompletion.mockResolvedValueOnce(tool("suggest_filter", value));

    beforeEach(() => {
      mockCreateChatCompletion.mockReset();
      vi.mocked(executePiEmailTool).mockResolvedValue({ text: "Found automated workflow notifications and human comments", sourceMessages: [] });
      vi.mocked(getAffectedEmailsForFilter).mockReset().mockResolvedValue([
        { id: "message-1", threadId: "thread-1", fromAddress: "notifications@github.com", subject: "workflow run completed", snippet: "Automated CI", actionChanges: ["Mark as read"] } as AffectedEmail,
      ]);
    });

    it("uses Pi to inspect, validate and review samples over multiple model calls", async () => {
      search(); propose(); propose();
      const onProgress = vi.fn();
      const res = await suggestFilterWithPiAgent({ prompt: "Mark only automated GitHub notifications read, not comments. At least one must match.", accountId: "acc-1", onProgress });
      expect(res.filter).toEqual(filter);
      expect(mockCreateChatCompletion).toHaveBeenCalledTimes(3);
      expect(getAffectedEmailsForFilter).toHaveBeenCalledWith("acc-1", filter.criteria, filter.actions, 50);
      const finalRequest = mockCreateChatCompletion.mock.calls[2][0];
      expect(JSON.stringify(finalRequest.messages)).toContain("workflow run completed");
      expect(res.toolCallsExecuted.map((t) => t.tool)).toEqual(["search_emails", "suggest_filter", "suggest_filter"]);
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining("Step 3"));
      expect(finalRequest.tools.map((t: { function: { name: string } }) => t.function.name)).not.toContain("send_email");
    });

    it("keeps a valid conversation when the model replies with prose on consecutive turns", async () => {
      const windowsFilter = {
        name: "Windows Insider", criteria: { from: "Windows Insider" },
        actions: { markRead: true, archive: true },
      };
      const responses = [
        { choices: [{ message: { role: "assistant", content: "I will look for Windows Insider emails." } }] },
        { choices: [{ message: { role: "assistant", content: "Let me inspect the sender first." } }] },
        tool("search_emails", { query: "Windows Insider" }),
        tool("suggest_filter", windowsFilter),
        { choices: [{ message: { role: "assistant", content: "The matching samples look correct; I will confirm the rule." } }] },
        tool("suggest_filter", windowsFilter),
      ];
      mockCreateChatCompletion.mockImplementation(async ({ messages }) => {
        if (messages.at(-1)?.role === "assistant") {
          throw new Error("400 Cannot have 2 or more assistant messages at the end of the list.");
        }
        for (let index = 1; index < messages.length; index++) {
          expect([messages[index - 1].role, messages[index].role]).not.toEqual(["assistant", "assistant"]);
        }
        const response = responses.shift();
        if (!response) throw new Error("Unexpected extra model call");
        return response;
      });
      const result = await suggestFilterWithPiAgent({
        prompt: "Mark as read and archive Windows Insider emails", accountId: "acc-1",
      });
      expect(result.filter).toEqual(windowsFilter);
      expect(mockCreateChatCompletion).toHaveBeenCalledTimes(6);
      expect(mockCreateChatCompletion.mock.calls[2][0].messages.at(-1)).toEqual({
        role: "user", content: expect.stringContaining("Continue using the available tools"),
      });
    });

    it("rejects zero matches and feeds the failure back so the agent revises", async () => {
      const wrong = { ...filter, criteria: { from: "notifications@github.com", subject: "nonexistent" } };
      search(); propose(wrong); propose(); propose();
      vi.mocked(getAffectedEmailsForFilter).mockResolvedValueOnce([]);
      const res = await suggestFilterWithPiAgent({ prompt: "Only automated notifications, at least one match", accountId: "acc-1" });
      expect(res.filter.criteria.subject).toBe("workflow run");
      expect(mockCreateChatCompletion).toHaveBeenCalledTimes(4);
      expect(JSON.stringify(mockCreateChatCompletion.mock.calls[2][0].messages)).toContain("ZERO emails");
    });

    it.each(["native", "text", "direct"])("rejects a one-shot %s proposal until the inbox is inspected", async (format) => {
      if (format === "native") propose();
      else mockCreateChatCompletion.mockResolvedValueOnce({ choices: [{ message: { role: "assistant", content: JSON.stringify(format === "text" ? { tool: "suggest_filter", parameters: filter } : filter) } }] });
      search(); propose(); propose();
      await suggestFilterWithPiAgent({ prompt: "Mark automated notifications read", accountId: "acc-1" });
      expect(mockCreateChatCompletion).toHaveBeenCalledTimes(4);
      expect(JSON.stringify(mockCreateChatCompletion.mock.calls[1][0].messages)).toContain("inspect real emails");
    });

    it("fails explicitly when no matching rule can be verified within the budget", async () => {
      search(); propose(); propose();
      vi.mocked(getAffectedEmailsForFilter).mockResolvedValue([]);
      await expect(suggestFilterWithPiAgent({ prompt: "Match something", accountId: "acc-1", maxSteps: 3 })).rejects.toThrow(/iteration limit/);
      expect(mockCreateChatCompletion).toHaveBeenCalledTimes(3);
    });

    it("does not accept two identical proposals in the same model turn", async () => {
      search();
      const batch = tool("suggest_filter", filter);
      batch.choices[0].message.tool_calls.push({ ...batch.choices[0].message.tool_calls[0], id: "second_proposal" });
      mockCreateChatCompletion.mockResolvedValueOnce(batch);
      propose();
      await suggestFilterWithPiAgent({ prompt: "Automated notifications", accountId: "acc-1" });
      expect(mockCreateChatCompletion).toHaveBeenCalledTimes(3);
    });

    it("uses the same iterative Pi runtime on Android", async () => {
      const userAgent = vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Android");
      mockAiCoreComplete.mockReset()
        .mockResolvedValueOnce(JSON.stringify({ tool: "search_emails", parameters: { query: "GitHub" } }))
        .mockResolvedValueOnce(JSON.stringify({ tool: "suggest_filter", parameters: filter }))
        .mockResolvedValueOnce(JSON.stringify({ tool: "suggest_filter", parameters: filter }));
      try {
        const result = await suggestFilterWithPiAgent({ prompt: "Only automated notifications", accountId: "acc-1" });
        expect(result.filter).toEqual(filter);
        expect(mockAiCoreComplete).toHaveBeenCalledTimes(3);
        expect(mockCreateChatCompletion).not.toHaveBeenCalled();
        expect(mockAiCoreComplete.mock.calls[2][0].userContent).toContain("workflow run completed");
      } finally { userAgent.mockRestore(); }
    });

    it("reports an unexpressible request rather than inventing a successful filter", async () => {
      search();
      mockCreateChatCompletion.mockResolvedValueOnce(tool("cannot_create_filter", { reason: "Human comments cannot be excluded reliably by these substring criteria." }));
      await expect(suggestFilterWithPiAgent({ prompt: "Exclude all human comments", accountId: "acc-1" })).rejects.toThrow(/cannot be excluded reliably/);
      expect(getAffectedEmailsForFilter).not.toHaveBeenCalled();
    });

    it("rejects unsupported exclusion criteria instead of silently dropping them", async () => {
      search();
      mockCreateChatCompletion.mockResolvedValueOnce(tool("suggest_filter", { ...filter, criteria: { from: "github.com", notBody: "commented" } }));
      propose(); propose();
      await suggestFilterWithPiAgent({ prompt: "Exclude comments", accountId: "acc-1" });
      expect(JSON.stringify(mockCreateChatCompletion.mock.calls[2][0].messages)).toContain("unsupported criteria notBody");
      expect(getAffectedEmailsForFilter).toHaveBeenCalledTimes(2);
    });

    it("replaces the SDK connection error with the server address", async () => {
      mockCreateChatCompletion.mockRejectedValueOnce(new Error("Connection error."));
      await expect(suggestFilterWithPiAgent({ prompt: "Archive newsletters", accountId: "acc-1" })).rejects.toThrow(/127\.0\.0\.1:3000/);
    });
  });
});
