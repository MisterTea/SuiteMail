import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MeetingTimesDialog, formatMeetingSpan, meetingTimesHtml } from "./MeetingTimesDialog";

vi.mock("@/hooks/useAndroidMobile", () => ({ useAndroidMobile: () => false }));

describe("meeting time suggestions", () => {
  beforeEach(() => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("adds drag selections in either direction, retains them across weeks, and removes spans", () => {
    const onAccept = vi.fn();
    render(<MeetingTimesDialog onAccept={onAccept} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Insert meeting times" })).toBeDisabled();
    const day = screen.getAllByTestId("meeting-day")[0]!;
    // Half-hour cells are 24px tall: 9:00 through 10:30.
    fireEvent.pointerDown(day, { button: 0, clientY: 18 * 24 + 1 });
    fireEvent.pointerMove(day, { clientY: 20 * 24 + 1 });
    fireEvent.pointerUp(day, { clientY: 20 * 24 + 1 });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    const nextDay = screen.getAllByTestId("meeting-day")[1]!;
    fireEvent.pointerDown(nextDay, { button: 0, clientY: 22 * 24 + 1 });
    fireEvent.pointerUp(nextDay, { clientY: 21 * 24 + 1 });
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Insert meeting times" }));
    const spans = onAccept.mock.calls[0]![0];
    expect(spans[0].start.getHours()).toBe(9);
    expect(spans[0].end.getHours()).toBe(10);
    expect(spans[0].end.getMinutes()).toBe(30);
    expect(+spans[1].end - +spans[1].start).toBe(60 * 60000);
    fireEvent.click(screen.getAllByRole("button", { name: /^Remove / })[0]!);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("supports keyboard activation, avoids duplicate spans, and cancels without accepting", () => {
    const onAccept = vi.fn(), onClose = vi.fn();
    render(<MeetingTimesDialog onAccept={onAccept} onClose={onClose} />);
    const slot = screen.getAllByRole("button", { name: /^Add / })[18]!;
    fireEvent.click(slot, { detail: 0 });
    fireEvent.click(slot, { detail: 0 });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("discards canceled drags", () => {
    render(<MeetingTimesDialog onAccept={vi.fn()} onClose={vi.fn()} />);
    const day = screen.getAllByTestId("meeting-day")[0]!;
    fireEvent.pointerDown(day, { button: 0, clientY: 200 });
    fireEvent.pointerCancel(day);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Insert meeting times" })).toBeDisabled();
  });

  it("formats chronological email options with dates, time zones, and a request for preferences", () => {
    const first = { start: new Date(2027, 0, 12, 9), end: new Date(2027, 0, 12, 10) };
    const second = { start: new Date(2027, 0, 14, 14), end: new Date(2027, 0, 14, 15) };
    const html = meetingTimesHtml([second, first]);
    expect(html.indexOf(formatMeetingSpan(first))).toBeLessThan(html.indexOf(formatMeetingSpan(second)));
    expect(html).toContain("which one(s) work best for you");
    expect(html.match(/<li>/g)).toHaveLength(2);
    expect(formatMeetingSpan(first)).toContain("2027");
    expect(formatMeetingSpan(first)).toContain(first.start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" }));
    const midnight = formatMeetingSpan({ start: new Date(2027, 0, 12, 23, 30), end: new Date(2027, 0, 13) });
    expect(midnight).toContain("13");
  });
});
