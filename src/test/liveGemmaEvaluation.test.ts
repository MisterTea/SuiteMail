import { describe, it, expect, vi } from "vitest";
import { runPiEmailAgent } from "@/services/ai/piEmailAgent";
import { SYNTHETIC_ACCOUNT_ID, createSyntheticToolExecutor } from "./syntheticInbox";

// Route tools to synthetic inbox
const syntheticExecutor = createSyntheticToolExecutor();
vi.mock("@/services/ai/piEmailTools", async () => {
  const actual = await vi.importActual<typeof import("@/services/ai/piEmailTools")>("@/services/ai/piEmailTools");
  return {
    ...actual,
    executePiEmailTool: vi.fn((toolName, args, accountId) =>
      syntheticExecutor(toolName, args, accountId),
    ),
  };
});

describe("Live AI Evaluation: Gemma 4 E4B on Local Llama Server", () => {
  const serverUrl = "http://127.0.0.1:18420";
  const model = "gemma-4-e4b";

  it("Prompt 1 (Flight Itinerary): accurately extracts date, flight number, and confirmation code", async () => {
    const question = "When is my flight to San Francisco, what is the flight number, and what is the confirmation code?";

    const result = await runPiEmailAgent({
      question,
      accountId: SYNTHETIC_ACCOUNT_ID,
      serverUrl,
      model,
    });

    console.log("\n[Prompt 1 Answer]:", result.answer);
    console.log("[Tools Executed]:", result.toolCallsExecuted.map((t) => t.tool));

    expect(result.toolCallsExecuted.length).toBeGreaterThan(0);
    expect(result.answer).toMatch(/UA-402|402/i);
    expect(result.answer).toMatch(/SF-9042|9042/i);
    expect(result.answer).toMatch(/March 25|25th/i);
  }, 45000);

  it("Prompt 2 (Meeting Reschedule): accurately identifies rescheduled day, time, and conference room", async () => {
    const question = "What day and time was the Project Phoenix meeting rescheduled to, and in which room?";

    const result = await runPiEmailAgent({
      question,
      accountId: SYNTHETIC_ACCOUNT_ID,
      serverUrl,
      model,
    });

    console.log("\n[Prompt 2 Answer]:", result.answer);
    console.log("[Tools Executed]:", result.toolCallsExecuted.map((t) => t.tool));

    expect(result.toolCallsExecuted.length).toBeGreaterThan(0);
    expect(result.answer).toMatch(/Thursday/i);
    expect(result.answer).toMatch(/2:00|2 PM/i);
    expect(result.answer).toMatch(/Room B/i);
  }, 45000);

  it("Prompt 3 (Invoice Amount & Payment Method): extracts exact billing total and card brand", async () => {
    const question = "How much was the CloudServices invoice for March 2026 and what payment method was used?";

    const result = await runPiEmailAgent({
      question,
      accountId: SYNTHETIC_ACCOUNT_ID,
      serverUrl,
      model,
    });

    console.log("\n[Prompt 3 Answer]:", result.answer);
    console.log("[Tools Executed]:", result.toolCallsExecuted.map((t) => t.tool));

    expect(result.toolCallsExecuted.length).toBeGreaterThan(0);
    expect(result.answer).toMatch(/249/);
    expect(result.answer).toMatch(/Mastercard|8812/i);
  }, 45000);

  it("Prompt 4 (Urgent Unread Budget): identifies sender and requested dollar amount", async () => {
    const question = "Do I have any urgent unread emails requesting budget approval? Who sent it and for how much?";

    const result = await runPiEmailAgent({
      question,
      accountId: SYNTHETIC_ACCOUNT_ID,
      serverUrl,
      model,
    });

    console.log("\n[Prompt 4 Answer]:", result.answer);
    console.log("[Tools Executed]:", result.toolCallsExecuted.map((t) => t.tool));

    expect(result.toolCallsExecuted.length).toBeGreaterThan(0);
    expect(result.answer).toMatch(/Dave|Vance/i);
    expect(result.answer).toMatch(/45,000|45000|\$45k/i);
  }, 45000);

  it("Prompt 5 (Negative check): correctly reports absence of non-existent emails without hallucinating", async () => {
    const question = "Did anyone email me about dental insurance?";

    const result = await runPiEmailAgent({
      question,
      accountId: SYNTHETIC_ACCOUNT_ID,
      serverUrl,
      model,
    });

    console.log("\n[Prompt 5 Answer]:", result.answer);
    console.log("[Tools Executed]:", result.toolCallsExecuted.map((t) => t.tool));

    expect(result.answer).toMatch(/no|not found|didn't find|no email|none/i);
  }, 45000);
});
