import { beforeEach, describe, expect, it, vi } from "vitest";
import { CalDAVProvider } from "./caldavProvider";
const mocks = vi.hoisted(() => ({ propfind: vi.fn(), fetch: vi.fn(), create: vi.fn(), calendars: vi.fn() }));
vi.mock("tsdav", () => ({ DAVClient: class {
  authHeaders = { Authorization: "Basic test" };
  login = async () => {};
  fetchCalendars = mocks.calendars;
  propfind = mocks.propfind;
  createCalendarObject = mocks.create;
} }));
vi.mock("@/services/db/accounts", () => ({ getAccount: async () => ({ email: "me@example.com", caldav_url: "https://cal.example.com", caldav_password: "test" }) }));
vi.mock("@/platform", () => ({ platformFetch: mocks.fetch }));

describe("CalDAV creation capabilities", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.calendars.mockResolvedValue([{ url: "https://cal.example.com/main/", displayName: "Calendar" }]);
    mocks.propfind.mockResolvedValue([{ ok: true, props: { currentUserPrivilegeSet: { privilege: [{ bind: {} }] } } }]);
    mocks.fetch.mockResolvedValue(new Response(null, { headers: { DAV: "1, calendar-access, calendar-auto-schedule" } }));
    mocks.create.mockResolvedValue(new Response(null, { status: 201 }));
  });

  it("requires create privileges and server automatic scheduling for invitations", async () => {
    const provider = new CalDAVProvider("account");
    expect((await provider.listCalendars())[0]).toMatchObject({ canCreate: true, canInvite: true });
    await provider.createEvent("https://cal.example.com/main/", { summary: "Review", startTime: "2030-01-01T12:00:00Z", endTime: "2030-01-01T13:00:00Z", attendees: [{ email: "bob@example.com" }] });
    const ics = mocks.create.mock.calls[0]![0].iCalString;
    expect(ics).toContain("ORGANIZER:mailto:me@example.com");
    expect(ics).toContain("ATTENDEE;RSVP=TRUE:mailto:bob@example.com");
  });

  it("blocks invitations on ordinary CalDAV storage calendars", async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { headers: { DAV: "1, calendar-access" } }));
    const provider = new CalDAVProvider("account");
    expect((await provider.listCalendars())[0]).toMatchObject({ canCreate: true, canInvite: false });
    await expect(provider.createEvent("https://cal.example.com/main/", { summary: "Review", startTime: "2030-01-01T12:00:00Z", endTime: "2030-01-01T13:00:00Z", attendees: [{ email: "bob@example.com" }] })).rejects.toThrow("cannot send invitations");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("treats unavailable privileges as read-only", async () => {
    mocks.propfind.mockResolvedValue([{ ok: true, props: { currentUserPrivilegeSet: { privilege: [{ read: {} }] } } }]);
    expect((await new CalDAVProvider("account").listCalendars())[0]).toMatchObject({ canCreate: false, canInvite: false });
  });

  it("reports a failed CalDAV PUT instead of claiming success", async () => {
    mocks.create.mockResolvedValue(new Response(null, { status: 403 }));
    await expect(new CalDAVProvider("account").createEvent("https://cal.example.com/main/", { summary: "Review", startTime: "2030-01-01T12:00:00Z", endTime: "2030-01-01T13:00:00Z" })).rejects.toThrow("403");
  });
});
