import { describe, it, expect, vi, beforeEach } from "vitest";
import { askMyInbox } from "./askInbox";

vi.mock("./providerManager", () => ({
  getActiveProviderName: vi.fn(),
}));

vi.mock("./piEmailAgent", () => ({
  runPiEmailAgent: vi.fn(),
}));

vi.mock("@/services/db/search", () => ({
  searchMessages: vi.fn(),
}));

vi.mock("./aiService", () => ({
  askInbox: vi.fn(),
}));

import { getActiveProviderName } from "./providerManager";
import { runPiEmailAgent } from "./piEmailAgent";
import { searchMessages } from "@/services/db/search";
import { askInbox as callAskInbox } from "./aiService";

describe("askMyInbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to runPiEmailAgent when active provider is pi", async () => {
    vi.mocked(getActiveProviderName).mockResolvedValueOnce("pi");
    vi.mocked(runPiEmailAgent).mockResolvedValueOnce({
      answer: "You have 3 unread emails from your manager.",
      sourceMessages: [
        {
          message_id: "m-1",
          account_id: "acc-1",
          thread_id: "t-1",
          subject: "Urgent Sync",
          from_name: "Manager",
          from_address: "manager@corp.com",
          snippet: "Please review the deck.",
          date: 1773500000000,
          rank: 0,
        },
      ],
      toolCallsExecuted: [
        {
          tool: "search_emails",
          args: { query: "manager", is_unread: true },
          output: "Found 1 email",
        },
      ],
    });

    const result = await askMyInbox("What did my manager say?", "acc-1");

    expect(runPiEmailAgent).toHaveBeenCalledWith({
      question: "What did my manager say?",
      accountId: "acc-1",
    });
    expect(result.answer).toBe("You have 3 unread emails from your manager.");
    expect(result.sourceMessages).toHaveLength(1);
    expect(searchMessages).not.toHaveBeenCalled();
  });

  it("falls back to standard search and callAskInbox when provider is not pi", async () => {
    vi.mocked(getActiveProviderName).mockResolvedValueOnce("gemini");
    vi.mocked(searchMessages).mockResolvedValueOnce([
      {
        message_id: "m-99",
        account_id: "acc-1",
        thread_id: "t-99",
        subject: "Invoice #1042",
        from_name: "Billing",
        from_address: "billing@acme.com",
        snippet: "Invoice attached for payment.",
        date: 1773500000000,
        rank: 0,
      },
    ]);
    vi.mocked(callAskInbox).mockResolvedValueOnce("Your invoice #1042 was sent on March 14.");

    const result = await askMyInbox("Where is my invoice?", "acc-1");

    expect(runPiEmailAgent).not.toHaveBeenCalled();
    expect(searchMessages).toHaveBeenCalledWith("invoice", "acc-1", 15);
    expect(result.answer).toBe("Your invoice #1042 was sent on March 14.");
    expect(result.sourceMessages).toHaveLength(1);
  });

  it("falls back to standard search if pi email agent throws an error", async () => {
    vi.mocked(getActiveProviderName).mockResolvedValueOnce("pi");
    vi.mocked(runPiEmailAgent).mockRejectedValueOnce(new Error("Connection refused"));
    vi.mocked(searchMessages).mockResolvedValueOnce([
      {
        message_id: "m-fallback",
        account_id: "acc-1",
        thread_id: "t-fallback",
        subject: "Fallback topic",
        from_name: "Support",
        from_address: "support@example.com",
        snippet: "Fallback preview",
        date: 1773500000000,
        rank: 0,
      },
    ]);
    vi.mocked(callAskInbox).mockResolvedValueOnce("Answer from fallback path.");

    const result = await askMyInbox("Tell me about the fallback topic", "acc-1");

    expect(result.answer).toBe("Answer from fallback path.");
    expect(result.sourceMessages).toHaveLength(1);
  });
});
