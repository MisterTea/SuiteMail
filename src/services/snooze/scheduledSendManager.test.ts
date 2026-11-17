import { describe, it, expect, vi, beforeEach } from "vitest";
import { calculateNextScheduledOccurrence } from "./scheduledSendManager";

describe("scheduledSendManager", () => {
  const baseTimestamp = 1700000000; // Wed, 14 Nov 2023 22:13:20 UTC

  it("calculates daily next occurrence exactly 1 day ahead", () => {
    const next = calculateNextScheduledOccurrence(baseTimestamp, "daily");
    expect(next - baseTimestamp).toBe(86400); // 24 hours in seconds
  });

  it("calculates weekly next occurrence exactly 7 days ahead", () => {
    const next = calculateNextScheduledOccurrence(baseTimestamp, "weekly");
    expect(next - baseTimestamp).toBe(86400 * 7);
  });

  it("calculates weekdays next occurrence skipping weekends", () => {
    // Friday timestamp
    const friday = new Date("2026-11-20T10:00:00Z").getTime() / 1000;
    const next = calculateNextScheduledOccurrence(friday, "weekdays");
    const nextDate = new Date(next * 1000);
    // Should be Monday (day 1)
    expect(nextDate.getUTCDay()).toBe(1);
  });

  it("calculates monthly next occurrence ~1 month ahead", () => {
    const jan15 = new Date("2026-01-15T10:00:00Z").getTime() / 1000;
    const next = calculateNextScheduledOccurrence(jan15, "monthly");
    const nextDate = new Date(next * 1000);
    expect(nextDate.getUTCMonth()).toBe(1); // February
    expect(nextDate.getUTCDate()).toBe(15);
  });
});
