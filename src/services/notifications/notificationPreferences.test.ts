import { describe, expect, it } from "vitest";
import { DEFAULT_NOTIFICATION_PREFERENCES, isDuringQuietHours } from "./notificationPreferences";

describe("notification quiet hours", () => {
  const at = (hours: number, minutes = 0) => new Date(2026, 0, 1, hours, minutes);
  const overnight = { ...DEFAULT_NOTIFICATION_PREFERENCES, quiet: true };

  it("includes the start and ends before the morning digest", () => {
    expect(isDuringQuietHours(overnight, at(17, 59))).toBe(false);
    expect(isDuringQuietHours(overnight, at(18))).toBe(true);
    expect(isDuringQuietHours(overnight, at(0))).toBe(true);
    expect(isDuringQuietHours(overnight, at(8, 59))).toBe(true);
    expect(isDuringQuietHours(overnight, at(9))).toBe(false);
  });

  it("supports daytime windows and ignores an empty or disabled window", () => {
    const daytime = { ...overnight, start: "12:00", end: "14:00" };
    expect(isDuringQuietHours(daytime, at(13))).toBe(true);
    expect(isDuringQuietHours(daytime, at(0))).toBe(false);
    expect(isDuringQuietHours({ ...daytime, start: daytime.end }, at(14))).toBe(false);
    expect(isDuringQuietHours({ ...daytime, quiet: false }, at(13))).toBe(false);
  });
});
