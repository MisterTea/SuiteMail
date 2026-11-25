import type { DbCalendarEvent } from "@/services/db/calendarEvents";

export interface PositionedCalendarEvent {
  event: DbCalendarEvent;
  /** Top offset as a percentage of the 24-hour day column (0..100). */
  topPct: number;
  /** Height as a percentage of the 24-hour day column (0..100). */
  heightPct: number;
  /** Left offset as a percentage of the day column width (0..100). */
  leftPct: number;
  /** Width as a percentage of the day column width (0..100). */
  widthPct: number;
  /** Zero-based column index within the event's overlap cluster. */
  column: number;
  /** Number of columns in the event's overlap cluster. */
  totalColumns: number;
  /** Number of adjacent columns this event spans. */
  colSpan: number;
}

export interface PositionedAllDayEvent {
  event: DbCalendarEvent;
  /** Zero-based starting day column index within the visible days. */
  startCol: number;
  /** Number of visible day columns this event stretches across (>= 1). */
  span: number;
  /** Zero-based vertical row index within the all-day bar area. */
  row: number;
  /** True if the event begins before the first visible day. */
  continuesLeft: boolean;
  /** True if the event extends past the last visible day. */
  continuesRight: boolean;
}

/**
 * Lays out all-day events across a contiguous sequence of visible days so that
 * multi-day all-day events render as a single horizontal bar spanning their
 * covered days, packed into non-overlapping rows.
 */
export function layoutAllDayEvents(
  events: DbCalendarEvent[],
  days: Date[],
): PositionedAllDayEvent[] {
  if (days.length === 0) return [];

  const dayBounds = days.map((day) => {
    const start = day.getTime() / 1000;
    const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime() / 1000;
    return { start, end };
  });

  const firstDayStart = dayBounds[0]!.start;
  const lastDayEnd = dayBounds[dayBounds.length - 1]!.end;

  interface AllDaySpan {
    event: DbCalendarEvent;
    startCol: number;
    endCol: number;
    continuesLeft: boolean;
    continuesRight: boolean;
  }

  const spans: AllDaySpan[] = [];

  for (const event of events) {
    if (!event.is_all_day) continue;

    let startCol = -1;
    let endCol = -1;
    const isZeroDuration = event.end_time <= event.start_time;

    for (let i = 0; i < dayBounds.length; i++) {
      const { start, end } = dayBounds[i]!;
      const intersects = isZeroDuration
        ? event.start_time >= start && event.start_time < end
        : event.start_time < end && event.end_time > start;

      if (intersects) {
        if (startCol === -1) startCol = i;
        endCol = i;
      }
    }

    if (startCol === -1) continue;

    spans.push({
      event,
      startCol,
      endCol,
      continuesLeft: event.start_time < firstDayStart,
      continuesRight: event.end_time > lastDayEnd,
    });
  }

  if (spans.length === 0) return [];

  // Sort by start column ascending, then wider span descending, then id for stability
  spans.sort((a, b) => {
    if (a.startCol !== b.startCol) return a.startCol - b.startCol;
    const spanDiff = (b.endCol - b.startCol) - (a.endCol - a.startCol);
    if (spanDiff !== 0) return spanDiff;
    return a.event.id.localeCompare(b.event.id);
  });

  const rowEndCols: number[] = [];
  const positioned: PositionedAllDayEvent[] = [];

  for (const span of spans) {
    let assignedRow = -1;
    for (let r = 0; r < rowEndCols.length; r++) {
      const rowEnd = rowEndCols[r];
      if (rowEnd !== undefined && rowEnd < span.startCol) {
        assignedRow = r;
        rowEndCols[r] = span.endCol;
        break;
      }
    }
    if (assignedRow === -1) {
      assignedRow = rowEndCols.length;
      rowEndCols.push(span.endCol);
    }

    positioned.push({
      event: span.event,
      startCol: span.startCol,
      span: span.endCol - span.startCol + 1,
      row: assignedRow,
      continuesLeft: span.continuesLeft,
      continuesRight: span.continuesRight,
    });
  }

  return positioned;
}

const DEFAULT_MIN_VISUAL_DURATION_SEC = 25 * 60;

interface InternalLayoutItem {
  event: DbCalendarEvent;
  visualStart: number;
  visualEnd: number;
  column: number;
}

