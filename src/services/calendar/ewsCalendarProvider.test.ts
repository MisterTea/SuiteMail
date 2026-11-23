import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockImapAccount } from "@/test/mocks/entities.mock";
import { EwsCalendarProvider } from "./ewsCalendarProvider";
import { getAccount } from "@/services/db/accounts";
import { ensureFreshToken } from "@/services/oauth/oauthTokenManager";
import { platformInvoke } from "@/platform";
import { clearAllCalendarProviders, getCalendarProvider, hasCalendarSupport } from "./providerFactory";

vi.mock("@/platform", () => ({ platformInvoke: vi.fn() }));
vi.mock("@/services/db/accounts", () => ({ getAccount: vi.fn() }));
vi.mock("@/services/oauth/oauthTokenManager", () => ({ ensureFreshToken: vi.fn() }));

const account = createMockImapAccount({ provider: "ews", email: "me@example.com" });
const provider = new EwsCalendarProvider(account.id);

beforeEach(() => {
  vi.resetAllMocks();
  clearAllCalendarProviders();
  vi.mocked(getAccount).mockResolvedValue(account);
  vi.mocked(ensureFreshToken).mockResolvedValue("refreshed-token");
});

describe("EWS calendars", () => {
  it("enables calendars automatically for an existing EWS account", async () => {
    expect(await hasCalendarSupport(account.id)).toBe(true);
    expect(await getCalendarProvider(account.id)).toBeInstanceOf(EwsCalendarProvider);
  });

  it("discovers calendars with the existing mailbox and refreshed OAuth session", async () => {
    const calendars = [{ remoteId: "calendar-id", displayName: "Calendar", color: null, isPrimary: true }];
    vi.mocked(platformInvoke).mockResolvedValue(calendars);
    expect(await provider.listCalendars()).toEqual(calendars);
    expect(ensureFreshToken).toHaveBeenCalledWith(account);
    expect(platformInvoke).toHaveBeenCalledWith("ews_calendar", {
      token: "refreshed-token", anchor: account.email, operation: "list",
    });
  });

  it("passes event change keys on edits and deletes", async () => {
    await provider.updateEvent("cal", "event", { summary: "Updated" }, "change-key");
    expect(platformInvoke).toHaveBeenLastCalledWith("ews_calendar", expect.objectContaining({
      operation: "update", calendarId: "cal", eventId: "event", etag: "change-key", event: { summary: "Updated" },
    }));
    await provider.deleteEvent("cal", "event", "next-key");
    expect(platformInvoke).toHaveBeenLastCalledWith("ews_calendar", expect.objectContaining({
      operation: "delete", eventId: "event", etag: "next-key",
    }));
  });

  it("splits a truncated CalendarView and deduplicates overlapping occurrences", async () => {
    vi.mocked(platformInvoke)
      .mockRejectedValueOnce("EWS_CALENDAR_RANGE_FULL")
      .mockResolvedValueOnce([{ remoteEventId: "one" }, { remoteEventId: "boundary" }])
      .mockResolvedValueOnce([{ remoteEventId: "boundary" }, { remoteEventId: "two" }]);
    const events = await provider.fetchEvents("cal", "2026-11-01T00:00:00Z", "2026-11-03T00:00:00Z");
    expect(events.map((e) => e.remoteEventId)).toEqual(["one", "boundary", "two"]);
    expect(platformInvoke).toHaveBeenNthCalledWith(2, "ews_calendar", expect.objectContaining({
      start: "2026-11-01T00:00:00Z", end: "2026-11-02T00:00:00.000Z",
    }));
  });

  it("surfaces Exchange errors and preserves failed ranges", async () => {
    vi.mocked(platformInvoke).mockRejectedValue("ErrorAccessDenied");
    await expect(provider.fetchEvents("cal", "2026-11-01", "2026-11-02")).rejects.toThrow("ErrorAccessDenied");
    expect(platformInvoke).toHaveBeenCalledTimes(1);
    expect(await provider.testConnection()).toEqual({ success: false, message: "ErrorAccessDenied" });
  });
});
