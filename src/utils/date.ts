/**
 * Format a unix timestamp (milliseconds) into a relative date string.
 */
export function formatRelativeDate(timestamp: number): string {
  if (!timestamp) return "";
  const ts = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  const date = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);

  // Today: show time
  if (isSameDay(date, now)) {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  // Yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(date, yesterday)) {
    return "Yesterday";
  }

  // Within last 7 days: show day name
  if (diffDays < 7) {
    return date.toLocaleDateString(undefined, { weekday: "short" });
  }

  // Same year: show month + day
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }

  // Older: show full date
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Format a unix timestamp into a full date string for message headers.
 */
export function formatFullDate(timestamp: number): string {
  if (!timestamp) return "";
  const ts = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  const date = new Date(ts);
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Format a scheduled timestamp (seconds or ms) into a clean delivery label.
 * e.g., "Tomorrow at 9:00 AM", "Monday at 1:00 PM", "Nov 25 at 9:00 AM".
 */
export function formatScheduledTime(timestamp: number): string {
  const ms = timestamp < 1e11 ? timestamp * 1000 : timestamp;
  const target = new Date(ms);
  const now = new Date();

  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((targetDay.getTime() - today.getTime()) / 86_400_000);

  const timeStr = target.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  if (diffDays === 0) {
    return `Today at ${timeStr}`;
  } else if (diffDays === 1) {
    return `Tomorrow at ${timeStr}`;
  } else if (diffDays > 1 && diffDays < 7) {
    const weekday = target.toLocaleDateString(undefined, { weekday: "long" });
    return `${weekday} at ${timeStr}`;
  } else {
    const dateStr = target.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    return `${dateStr} at ${timeStr}`;
  }
}

