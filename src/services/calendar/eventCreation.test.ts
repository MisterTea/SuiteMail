import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEventData } from "./types";
import { createCalendarEvent, getCreatedSuggestion, loadEventTargets, type EventTarget } from "./eventCreation";
const mocks = vi.hoisted(() => ({ create: vi.fn(), list: vi.fn(), support: vi.fn(), getCache: vi.fn(), setCache: vi.fn(), upsertEvent: vi.fn(), upsertCalendar: vi.fn() }));
vi.mock("./providerFactory", () => ({ hasCalendarSupport: mocks.support, getCalendarProvider: async () => ({ type: "google_api", createEvent: mocks.create, listCalendars: mocks.list }) }));
vi.mock("@/services/db/aiCache", () => ({ getAiCache: mocks.getCache, setAiCache: mocks.setCache }));
vi.mock("@/services/db/calendars", () => ({ upsertCalendar: mocks.upsertCalendar }));
vi.mock("@/services/db/calendarEvents", () => ({ upsertCalendarEvent: mocks.upsertEvent }));
const target = { id: "calendar", account_id: "target-account", remote_id: "primary", accountEmail: "me@example.com", canCreate: true, canInvite: true } as EventTarget;
const input = { summary: "Review", startTime: "2030-01-01T12:00:00Z", endTime: "2030-01-01T13:00:00Z", attendees: [{ email: "bob@example.com" }, { email: "BOB@example.com" }, { email: "me@example.com" }] };
const event = { remoteEventId: "remote", summary: "Review", startTime: Date.parse(input.startTime) / 1000, endTime: Date.parse(input.endTime) / 1000 } as CalendarEventData;
const source = (id: string) => ({ accountId: "source-account", threadId: "thread", messageId: id, suggestionId: "suggestion" });

describe("provider-backed calendar creation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value), get length() { return storage.size; } });
    mocks.create.mockResolvedValue(event); mocks.getCache.mockResolvedValue(null); mocks.setCache.mockResolvedValue(undefined);
    mocks.upsertEvent.mockResolvedValue(undefined); mocks.upsertCalendar.mockResolvedValue("calendar");
    mocks.support.mockResolvedValue(true); mocks.list.mockResolvedValue([{ remoteId: "primary", displayName: "Work", isPrimary: true, canCreate: true, canInvite: true }]);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uses the selected account, sends reviewed unique invitees and saves the provider identity", async () => {
    const receipt = await createCalendarEvent(target, input, source("reviewed"));
    expect(mocks.create).toHaveBeenCalledWith("primary", expect.objectContaining({ attendees: [{ email: "bob@example.com" }], organizerEmail: "me@example.com" }));
    expect(mocks.upsertEvent).toHaveBeenCalledWith(expect.objectContaining({ accountId: "target-account", calendarId: "calendar", remoteEventId: "remote" }));
    expect(receipt.accountId).toBe("target-account");
    expect(await getCreatedSuggestion(source("reviewed"))).toEqual(receipt);
  });

  it("deduplicates concurrent clicks and reopening a created suggestion", async () => {
    const requests = await Promise.all([createCalendarEvent(target, input, source("concurrent")), createCalendarEvent(target, input, source("concurrent"))]);
    expect(requests[0]).toEqual(requests[1]);
    await createCalendarEvent(target, input, source("concurrent"));
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("does not recreate a remotely successful event when local caching fails", async () => {
    mocks.upsertEvent.mockRejectedValue(new Error("disk unavailable"));
    mocks.setCache.mockRejectedValue(new Error("disk unavailable"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await createCalendarEvent(target, input, source("cache-failure"));
    await createCalendarEvent(target, input, source("cache-failure"));
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(localStorage.length).toBe(1);
    warning.mockRestore();
  });

  it("loads a durable receipt before attempting another remote creation", async () => {
    mocks.getCache.mockResolvedValue(JSON.stringify({ accountId: "different-account", calendarId: "old-calendar", event }));
    const result = await createCalendarEvent(target, input, source("restored"));
    expect(result.accountId).toBe("different-account");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects read-only, invitation-incapable and invalid targets before writes", async () => {
    await expect(createCalendarEvent({ ...target, canCreate: false }, input)).rejects.toThrow("read-only");
    await expect(createCalendarEvent({ ...target, canInvite: false }, input)).rejects.toThrow("cannot send invitations");
    await expect(createCalendarEvent(target, { ...input, attendees: [{ email: "not an address" }] })).rejects.toThrow("valid invitee");
    await expect(createCalendarEvent(target, { ...input, endTime: input.startTime })).rejects.toThrow("end time");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("allows personal events on calendars without invitation support", async () => {
    await createCalendarEvent({ ...target, canInvite: false }, { ...input, attendees: [] });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("keeps discovery errors visible while allowing calendars from other accounts", async () => {
    mocks.list.mockRejectedValueOnce(new Error("reauthorize"));
    const result = await loadEventTargets([{ id: "bad", email: "bad@example.com" }, { id: "good", email: "good@example.com" }]);
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]).toMatchObject({ account_id: "good", canInvite: true });
    expect(result.errors[0]).toContain("reauthorize");
  });
});
