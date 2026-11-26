import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import type { DbMessage } from "@/services/db/messages";
import { getCalendarSuggestions, parseCalendarSuggestions } from "./calendarSuggestions";

const mocks = vi.hoisted(() => ({ available: vi.fn(), complete: vi.fn(), getCache: vi.fn(), setCache: vi.fn() }));
vi.mock("./providerManager", () => ({ isAiAvailable: mocks.available, getActiveProvider: async () => ({ complete: mocks.complete }) }));
vi.mock("@/services/db/aiCache", () => ({ getAiCache: mocks.getCache, setAiCache: mocks.setCache }));
const message = { id: "event-message", account_id: "a", thread_id: "t", from_address: "bob@example.com", to_addresses: "me@example.com, team@example.com",
  cc_addresses: null, subject: "Design review", date: Date.parse("2030-01-01T12:00:00Z"), body_text: "Let's meet tomorrow at 3pm with bob@example.com.", body_html: null } as DbMessage;
const event = { title: "Design review", startTime: "2030-01-02T15:00:00-06:00", endTime: null, timeZone: "America/Chicago", isAllDay: false,
  timeZoneExplicit: true, attendees: ["bob@example.com", "BOB@example.com", "me@example.com", "invented@example.com"], evidence: "Let's meet tomorrow at 3pm", missingDetails: [] };
const raw = (events: unknown[]) => JSON.stringify({ events });

describe("calendar suggestion extraction", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", webcrypto);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T18:00:00Z"));
    vi.resetAllMocks();
    mocks.available.mockResolvedValue(true);
    mocks.getCache.mockResolvedValue(null);
    mocks.setCache.mockResolvedValue(undefined);
    mocks.complete.mockResolvedValue(raw([event]));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("extracts timezone-aware times, suggests a duration and only accepts real participant addresses", async () => {
    const [result] = await parseCalendarSuggestions(raw([event]), message, "me@example.com", "UTC");
    expect(result).toMatchObject({ title: "Design review", startTime: event.startTime, endTime: "2030-01-02T22:00:00.000Z", attendees: ["bob@example.com"], timeZone: "America/Chicago" });
    expect(result?.missingDetails.join(" ")).toContain("One-hour");
  });

  it("keeps unclear meeting times blank and flags unresolved details", async () => {
    const [result] = await parseCalendarSuggestions(raw([{ ...event, startTime: "sometime", timeZone: null, timeZoneExplicit: false, missingDetails: ["Which day?", "Email address for Alice"] }]), message, "me@example.com", "UTC");
    expect(result?.startTime).toBeNull();
    expect(result?.endTime).toBeNull();
    expect(result?.missingDetails.join(" ")).toContain("Email address for Alice");
    expect(result?.missingDetails.join(" ")).toContain("Timezone assumed: UTC");
  });

  it("validates evidence, past events, cancellations, recurrence and malformed results", async () => {
    const result = await parseCalendarSuggestions(raw([
      { ...event, evidence: "Not present" }, { ...event, cancelled: true }, { ...event, startTime: "2020-01-01T12:00:00Z", endTime: null },
    ]), message, "me@example.com", "UTC");
    expect(result).toEqual([]);
    expect(await parseCalendarSuggestions(raw([{ ...event, recurring: true }]), message, "me@example.com", "UTC")).toEqual([]);
    await expect(parseCalendarSuggestions("nonsense", message, "me@example.com", "UTC")).rejects.toThrow();
    await expect(parseCalendarSuggestions('{"events":{}}', message, "me@example.com", "UTC")).rejects.toThrow();
  });

  it("rejects impossible dates and timezone-less times instead of guessing", async () => {
    for (const startTime of ["2030-02-30T12:00:00Z", "2030-01-02T12:00:00"]) {
      const [result] = await parseCalendarSuggestions(raw([{ ...event, startTime }]), message, "me@example.com", "UTC");
      expect(result?.startTime).toBeNull();
    }
  });

  it("handles fenced JSON, all-day dates and HTML-only content", async () => {
    const htmlMessage = { ...message, body_text: null, body_html: "<p>Team offsite next week</p><script>bad()</script>" };
    const [result] = await parseCalendarSuggestions('```json\n' + raw([{ ...event, evidence: "Team offsite", startTime: "2030-01-05", isAllDay: true }]) + '\n```', htmlMessage, "me@example.com", "UTC");
    expect(result).toMatchObject({ isAllDay: true, startTime: "2030-01-05", endTime: "2030-01-06" });
  });

  it("limits distinct suggestions to three", async () => {
    const results = await parseCalendarSuggestions(raw([event, { ...event, title: "Two" }, { ...event, title: "Three" }, { ...event, title: "Four" }]), message, "me@example.com", "UTC");
    expect(results).toHaveLength(3);
  });

  it("deduplicates simultaneous analyses and uses the content fingerprint cache", async () => {
    const [first, second] = await Promise.all([getCalendarSuggestions(message, [], "me@example.com"), getCalendarSuggestions(message, [], "me@example.com")]);
    expect(first).toEqual(second);
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    const cache = mocks.setCache.mock.calls[0]![3];
    mocks.getCache.mockResolvedValue(cache);
    await getCalendarSuggestions(message, [], "me@example.com");
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    await getCalendarSuggestions({ ...message, body_text: message.body_text + " New details" }, [], "me@example.com");
    expect(mocks.complete).toHaveBeenCalledTimes(2);
    expect(mocks.complete.mock.calls[0]![0].userContent).toContain("2030-01-01T12:00:00.000Z");
    expect(mocks.complete.mock.calls[0]![0].systemPrompt).toContain("untrusted data");
  });

  it("caches negative results and does nothing when AI is disabled", async () => {
    mocks.complete.mockResolvedValue(raw([]));
    expect(await getCalendarSuggestions(message, [], "me@example.com")).toEqual([]);
    mocks.getCache.mockResolvedValue(mocks.setCache.mock.calls[0]![3]);
    await getCalendarSuggestions(message, [], "me@example.com");
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    mocks.available.mockResolvedValue(false);
    expect(await getCalendarSuggestions(message, [], "me@example.com")).toEqual([]);
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });

  it("skips AI extraction when an .ics attachment is present", async () => {
    expect(await getCalendarSuggestions(message, [], "me@example.com", [{ filename: "invite.ICS", mime_type: "application/octet-stream" }])).toEqual([]);
    expect(await getCalendarSuggestions(message, [], "me@example.com", [{ filename: null, mime_type: "text/calendar; charset=utf-8" }])).toEqual([]);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("does not cache failed provider calls and allows a later retry", async () => {
    mocks.complete.mockRejectedValueOnce(new Error("offline"));
    await expect(getCalendarSuggestions(message, [], "me@example.com")).rejects.toThrow("offline");
    expect(mocks.setCache).not.toHaveBeenCalled();
    expect(await getCalendarSuggestions(message, [], "me@example.com")).toHaveLength(1);
  });
});
