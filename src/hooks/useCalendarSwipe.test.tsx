import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useCalendarSwipe } from "./useCalendarSwipe";

function setup() {
  const previous = vi.fn();
  const next = vi.fn();
  const openEvent = vi.fn();
  function Calendar() {
    const handlers = useCalendarSwipe(previous, next);
    return <div {...handlers}><button onClick={openEvent}>Event</button></div>;
  }
  render(<Calendar />);
  const target = screen.getByRole("button", { name: "Event" });
  function pointer(type: string, x: number, y: number, extra = {}) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, ...extra });
    fireEvent(target, event);
  }
  return { previous, next, openEvent, pointer, target };
}

describe("calendar touch navigation", () => {
  it("navigates once per horizontal swipe in either direction and suppresses event clicks", () => {
    const { pointer, next, previous, openEvent, target } = setup();
    pointer("pointerdown", 300, 200);
    pointer("pointermove", 230, 202);
    pointer("pointermove", 100, 205);
    pointer("pointerup", 100, 205);
    fireEvent.click(target);
    expect(next).toHaveBeenCalledTimes(1);
    expect(openEvent).not.toHaveBeenCalled();
    pointer("pointerdown", 100, 200);
    pointer("pointermove", 200, 205);
    pointer("pointerup", 200, 205);
    expect(previous).toHaveBeenCalledTimes(1);
  });

  it("leaves vertical gestures to native scrolling even when they drift sideways", () => {
    const { pointer, previous, next } = setup();
    pointer("pointerdown", 100, 300);
    pointer("pointermove", 103, 270);
    pointer("pointermove", 220, 260);
    pointer("pointerup", 220, 260);
    expect(previous).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("preserves taps and ignores short swipes, canceled gestures, mouse drags and multi-touch", () => {
    const { pointer, previous, next, openEvent, target } = setup();
    pointer("pointerdown", 100, 200);
    pointer("pointerup", 101, 201);
    fireEvent.click(target);
    expect(openEvent).toHaveBeenCalledTimes(1);
    pointer("pointerdown", 100, 200);
    pointer("pointerup", 130, 201);
    pointer("pointerdown", 100, 200);
    pointer("pointermove", 200, 200);
    pointer("pointercancel", 200, 200);
    pointer("pointerup", 200, 200);
    pointer("pointerdown", 100, 200, { pointerType: "mouse" });
    pointer("pointerup", 200, 200, { pointerType: "mouse" });
    pointer("pointerdown", 100, 200);
    pointer("pointerdown", 200, 200, { pointerId: 2, isPrimary: false });
    pointer("pointerup", 300, 200);
    expect(previous).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
