import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DayView } from "./DayView";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";

const BASE_DATE = new Date(2026, 10, 25, 0, 0, 0, 0);

function hour(h: number): number {
  return new Date(2026, 10, 25, h, 0, 0, 0).getTime() / 1000;
}

function makeEvent(
  id: string,
  summary: string,
  startSec: number,
  endSec: number,
  overrides: Partial<DbCalendarEvent> = {},
): DbCalendarEvent {
  return {
    id,
    account_id: "acc-1",
    google_event_id: id,
    summary,
    description: null,
    location: null,
    start_time: startSec,
    end_time: endSec,
    is_all_day: 0,
    status: "confirmed",
    organizer_email: null,
    attendees_json: null,
    html_link: null,
    updated_at: 0,
    calendar_id: "cal-1",
    remote_event_id: id,
    etag: null,
    ical_data: null,
    uid: null,
    ...overrides,
  };
}

describe("DayView", () => {
  it("renders a multi-hour event once and places overlapping events side-by-side", () => {
    const onEventClick = vi.fn();
    const events = [
      makeEvent("bam", "Lindsey BAM", hour(10), hour(19)),
      makeEvent("tutor", "Luke's Tutoring", hour(16), hour(17)),
    ];

    render(
      <DayView
        currentDate={BASE_DATE}
        events={events}
        onEventClick={onEventClick}
      />,
    );

    const bamButtons = screen.getAllByRole("button", { name: "Lindsey BAM" });
    expect(bamButtons).toHaveLength(1);
    expect(bamButtons[0].style.height).toContain("37.5%");
    expect(bamButtons[0].style.left).toContain("0%");
    expect(bamButtons[0].style.width).toContain("50%");

    const tutorBtn = screen.getByRole("button", { name: "Luke's Tutoring" });
    expect(tutorBtn.style.left).toContain("50%");
    expect(tutorBtn.style.width).toContain("50%");

    fireEvent.click(bamButtons[0]);
    expect(onEventClick).toHaveBeenCalledWith(events[0]);
  });
});
