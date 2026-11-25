import { useMemo, type CSSProperties } from "react";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import {
  layoutAllDayEvents,
  layoutDayEvents,
  type PositionedCalendarEvent,
} from "@/utils/calendarLayout";
import { CALENDAR_SNAP_DURATION_MS } from "@/hooks/useCalendarSwipe";

interface WeekViewProps {
  currentDate: Date;
  events: DbCalendarEvent[];
  onEventClick: (event: DbCalendarEvent) => void;
  dayCount?: 3 | 7;
  swipeOffsetPx?: number;
  isSnapping?: boolean;
  snapDurationMs?: number;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function WeekView({
  currentDate,
  events,
  onEventClick,
  dayCount = 7,
  swipeOffsetPx = 0,
  isSnapping = false,
  snapDurationMs = CALENDAR_SNAP_DURATION_MS,
}: WeekViewProps) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const date = currentDate.getDate();

  // Render `dayCount` buffered days on each side so fluid horizontal swiping reveals adjacent days smoothly
  const allDays = useMemo(() => {
    const start = new Date(year, month, date);
    return Array.from({ length: dayCount * 3 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i - dayCount);
      return d;
    });
  }, [year, month, date, dayCount]);

  const totalDays = allDays.length;
  const trackStyle: CSSProperties = {
    width: "300%",
    transform: `translate3d(calc(-100% / 3 + ${swipeOffsetPx}px), 0, 0)`,
    transition: isSnapping ? `transform ${snapDurationMs}ms cubic-bezier(0.2, 0, 0, 1)` : "none",
    willChange: swipeOffsetPx !== 0 || isSnapping ? "transform" : undefined,
  };
  const trackGridStyle: CSSProperties = {
    ...trackStyle,
    gridTemplateColumns: `repeat(${totalDays}, minmax(0, 1fr))`,
  };

  const today = new Date();
  const todayStr = today.toDateString();

  // Compute positioned timed events per day column and spanning all-day bars across the buffered strip
  const { timedEventsByDay, allDayLayout } = useMemo(() => {
    const timed: PositionedCalendarEvent[][] = [];

    for (const day of allDays) {
      const dayStartSec = day.getTime() / 1000;
      const nextDay = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
      const dayEndSec = nextDay.getTime() / 1000;

      timed.push(layoutDayEvents(events, dayStartSec, dayEndSec));
    }

    return {
      timedEventsByDay: timed,
      allDayLayout: layoutAllDayEvents(events, allDays),
    };
  }, [events, allDays]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Day headers */}
      <div className="flex border-b border-border-primary shrink-0">
        <div className="w-[44px] shrink-0 border-r border-border-secondary" />
        <div className="flex-1 min-w-0 overflow-hidden">
          <div className="grid" style={trackGridStyle}>
            {allDays.map((day, i) => {
              const isToday = day.toDateString() === todayStr;
              return (
                <div key={i} className="px-2 py-2 text-center border-r border-border-secondary">
                  <div className="text-xs text-text-tertiary">{DAY_NAMES[day.getDay()]}</div>
                  <div className={`text-sm font-medium mt-0.5 w-7 h-7 flex items-center justify-center mx-auto rounded-full ${
                    isToday ? "bg-accent text-white" : "text-text-primary"
                  }`}>
                    {day.getDate()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* All-day events row */}
      <div
        className="flex border-b border-border-primary shrink-0 max-h-24 overflow-y-auto"
        style={{ touchAction: "pan-y pinch-zoom" }}
      >
        <div className="w-[44px] shrink-0 border-r border-border-secondary px-1 py-1 text-[0.625rem] text-text-tertiary flex items-center justify-end">
          all-day
        </div>
        <div className="flex-1 min-w-0 overflow-hidden">
          <div className="relative min-h-7" style={trackStyle}>
            {/* Background day column dividers */}
            <div
              className="absolute inset-0 grid pointer-events-none"
              style={{ gridTemplateColumns: `repeat(${totalDays}, minmax(0, 1fr))` }}
            >
              {allDays.map((_, i) => (
                <div key={i} className="border-r border-border-secondary" />
              ))}
            </div>
            {/* Spanning all-day event bars */}
            {allDayLayout.length > 0 && (
              <div
                className="relative grid gap-y-0.5 py-1"
                style={{ gridTemplateColumns: `repeat(${totalDays}, minmax(0, 1fr))` }}
              >
                {allDayLayout.map((item) => (
                  <button
                    key={item.event.id}
                    data-calendar-all-day=""
                    onClick={() => onEventClick(item.event)}
                    style={{
                      gridColumn: `${item.startCol + 1} / span ${item.span}`,
                      gridRow: item.row + 1,
                    }}
                    className={`text-left text-[0.625rem] leading-tight px-1.5 py-0.5 bg-accent/15 text-accent truncate hover:bg-accent/25 transition-colors block ${
                      item.continuesLeft
                        ? "rounded-l-none ml-0"
                        : "rounded-l-sm ml-1 border-l-2 border-accent"
                    } ${item.continuesRight ? "rounded-r-none mr-0" : "rounded-r-sm mr-1"}`}
                    title={item.event.summary ?? "Event"}
                  >
                    {item.event.summary ?? "Event"}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Time grid */}
      <div
        aria-label="Time of day"
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
        style={{ touchAction: "pan-y pinch-zoom" }}
      >
        <div className="flex">
          {/* Fixed time gutter */}
          <div className="w-[44px] shrink-0 border-r border-border-secondary">
            {HOURS.map((hour) => (
              <div key={hour} className="h-12 px-1.5 flex items-start justify-end">
                <span className="text-[0.6875rem] leading-none text-text-tertiary -mt-1.5 select-none">
                  {hour === 0 ? "" : `${hour % 12 || 12}${hour < 12 ? "am" : "pm"}`}
                </span>
              </div>
            ))}
          </div>

          {/* Fluid sliding day columns */}
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="grid" style={trackGridStyle}>
              {allDays.map((_, di) => {
                const dayEvents = timedEventsByDay[di] ?? [];
                return (
                  <div key={di} className="relative border-r border-border-secondary">
                    {HOURS.map((hour) => (
                      <div key={hour} className="h-12 border-b border-border-secondary" />
                    ))}
                    {dayEvents.map(({ event, topPct, heightPct, leftPct, widthPct }) => (
                      <button
                        key={event.id}
                        data-calendar-timed-event=""
                        onClick={() => onEventClick(event)}
                        style={{
                          top: `calc(${topPct}% + 1px)`,
                          height: `calc(${heightPct}% - 2px)`,
                          left: `calc(${leftPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                        }}
                        className="absolute text-left text-[0.625rem] leading-tight px-1 py-0.5 rounded bg-accent/15 border border-accent/25 text-accent overflow-hidden hover:bg-accent/25 transition-colors flex flex-col justify-start"
                        title={event.summary ?? "Event"}
                      >
                        <span className={heightPct >= 3.5 ? "line-clamp-3 break-words" : "truncate w-full"}>
                          {event.summary ?? "Event"}
                        </span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
