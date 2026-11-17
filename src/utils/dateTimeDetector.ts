export interface DetectedDateTime {
  rawMatch: string;
  startDate: Date;
  endDate: Date;
  formattedDisplay: string;
}

const DAYS_OF_WEEK: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function parseTimePart(timeStr: string): { hours: number; minutes: number } | null {
  const clean = timeStr.trim().toLowerCase();
  const match = clean.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;

  let hours = parseInt(match[1]!, 10);
  const minutes = match[2] ? parseInt(match[2]!, 10) : 0;
  const ampm = match[3];

  if (ampm === "pm" && hours < 12) hours += 12;
  if (ampm === "am" && hours === 12) hours = 0;

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

/**
 * Scan email text for explicit meeting times (e.g., "tomorrow at 3pm", "Friday at 10:30am", "Nov 25 at 4pm").
 */
export function detectDateTime(text?: string | null, referenceDate = new Date()): DetectedDateTime | null {
  if (!text) return null;

  // Pattern 1: (today | tomorrow | next <day>) at <time>
  const relRegex = /\b(today|tomorrow|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i;
  const relMatch = text.match(relRegex);
  if (relMatch) {
    const dayWord = relMatch[1]!.toLowerCase();
    const timeWord = relMatch[2]!;
    const parsedTime = parseTimePart(timeWord);

    if (parsedTime) {
      const target = new Date(referenceDate);
      if (dayWord === "tomorrow") {
        target.setDate(target.getDate() + 1);
      } else if (dayWord.startsWith("next ")) {
        const targetDay = DAYS_OF_WEEK[dayWord.replace("next ", "").trim()] ?? 1;
        const currentDay = target.getDay();
        let daysAhead = (targetDay - currentDay + 7) % 7;
        if (daysAhead === 0) daysAhead = 7;
        target.setDate(target.getDate() + daysAhead);
      }
      target.setHours(parsedTime.hours, parsedTime.minutes, 0, 0);

      const end = new Date(target.getTime() + 60 * 60 * 1000); // 1 hour default
      return {
        rawMatch: relMatch[0],
        startDate: target,
        endDate: end,
        formattedDisplay: target.toLocaleString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }),
      };
    }
  }

  // Pattern 2: (Monday..Sunday) at <time>
  const weekdayRegex = /\b(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i;
  const weekdayMatch = text.match(weekdayRegex);
  if (weekdayMatch) {
    const dayWord = weekdayMatch[1]!.toLowerCase();
    const timeWord = weekdayMatch[2]!;
    const parsedTime = parseTimePart(timeWord);

    if (parsedTime) {
      const target = new Date(referenceDate);
      const targetDay = DAYS_OF_WEEK[dayWord] ?? 1;
      const currentDay = target.getDay();
      let daysAhead = (targetDay - currentDay + 7) % 7;
      if (daysAhead === 0) daysAhead = 7;
      target.setDate(target.getDate() + daysAhead);
      target.setHours(parsedTime.hours, parsedTime.minutes, 0, 0);

      const end = new Date(target.getTime() + 60 * 60 * 1000);
      return {
        rawMatch: weekdayMatch[0],
        startDate: target,
        endDate: end,
        formattedDisplay: target.toLocaleString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }),
      };
    }
  }

  // Pattern 3: (Nov 25 | November 25th) at <time>
  const dateRegex = /\b(?:on\s+)?([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,\s*(\d{4}))?\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i;
  const dateMatch = text.match(dateRegex);
  if (dateMatch) {
    const monthWord = dateMatch[1]!.toLowerCase();
    const dayNum = parseInt(dateMatch[2]!, 10);
    const yearNum = dateMatch[3] ? parseInt(dateMatch[3]!, 10) : referenceDate.getFullYear();
    const timeWord = dateMatch[4]!;

    const monthNum = MONTHS[monthWord];
    const parsedTime = parseTimePart(timeWord);

    if (monthNum !== undefined && parsedTime && dayNum >= 1 && dayNum <= 31) {
      const target = new Date(yearNum, monthNum, dayNum, parsedTime.hours, parsedTime.minutes, 0, 0);
      const end = new Date(target.getTime() + 60 * 60 * 1000);
      return {
        rawMatch: dateMatch[0],
        startDate: target,
        endDate: end,
        formattedDisplay: target.toLocaleString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }),
      };
    }
  }

  return null;
}
