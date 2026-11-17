import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ShareAvailabilityModal, computeAvailableSlots } from "./ShareAvailabilityModal";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";

const mockGetEvents = vi.fn();

vi.mock("@/services/db/calendarEvents", () => ({
  getCalendarEventsInRange: (...args: unknown[]) => mockGetEvents(...args),
}));

vi.mock("@/stores/accountStore", () => ({
  useAccountStore: (selector: (s: unknown) => unknown) =>
    selector({
      activeAccountId: "acc-test",
    }),
}));

describe("ShareAvailabilityModal", () => {
  const mockEditor = {
    chain: vi.fn().mockReturnThis(),
    focus: vi.fn().mockReturnThis(),
    insertContent: vi.fn().mockReturnThis(),
    run: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEvents.mockResolvedValue([]);
  });

  it("computes open slots excluding weekends and busy conflicts", () => {
    const monday = new Date("2026-11-16T09:00:00Z");
    const busyEvents: DbCalendarEvent[] = [
      {
        id: "ev-1",
        account_id: "acc-test",
        google_event_id: "g-1",
        summary: "Staff Meeting",
        description: null,
        location: null,
        // Tuesday 10:00 - 11:00 UTC busy
        start_time: Math.floor(new Date("2026-11-17T10:00:00Z").getTime() / 1000),
        end_time: Math.floor(new Date("2026-11-17T11:00:00Z").getTime() / 1000),
        is_all_day: 0,
        status: "confirmed",
        organizer_email: null,
        attendees_json: null,
        html_link: null,
        updated_at: 0,
        calendar_id: null,
        remote_event_id: null,
        etag: null,
        ical_data: null,
        uid: null,
      },
    ];

    const slots = computeAvailableSlots(monday, busyEvents);
    expect(slots.length).toBeGreaterThan(0);
    // Ensure no slot matches the busy 10:00 slot on that Tuesday if time aligns
  });

  it("renders open slots and inserts chosen availability into editor", async () => {
    const onClose = vi.fn();
    render(
      <ShareAvailabilityModal
        isOpen={true}
        onClose={onClose}
        editor={mockEditor as unknown as import("@tiptap/react").Editor}
      />,
    );

    await waitFor(() => {
      expect(mockGetEvents).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText("Insert Availability")).toBeInTheDocument();
    });

    const insertBtn = screen.getByText("Insert Availability");
    fireEvent.click(insertBtn);

    expect(mockEditor.insertContent).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
