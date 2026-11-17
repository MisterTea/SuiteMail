import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractRawICal,
  detectInviteFromMessage,
  respondToInvite,
  getExistingEventRsvp,
} from "./inviteDetector";
import type { DbMessage } from "@/services/db/messages";
import type { InviteDetails } from "./types";

vi.mock("@/services/db/connection", () => {
  const mockDb = {
    select: vi.fn(),
    execute: vi.fn(),
  };
  return {
    getDb: vi.fn(() => Promise.resolve(mockDb)),
  };
});

vi.mock("@/services/db/calendarEvents", () => ({
  upsertCalendarEvent: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/services/emailActions", () => ({
  sendEmail: vi.fn(() => Promise.resolve({ success: true })),
}));

describe("inviteDetector", () => {
  const sampleIcs = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//EN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    "UID:test-meeting-999",
    "DTSTAMP:20261116T120000Z",
    "DTSTART:20261120T150000Z",
    "DTEND:20261120T160000Z",
    "SUMMARY:Quarterly Product Review",
    "DESCRIPTION:Review of Q3 roadmap and goals.",
    "LOCATION:Virtual - Google Meet",
    "ORGANIZER;CN=CEO:mailto:ceo@company.com",
    "ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;CN=Engineer:mailto:dev@company.com",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts raw ical from plain text or html", () => {
    const raw = extractRawICal(`Some prefix text\n${sampleIcs}\nSome suffix text`);
    expect(raw).toContain("BEGIN:VCALENDAR");
    expect(raw).toContain("END:VCALENDAR");
    expect(raw).toContain("UID:test-meeting-999");
  });

  it("detects and parses an invite from message body_text", () => {
    const message: Partial<DbMessage> = {
      body_text: sampleIcs,
    };

    const invite = detectInviteFromMessage(message as DbMessage);
    expect(invite).not.toBeNull();
    expect(invite?.uid).toBe("test-meeting-999");
    expect(invite?.summary).toBe("Quarterly Product Review");
    expect(invite?.location).toBe("Virtual - Google Meet");
    expect(invite?.organizerEmail).toBe("ceo@company.com");
    expect(invite?.method).toBe("REQUEST");
    expect(invite?.attendees.length).toBe(1);
    expect(invite?.attendees[0]?.email).toBe("dev@company.com");
  });

  it("returns null when message does not contain calendar data", () => {
    const message: Partial<DbMessage> = {
      body_text: "Hi, just checking in on the project.",
      body_html: "<p>Hi, just checking in on the project.</p>",
    };
    expect(detectInviteFromMessage(message as DbMessage)).toBeNull();
  });

  it("responds to an invite: updates local calendar and sends reply email", async () => {
    const { upsertCalendarEvent } = await import("@/services/db/calendarEvents");
    const { sendEmail } = await import("@/services/emailActions");

    const message: Partial<DbMessage> = {
      id: "msg-123",
      thread_id: "thread-456",
      account_id: "acc-1",
    };

    const invite: InviteDetails = {
      uid: "test-meeting-999",
      summary: "Quarterly Product Review",
      description: "Review of Q3 roadmap",
      location: "Virtual",
      startTime: 1795186800,
      endTime: 1795190400,
      isAllDay: false,
      status: "confirmed",
      organizerEmail: "ceo@company.com",
      attendees: [{ email: "dev@company.com", responseStatus: "needs-action" }],
      icalData: sampleIcs,
      method: "REQUEST",
    };

    const res = await respondToInvite({
      accountId: "acc-1",
      message: message as DbMessage,
      invite,
      responseStatus: "accepted",
      userEmail: "dev@company.com",
      userDisplayName: "Lead Dev",
    });

    expect(res.success).toBe(true);
    expect(upsertCalendarEvent).toHaveBeenCalledTimes(1);
    expect(upsertCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "acc-1",
        googleEventId: "test-meeting-999",
        summary: "Quarterly Product Review",
        status: "confirmed",
      }),
    );
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      "acc-1",
      expect.any(String),
      "thread-456",
    );
  });
});