/**
 * Computes vertical and horizontal positions for all non-all-day events
 * intersecting a single local calendar day [dayStartSec, dayEndSec).
 *
 * - Multi-hour events become a single continuous block spanning start..end,
 *   clamped to the day boundaries.
 * - Overlapping events are placed side-by-side into columns within each
 *   connected overlap cluster, expanding into free columns to their right.
 */
export function layoutDayEvents(
  events: DbCalendarEvent[],
  dayStartSec: number,
  dayEndSec: number,
  minVisualDurationSec: number = DEFAULT_MIN_VISUAL_DURATION_SEC,
): PositionedCalendarEvent[] {
  const dayDurationSec = dayEndSec - dayStartSec;
  if (dayDurationSec <= 0) return [];

  const minDur = Math.min(minVisualDurationSec, dayDurationSec);
  const items: InternalLayoutItem[] = [];

  for (const event of events) {
    if (event.is_all_day) continue;

    const isZeroDuration = event.end_time <= event.start_time;
    const intersects = isZeroDuration
      ? event.start_time >= dayStartSec && event.start_time < dayEndSec
      : event.start_time < dayEndSec && event.end_time > dayStartSec;

    if (!intersects) continue;

    const clampedStart = Math.max(event.start_time, dayStartSec);
    const clampedEnd = Math.min(Math.max(event.end_time, clampedStart), dayEndSec);

    let visualStart = clampedStart;
    let visualEnd = Math.max(clampedEnd, clampedStart + minDur);
    if (visualEnd > dayEndSec) {
      visualEnd = dayEndSec;
      visualStart = Math.max(dayStartSec, dayEndSec - Math.max(clampedEnd - clampedStart, minDur));
    }

    items.push({
      event,
      visualStart,
      visualEnd,
      column: 0,
    });
  }

  if (items.length === 0) return [];

  // Sort by start ascending, then longer duration descending, then id for stability
  items.sort((a, b) => {
    if (a.visualStart !== b.visualStart) return a.visualStart - b.visualStart;
    const durDiff = (b.visualEnd - b.visualStart) - (a.visualEnd - a.visualStart);
    if (durDiff !== 0) return durDiff;
    return a.event.id.localeCompare(b.event.id);
  });

  // Partition into connected overlap clusters
  const clusters: InternalLayoutItem[][] = [];
  let currentCluster: InternalLayoutItem[] = [];
  let clusterMaxEnd = -Infinity;

  for (const item of items) {
    if (currentCluster.length > 0 && item.visualStart >= clusterMaxEnd) {
      clusters.push(currentCluster);
      currentCluster = [item];
      clusterMaxEnd = item.visualEnd;
    } else {
      currentCluster.push(item);
      if (item.visualEnd > clusterMaxEnd) clusterMaxEnd = item.visualEnd;
    }
  }
  if (currentCluster.length > 0) clusters.push(currentCluster);

  const positioned: PositionedCalendarEvent[] = [];

  for (const cluster of clusters) {
    const columnEnds: number[] = [];

    for (const item of cluster) {
      let assignedCol = -1;
      for (let c = 0; c < columnEnds.length; c++) {
        const end = columnEnds[c];
        if (end !== undefined && end <= item.visualStart) {
          assignedCol = c;
          columnEnds[c] = item.visualEnd;
          break;
        }
      }
      if (assignedCol === -1) {
        assignedCol = columnEnds.length;
        columnEnds.push(item.visualEnd);
      }
      item.column = assignedCol;
    }

    const totalColumns = columnEnds.length;

    for (const item of cluster) {
      // Expand rightward into adjacent columns that have no overlapping event
      let colSpan = 1;
      while (item.column + colSpan < totalColumns) {
        const nextCol = item.column + colSpan;
        const collides = cluster.some(
          (other) =>
            other.column === nextCol &&
            other.visualStart < item.visualEnd &&
            other.visualEnd > item.visualStart,
        );
        if (collides) break;
        colSpan++;
      }

      const topPct = ((item.visualStart - dayStartSec) / dayDurationSec) * 100;
      const heightPct = ((item.visualEnd - item.visualStart) / dayDurationSec) * 100;
      const leftPct = (item.column / totalColumns) * 100;
      const widthPct = (colSpan / totalColumns) * 100;

      positioned.push({
        event: item.event,
        topPct,
        heightPct,
        leftPct,
        widthPct,
        column: item.column,
        totalColumns,
        colSpan,
      });
    }
  }

  return positioned;
}
