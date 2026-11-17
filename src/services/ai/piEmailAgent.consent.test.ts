import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPiEmailAgent } from "./piEmailAgent";

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

describe("piEmailAgent - Agentic Loop Consent Termination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stops agentic loop immediately when consent is refused for send_email", async () => {
    // LLM decides to call send_email
    mockCreateChatCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_send_1",
                type: "function",
                function: {
                  name: "send_email",
                  arguments: JSON.stringify({
                    to: ["boss@example.com"],
                    subject: "Project Status",
                    body: "We are on track.",
                  }),
                },
              },
            ],
          },
        },
      ],
    });

    // Tool execution simulates consent refusal
    vi.mocked(executePiEmailTool).mockResolvedValueOnce({
      text: "Consent was refused by the user for sending email. Action was cancelled.",
      consentRefused: true,
    });

    const onConsentRequest = vi.fn().mockResolvedValue(false);

    const result = await runPiEmailAgent({
      question: "Send an update to boss@example.com",
      accountId: "acc-1",
      onConsentRequest,
      maxSteps: 5,
    });

    // 1. Loop must stop immediately!
    expect(result.consentRefused).toBe(true);
    expect(result.answer).toContain("User refused consent for 'send_email'");
    expect(result.toolCallsExecuted).toHaveLength(1);
    expect(result.toolCallsExecuted[0]?.tool).toBe("send_email");

    // 2. LLM chat completions must NOT have been called for subsequent steps
    expect(mockCreateChatCompletion).toHaveBeenCalledTimes(1);
  });

  it("stops agentic loop immediately when consent is refused for delete_emails", async () => {
    mockCreateChatCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_del_1",
                type: "function",
                function: {
                  name: "delete_emails",
                  arguments: JSON.stringify({
                    thread_ids: ["thread-spam-123"],
                    permanent: true,
                  }),
                },
              },
            ],
          },
        },
      ],
    });

    vi.mocked(executePiEmailTool).mockResolvedValueOnce({
      text: "Consent was refused by the user for deleting emails. Action was cancelled.",
      consentRefused: true,
    });

    const result = await runPiEmailAgent({
      question: "Permanently delete spam email thread 123",
      accountId: "acc-1",
    });

    expect(result.consentRefused).toBe(true);
    expect(result.answer).toContain("User refused consent for 'delete_emails'");
    expect(mockCreateChatCompletion).toHaveBeenCalledTimes(1);
  });

  it("stops subsequent tool calls in the same turn if consent is refused", async () => {
    mockCreateChatCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_move_1",
                type: "function",
                function: {
                  name: "move_emails",
                  arguments: JSON.stringify({ thread_ids: ["t-1"], folder: "Trash" }),
                },
              },
              {
                id: "call_move_2",
                type: "function",
                function: {
                  name: "move_emails",
                  arguments: JSON.stringify({ thread_ids: ["t-2"], folder: "Trash" }),
                },
              },
            ],
          },
        },
      ],
    });

    // First tool call refuses consent
    vi.mocked(executePiEmailTool).mockResolvedValueOnce({
      text: "Consent was refused by user.",
      consentRefused: true,
    });

    const result = await runPiEmailAgent({
      question: "Move thread 1 and 2 to Trash",
      accountId: "acc-1",
    });

    expect(result.consentRefused).toBe(true);
    // Only first tool call should have executed; second was aborted
    expect(executePiEmailTool).toHaveBeenCalledTimes(1);
    expect(mockCreateChatCompletion).toHaveBeenCalledTimes(1);
  });

  it("stops agentic loop for text-based JSON tool invocation when consent is refused", async () => {
    mockCreateChatCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: "assistant",
            content: "```json\n{\"tool\": \"relabel_emails\", \"parameters\": {\"thread_ids\": [\"t-1\"], \"add_labels\": [\"Archive\"]}}\n```",
          },
        },
      ],
    });

    vi.mocked(executePiEmailTool).mockResolvedValueOnce({
      text: "Consent was refused by user.",
      consentRefused: true,
    });

    const result = await runPiEmailAgent({
      question: "Relabel thread 1 to Archive",
      accountId: "acc-1",
    });

    expect(result.consentRefused).toBe(true);
    expect(result.answer).toContain("User refused consent for 'relabel_emails'");
    expect(mockCreateChatCompletion).toHaveBeenCalledTimes(1);
  });

  it("continues the agentic loop when consent is approved", async () => {
    // Turn 1: LLM invokes send_email
    mockCreateChatCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_send_ok",
                type: "function",
                function: {
                  name: "send_email",
                  arguments: JSON.stringify({
                    to: ["friend@example.com"],
                    subject: "Coffee",
                    body: "Want to get coffee?",
                  }),
                },
              },
            ],
          },
        },
      ],
    });

    // Tool execution succeeds (consent was granted)
    vi.mocked(executePiEmailTool).mockResolvedValueOnce({
      text: "Email sent successfully to friend@example.com.",
    });

    // Turn 2: LLM receives success and produces final answer
    mockCreateChatCompletion.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: "assistant",
            content: "I have sent the email inviting friend@example.com to coffee.",
          },
        },
      ],
    });

    const onConsentRequest = vi.fn().mockResolvedValue(true);

    const result = await runPiEmailAgent({
      question: "Send email to friend@example.com about coffee",
      accountId: "acc-1",
      onConsentRequest,
    });

    expect(result.consentRefused).toBeFalsy();
    expect(result.answer).toBe("I have sent the email inviting friend@example.com to coffee.");
    expect(mockCreateChatCompletion).toHaveBeenCalledTimes(2);
  });
});
