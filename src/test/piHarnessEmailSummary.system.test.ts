import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory stores to simulate persistent database state across the system
const inMemorySettings: Record<string, string> = {};
const inMemoryAiCache: Record<string, string> = {};

vi.mock("@/services/db/settings", () => ({
  getSetting: vi.fn(async (key: string) => inMemorySettings[key] ?? null),
  setSetting: vi.fn(async (key: string, val: string) => {
    inMemorySettings[key] = val;
  }),
  getSecureSetting: vi.fn(async (key: string) => inMemorySettings[key] ?? null),
  setSecureSetting: vi.fn(async (key: string, val: string) => {
    inMemorySettings[key] = val;
  }),
}));

vi.mock("@/services/db/aiCache", () => ({
  getAiCache: vi.fn(async (accountId: string, threadId: string, type: string) => {
    return inMemoryAiCache[`${accountId}:${threadId}:${type}`] ?? null;
  }),
  setAiCache: vi.fn(async (accountId: string, threadId: string, type: string, content: string) => {
    inMemoryAiCache[`${accountId}:${threadId}:${type}`] = content;
  }),
  deleteAiCache: vi.fn(async (accountId: string, threadId: string, type: string) => {
    delete inMemoryAiCache[`${accountId}:${threadId}:${type}`];
  }),
}));

const mockFetch = vi.fn();
vi.mock("@/platform", async () => {
  const actual = await vi.importActual<typeof import("@/platform")>("@/platform");
  return {
    ...actual,
    platformFetch: (...args: unknown[]) => mockFetch(...args),
  };
});

import { summarizeThread } from "@/services/ai/aiService";
import { clearProviderClients, getActiveProviderName } from "@/services/ai/providerManager";
import type { DbMessage } from "@/services/db/messages";

