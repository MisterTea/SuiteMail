import { describe, it, expect } from "vitest";
import { detectDateTime } from "./dateTimeDetector";

describe("detectDateTime", () => {
  const refDate = new Date("2026-11-16T12:00:00Z"); // Monday Nov 16, 2026

  it("detects 'tomorrow at 3pm'", () => {
    const text = "Can we do a quick sync tomorrow at 3pm to review the deck?";
    const detected = detectDateTime(text, refDate);
    expect(detected).not.toBeNull();
    expect(detected?.rawMatch.toLowerCase()).toBe("tomorrow at 3pm");
    expect(detected?.startDate.getHours()).toBe(15);
  });

  it("detects weekday mentions like 'Friday at 10:30am'", () => {
    const text = "Let's schedule the architecture review on Friday at 10:30am.";
    const detected = detectDateTime(text, refDate);
    expect(detected).not.toBeNull();
    expect(detected?.startDate.getHours()).toBe(10);
    expect(detected?.startDate.getMinutes()).toBe(30);
  });

  it("detects explicit calendar dates like 'Nov 25 at 4pm'", () => {
    const text = "The demo is planned for Nov 25 at 4pm.";
    const detected = detectDateTime(text, refDate);
    expect(detected).not.toBeNull();
    expect(detected?.startDate.getMonth()).toBe(10); // Nov is index 10
    expect(detected?.startDate.getDate()).toBe(25);
    expect(detected?.startDate.getHours()).toBe(16);
  });

  it("returns null when no time is mentioned", () => {
    const text = "Thanks for sending over the invoice!";
    expect(detectDateTime(text, refDate)).toBeNull();
  });
});
