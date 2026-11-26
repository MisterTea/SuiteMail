import { describe, it, expect } from "vitest";
import { layoutAllDayEvents, layoutDayEvents } from "./calendarLayout";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";

const DAY_START = new Date(2026, 10, 25, 0, 0, 0, 0).getTime() / 1000;
const DAY_END = new Date(2026, 10, 26, 0, 0, 0, 0).getTime() / 1000;

function hour(h: number, m = 0): number {
  return DAY_START + h * 3600 + m * 60;
}

function makeEvent(
  id: string,
  startSec: number,
  endSec: number,
  overrides: Partial<DbCalendarEvent> = {},
): DbCalendarEvent {
  return {
    id,
    account_id: "acc-1",
    google_event_id: id,
    summary: id,
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

describe("layoutDayEvents", () => {
  it("positions a single multi-hour event as one full-width continuous block", () => {
    const events = [makeEvent("bam", hour(10), hour(19))];
    const result = layoutDayEvents(events, DAY_START, DAY_END);

    expect(result).toHaveLength(1);
    expect(result[0].topPct).toBeCloseTo((10 / 24) * 100, 4);
    expect(result[0].heightPct).toBeCloseTo((9 / 24) * 100, 4);
    expect(result[0].leftPct).toBe(0);
    expect(result[0].widthPct).toBe(100);
    expect(result[0].totalColumns).toBe(1);
  });

  it("places an overlapping event side-by-side with a multi-hour event", () => {
    const events = [
      makeEvent("lindsey", hour(10), hour(19)),
      makeEvent("tutoring", hour(16), hour(17)),
    ];
    const result = layoutDayEvents(events, DAY_START, DAY_END);

    expect(result).toHaveLength(2);
    const lindsey = result.find((r) => r.event.id === "lindsey")!;
    const tutoring = result.find((r) => r.event.id === "tutoring")!;

    expect(lindsey.leftPct).toBe(0);
    expect(lindsey.widthPct).toBe(50);
    expect(lindsey.heightPct).toBeCloseTo((9 / 24) * 100, 4);

    expect(tutoring.leftPct).toBe(50);
    expect(tutoring.widthPct).toBe(50);
    expect(tutoring.topPct).toBeCloseTo((16 / 24) * 100, 4);
    expect(tutoring.heightPct).toBeCloseTo((1 / 24) * 100, 4);
  });

  it("keeps back-to-back non-overlapping events at full width", () => {
    const events = [
      makeEvent("first", hour(15), hour(16)),
      makeEvent("second", hour(16), hour(17)),
    ];
    const result = layoutDayEvents(events, DAY_START, DAY_END);

    expect(result).toHaveLength(2);
    for (const item of result) {
      expect(item.leftPct).toBe(0);
      expect(item.widthPct).toBe(100);
      expect(item.totalColumns).toBe(1);
    }
  });

  it("splits 3 mutually overlapping events into 3 equal columns", () => {
    const events = [
      makeEvent("a", hour(9), hour(12)),
      makeEvent("b", hour(10), hour(11)),
      makeEvent("c", hour(10), hour(11, 30)),
    ];
    const result = layoutDayEvents(events, DAY_START, DAY_END);

    expect(result).toHaveLength(3);
    const lefts = result.map((r) => Math.round(r.leftPct)).sort((x, y) => x - y);
    expect(lefts).toEqual([0, 33, 67]);
    for (const item of result) {
      expect(item.widthPct).toBeCloseTo(100 / 3, 4);
      expect(item.totalColumns).toBe(3);
    }
  });

  it("expands events rightward when adjacent columns are free during their time range", () => {
    const events = [
      makeEvent("long", hour(9), hour(17)),
      makeEvent("morning", hour(10), hour(11)),
      makeEvent("afternoon-1", hour(14), hour(15)),
      makeEvent("afternoon-2", hour(14), hour(15)),
    ];
    const result = layoutDayEvents(events, DAY_START, DAY_END);

    const long = result.find((r) => r.event.id === "long")!;
    const morning = result.find((r) => r.event.id === "morning")!;
    const aft1 = result.find((r) => r.event.id === "afternoon-1")!;
    const aft2 = result.find((r) => r.event.id === "afternoon-2")!;

    expect(long.totalColumns).toBe(3);
    expect(long.colSpan).toBe(1);
    expect(long.widthPct).toBeCloseTo(100 / 3, 4);

    // morning is in col 1 and col 2 is free at 10-11, so it expands across col 1 & 2
    expect(morning.column).toBe(1);
    expect(morning.colSpan).toBe(2);
    expect(morning.widthPct).toBeCloseTo((2 / 3) * 100, 4);

    expect(aft1.widthPct).toBeCloseTo(100 / 3, 4);
    expect(aft2.widthPct).toBeCloseTo(100 / 3, 4);
  });

  it("clamps events that span across midnight to the day boundaries", () => {
    const events = [makeEvent("overnight", DAY_START - 3600, hour(3))];
    const result = layoutDayEvents(events, DAY_START, DAY_END);

    expect(result).toHaveLength(1);
    expect(result[0].topPct).toBe(0);
    expect(result[0].heightPct).toBeCloseTo((3 / 24) * 100, 4);
  });

  it("ignores all-day events and events outside the day", () => {
    const events = [
      makeEvent("allday", DAY_START, DAY_END, { is_all_day: 1 }),
      makeEvent("yesterday", DAY_START - 7200, DAY_START),
      makeEvent("tomorrow", DAY_END, DAY_END + 3600),
    ];
    const result = layoutDayEvents(events, DAY_START, DAY_END);
    expect(result).toHaveLength(0);
  });

  it("enforces minimum visual height for very short or zero-duration events", () => {
    const events = [makeEvent("instant", hour(12), hour(12))];
    const result = layoutDayEvents(events, DAY_START, DAY_END);

    expect(result).toHaveLength(1);
    expect(result[0].topPct).toBeCloseTo(50, 4);
    expect(result[0].heightPct).toBeCloseTo((25 / (24 * 60)) * 100, 4);
  });
});

describe("layoutAllDayEvents", () => {
  const days = [
    new Date(2026, 10, 25, 0, 0, 0, 0),
    new Date(2026, 10, 26, 0, 0, 0, 0),
    new Date(2026, 10, 27, 0, 0, 0, 0),
  ];

  const dayTs = (offset: number) =>
    new Date(2026, 10, 25 + offset, 0, 0, 0, 0).getTime() / 1000;

  it("stretches a multi-day all-day event into a single horizontal bar across covered days", () => {
    const events = [
      makeEvent("break", dayTs(0), dayTs(3), { is_all_day: 1 }),
    ];
    const result = layoutAllDayEvents(events, days);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      startCol: 0,
      span: 3,
      row: 0,
      continuesLeft: false,
      continuesRight: false,
    });
  });

  it("packs non-overlapping all-day events onto the same row and stacks overlapping ones", () => {
    const events = [
      makeEvent("multi", dayTs(0), dayTs(3), { is_all_day: 1 }),
      makeEvent("wed", dayTs(0), dayTs(1), { is_all_day: 1 }),
      makeEvent("fri", dayTs(2), dayTs(3), { is_all_day: 1 }),
    ];
    const result = layoutAllDayEvents(events, days);

    const multi = result.find((r) => r.event.id === "multi")!;
    const wed = result.find((r) => r.event.id === "wed")!;
    const fri = result.find((r) => r.event.id === "fri")!;

    expect(multi).toMatchObject({ startCol: 0, span: 3, row: 0 });
    expect(wed).toMatchObject({ startCol: 0, span: 1, row: 1 });
    expect(fri).toMatchObject({ startCol: 2, span: 1, row: 1 });
  });

  it("marks continuesLeft/continuesRight when an all-day event extends beyond visible days", () => {
    const events = [
      makeEvent("week-long", dayTs(-1), dayTs(5), { is_all_day: 1 }),
    ];
    const result = layoutAllDayEvents(events, days);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      startCol: 0,
      span: 3,
      continuesLeft: true,
      continuesRight: true,
    });
  });

  it("ignores non-all-day events", () => {
    const events = [
      makeEvent("timed-multi", dayTs(0) + 20 * 3600, dayTs(1) + 4 * 3600, { is_all_day: 0 }),
    ];
    expect(layoutAllDayEvents(events, days)).toHaveLength(0);
  });
});