describe("System Test: Email Summarization with Pi Harness and local Gemma 4 E4B", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearProviderClients();
    for (const key of Object.keys(inMemorySettings)) delete inMemorySettings[key];
    for (const key of Object.keys(inMemoryAiCache)) delete inMemoryAiCache[key];
  });

  const sampleEmailThread: DbMessage[] = [
    {
      id: "msg-101",
      account_id: "acc-user-1",
      thread_id: "thread-release-42",
      from_address: "lead-dev@company.com",
      from_name: "Sarah Chen",
      to_addresses: "team@company.com",
      cc_addresses: null,
      bcc_addresses: null,
      reply_to: null,
      subject: "Production Release v1.4.0 — Schedule & Verification Checklist",
      snippet: "Hi team, we are scheduling the deployment of v1.4.0 for tonight at 22:00 UTC...",
      date: 1740000000000,
      is_read: 1,
      is_starred: 0,
      body_html: null,
      body_text:
        "Hi team,\n\nWe are scheduling the deployment of v1.4.0 for tonight at 22:00 UTC.\nPlease verify all database migration scripts and confirm stage testing.\n\nBest,\nSarah",
      body_cached: 1,
      raw_size: 1024,
      internal_date: 1740000000000,
      list_unsubscribe: null,
    },
    {
      id: "msg-102",
      account_id: "acc-user-1",
      thread_id: "thread-release-42",
      from_address: "db-admin@company.com",
      from_name: "Alex Rivera",
      to_addresses: "team@company.com",
      cc_addresses: null,
      bcc_addresses: null,
      reply_to: null,
      subject: "Re: Production Release v1.4.0 — Schedule & Verification Checklist",
      snippet: "Database migrations have been validated on staging and full backup is ready...",
      date: 1740003600000,
      is_read: 1,
      is_starred: 0,
      body_html: null,
      body_text:
        "Database migrations have been validated on staging and full backup is ready. Green light from database team.\n\n- Alex",
      body_cached: 1,
      raw_size: 512,
      internal_date: 1740003600000,
      list_unsubscribe: null,
    },
    {
      id: "msg-103",
      account_id: "acc-user-1",
      thread_id: "thread-release-42",
      from_address: "lead-dev@company.com",
      from_name: "Sarah Chen",
      to_addresses: "team@company.com",
      cc_addresses: null,
      bcc_addresses: null,
      reply_to: null,
      subject: "Re: Production Release v1.4.0 — Schedule & Verification Checklist",
      snippet: "Deployment complete. Smoke tests passed 100% and metrics are green...",
      date: 1740007200000,
      is_read: 0,
      is_starred: 1,
      body_html: null,
      body_text:
        "Deployment complete. All smoke tests passed 100%, and production latency metrics are green. Thanks everyone!\n\nSarah",
      body_cached: 1,
      raw_size: 600,
      internal_date: 1740007200000,
      list_unsubscribe: null,
    },
  ];

  it("configures Pi harness with local Gemma 4 E4B model and summarizes an email thread", async () => {
    // 1. Configure the app settings to use Pi Harness with local Gemma 4 e4b
    inMemorySettings["ai_enabled"] = "true";
    inMemorySettings["ai_provider"] = "pi";
    inMemorySettings["pi_server_url"] = "http://localhost:18420";
    inMemorySettings["pi_model"] = "gemma-4-e4b";

    expect(await getActiveProviderName()).toBe("pi");

    // 2. Mock the local Pi Harness server response from Gemma 4 e4b
    const gemmaSummaryText =
      "Sarah Chen scheduled and executed the production release of v1.4.0 at 22:00 UTC. Alex Rivera confirmed that database migrations and backups were verified on staging. Deployment completed successfully with 100% smoke test pass rate and normal production metrics.";

    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "chatcmpl-pi-harness-gemma-4-e4b",
          object: "chat.completion",
          created: 1740008000,
          model: "gemma-4-e4b",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: gemmaSummaryText,
              },
              finish_reason: "stop",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    // 3. Trigger email thread summarization through the AI service layer
    const summary = await summarizeThread(
      "thread-release-42",
      "acc-user-1",
      sampleEmailThread,
    );

    // 4. Verify the summary returned by the local Gemma 4 E4B model
    expect(summary).toBe(gemmaSummaryText);

    // 5. Verify the HTTP payload sent to the local Pi Harness endpoint
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe("http://127.0.0.1:18420/v1/chat/completions");
    expect(calledOptions.method).toBe("POST");

    const sentBody = JSON.parse(calledOptions.body as string);
    expect(sentBody.model).toBe("gemma-4-e4b");
    expect(sentBody.messages).toHaveLength(2);
    expect(sentBody.messages[0].role).toBe("system");
    expect(sentBody.messages[1].role).toBe("user");
    expect(sentBody.messages[1].content).toContain("Production Release v1.4.0");
    expect(sentBody.messages[1].content).toContain("Sarah Chen");
    expect(sentBody.messages[1].content).toContain("Alex Rivera");

    // 6. Verify result is cached in the local AI cache
    expect(inMemoryAiCache["acc-user-1:thread-release-42:summary"]).toBe(gemmaSummaryText);

    // 7. Verify subsequent summarization call uses cache without re-querying Pi harness
    const cachedSummary = await summarizeThread(
      "thread-release-42",
      "acc-user-1",
      sampleEmailThread,
    );
    expect(cachedSummary).toBe(gemmaSummaryText);
    expect(mockFetch).toHaveBeenCalledTimes(1); // No new network call
  });

  it("supports switching to Gemma 4 E4B Instruct model variant dynamically", async () => {
    inMemorySettings["ai_enabled"] = "true";
    inMemorySettings["ai_provider"] = "pi";
    inMemorySettings["pi_server_url"] = "http://localhost:18420";
    inMemorySettings["pi_model"] = "gemma-4-e4b-it";

    const instructSummary =
      "• Release v1.4.0 deployed at 22:00 UTC\n• DB migrations & backup verified beforehand\n• All smoke tests 100% pass";

    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "chatcmpl-pi-harness-gemma-4-e4b-it",
          object: "chat.completion",
          created: 1740008500,
          model: "gemma-4-e4b-it",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: instructSummary,
              },
              finish_reason: "stop",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const summary = await summarizeThread(
      "thread-instruct-test",
      "acc-user-1",
      sampleEmailThread.slice(0, 1),
    );

    expect(summary).toBe(instructSummary);
    const [, calledOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
    const sentBody = JSON.parse(calledOptions.body as string);
    expect(sentBody.model).toBe("gemma-4-e4b-it");
  });

  it("handles offline or unreachable local Pi harness server gracefully", async () => {
    inMemorySettings["ai_enabled"] = "true";
    inMemorySettings["ai_provider"] = "pi";
    inMemorySettings["pi_server_url"] = "http://localhost:18420";
    inMemorySettings["pi_model"] = "gemma-4-e4b";

    mockFetch.mockRejectedValueOnce(
      new TypeError("fetch failed: ECONNREFUSED http://localhost:18420"),
    );

    await expect(
      summarizeThread("thread-release-42", "acc-user-1", sampleEmailThread),
    ).rejects.toThrow();
  });
});
