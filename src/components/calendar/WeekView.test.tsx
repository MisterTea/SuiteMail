import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { WeekView } from "./WeekView";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";

const BASE_DATE = new Date(2026, 10, 25, 0, 0, 0, 0); // Wed Nov 25, 2026
const DAY_START = BASE_DATE.getTime() / 1000;

function hourOnDay(dayOffset: number, h: number): number {
  return new Date(2026, 10, 25 + dayOffset, h, 0, 0, 0).getTime() / 1000;
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

describe("WeekView", () => {
  it("renders a multi-hour event as a single continuous block instead of repeating per hour", () => {
    const events = [
      makeEvent("bam", "Lindsey BAM", hourOnDay(0, 10), hourOnDay(0, 19)),
    ];

    render(
      <WeekView
        currentDate={BASE_DATE}
        events={events}
        onEventClick={vi.fn()}
        dayCount={3}
      />,
    );

    const buttons = screen.getAllByRole("button", { name: "Lindsey BAM" });
    expect(buttons).toHaveLength(1);
    expect(buttons[0].style.height).toContain("37.5%");
    expect(buttons[0].style.left).toContain("0%");
    expect(buttons[0].style.width).toContain("100%");
  });

  it("lays out overlapping events side-by-side in the same day column", () => {
    const onEventClick = vi.fn();
    const events = [
      makeEvent("bam", "Lindsey BAM", hourOnDay(0, 10), hourOnDay(0, 19)),
      makeEvent("tutor", "Luke's Tutoring", hourOnDay(0, 16), hourOnDay(0, 17)),
      makeEvent("code", "Code Talk", hourOnDay(2, 16), hourOnDay(2, 17)),
    ];

    render(
      <WeekView
        currentDate={BASE_DATE}
        events={events}
        onEventClick={onEventClick}
        dayCount={3}
      />,
    );

    const bamBtn = screen.getByRole("button", { name: "Lindsey BAM" });
    const tutorBtn = screen.getByRole("button", { name: "Luke's Tutoring" });
    const codeBtn = screen.getByRole("button", { name: "Code Talk" });

    // Overlapping events on Wed share the column horizontally (50% each)
    expect(bamBtn.style.left).toContain("0%");
    expect(bamBtn.style.width).toContain("50%");
    expect(tutorBtn.style.left).toContain("50%");
    expect(tutorBtn.style.width).toContain("50%");

    // Non-overlapping event on Fri takes full width
    expect(codeBtn.style.left).toContain("0%");
    expect(codeBtn.style.width).toContain("100%");

    fireEvent.click(tutorBtn);
    expect(onEventClick).toHaveBeenCalledWith(events[1]);
  });

  it("renders a multi-day all-day event as a single horizontal bar spanning across all covered days", () => {
    const events = [
      makeEvent("holiday", "Thanksgiving Break", DAY_START, DAY_START + 3 * 86400, { is_all_day: 1 }),
    ];

    render(
      <WeekView
        currentDate={BASE_DATE}
        events={events}
        onEventClick={vi.fn()}
        dayCount={3}
      />,
    );

    const buttons = screen.getAllByRole("button", { name: "Thanksgiving Break" });
    expect(buttons).toHaveLength(1);
    expect(buttons[0].style.gridColumn).toBe("4 / span 3");
  });

  it("splits a multi-day non-all-day event into separate per-day vertical blocks", () => {
    const events = [
      makeEvent("overnight", "Red-Eye Flight", hourOnDay(0, 22), hourOnDay(1, 3)),
    ];

    render(
      <WeekView
        currentDate={BASE_DATE}
        events={events}
        onEventClick={vi.fn()}
        dayCount={3}
      />,
    );

    const buttons = screen.getAllByRole("button", { name: "Red-Eye Flight" });
    expect(buttons).toHaveLength(2);
    // Day 0: 22:00-24:00 (2/24 = 8.3333%)
    expect(buttons[0].style.height).toContain("8.3333");
    // Day 1: 00:00-03:00 (3/24 = 12.5%)
    expect(buttons[1].style.height).toContain("12.5%");
  });
});
