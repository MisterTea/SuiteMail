import { useMemo, type CSSProperties } from "react";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import { layoutDayEvents } from "@/utils/calendarLayout";
import { CALENDAR_SNAP_DURATION_MS } from "@/hooks/useCalendarSwipe";

interface DayViewProps {
  currentDate: Date;
  events: DbCalendarEvent[];
  onEventClick: (event: DbCalendarEvent) => void;
  swipeOffsetPx?: number;
  isSnapping?: boolean;
  snapDurationMs?: number;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function DayView({
  currentDate,
  events,
  onEventClick,
  swipeOffsetPx = 0,
  isSnapping = false,
  snapDurationMs = CALENDAR_SNAP_DURATION_MS,
}: DayViewProps) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const date = currentDate.getDate();

  // Render [prevDay, currentDay, nextDay] so fluid horizontal swiping reveals adjacent days
  const days = useMemo(
    () => [-1, 0, 1].map((offset) => new Date(year, month, date + offset)),
    [year, month, date],
  );

  const { timedEventsByDay, allDayByDay, hasAnyAllDay } = useMemo(() => {
    const timed = days.map((day) => {
      const dayStartSec = day.getTime() / 1000;
      const dayEndSec = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime() / 1000;
      return layoutDayEvents(events, dayStartSec, dayEndSec);
    });
    const allDay = days.map((day) => {
      const dayStartSec = day.getTime() / 1000;
      const dayEndSec = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime() / 1000;
      return events.filter((e) => e.is_all_day && e.start_time < dayEndSec && e.end_time > dayStartSec);
    });
    return {
      timedEventsByDay: timed,
      allDayByDay: allDay,
      hasAnyAllDay: allDay.some((list) => list.length > 0),
    };
  }, [events, days]);

  const todayStr = new Date().toDateString();
  const trackStyle: CSSProperties = {
    width: "300%",
    transform: `translate3d(calc(-100% / 3 + ${swipeOffsetPx}px), 0, 0)`,
    transition: isSnapping ? `transform ${snapDurationMs}ms cubic-bezier(0.2, 0, 0, 1)` : "none",
    willChange: swipeOffsetPx !== 0 || isSnapping ? "transform" : undefined,
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Header */}
      <div className="border-b border-border-primary shrink-0 overflow-hidden">
        <div className="flex" style={trackStyle}>
          {days.map((day, i) => {
            const isToday = todayStr === day.toDateString();
            return (
              <div key={i} className="w-1/3 shrink-0 px-6 py-3 flex items-center gap-3">
                <div className={`text-2xl font-bold w-10 h-10 flex items-center justify-center rounded-full ${
                  isToday ? "bg-accent text-white" : "text-text-primary"
                }`}>
                  {day.getDate()}
                </div>
                <div className="text-sm text-text-secondary">
                  {day.toLocaleDateString(undefined, { weekday: "long" })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* All-day events */}
      {hasAnyAllDay && (
        <div className="border-b border-border-secondary shrink-0 max-h-24 overflow-y-auto overflow-x-hidden" style={{ touchAction: "pan-y pinch-zoom" }}>
          <div className="flex" style={trackStyle}>
            {days.map((_, i) => {
              const dayAllDay = allDayByDay[i] ?? [];
              return (
                <div key={i} className="w-1/3 shrink-0 px-6 py-1.5 space-y-1">
                  {dayAllDay.map((e) => (
                    <button
                      key={e.id}
                      data-calendar-all-day=""
                      onClick={() => onEventClick(e)}
                      className="w-full text-left text-[0.6875rem] leading-tight px-2 py-1 rounded-sm bg-accent/15 border-l-2 border-accent text-accent truncate hover:bg-accent/25 transition-colors block"
                    >
                      {e.summary ?? "Event"} · All day
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Time grid */}
      <div aria-label="Time of day" className="flex-1 min-h-0 overflow-y-auto overscroll-contain" style={{ touchAction: "pan-y pinch-zoom" }}>
        <div className="flex">
          {/* Fixed time gutter */}
          <div className="w-16 shrink-0 border-r border-border-secondary">
            {HOURS.map((hour) => (
              <div key={hour} className="h-14 px-2 flex items-start justify-end">
                <span className="text-[0.6875rem] leading-none text-text-tertiary -mt-1.5 select-none">
                  {hour === 0 ? "" : `${hour % 12 || 12}${hour < 12 ? "am" : "pm"}`}
                </span>
              </div>
            ))}
          </div>

          {/* Fluid sliding day columns */}
          <div className="flex-1 min-w-0 overflow-hidden">
            <div
              className="grid"
              style={{ ...trackStyle, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}
            >
              {days.map((_, di) => {
                const dayEvents = timedEventsByDay[di] ?? [];
                return (
                  <div key={di} className="relative">
                    {HOURS.map((hour) => (
                      <div key={hour} className="h-14 border-b border-border-secondary" />
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
                        className="absolute text-left text-xs leading-tight px-2 py-1 rounded bg-accent/15 border border-accent/25 text-accent overflow-hidden hover:bg-accent/25 transition-colors flex flex-col justify-start"
                        title={event.summary ?? "Event"}
                      >
                        <span className={heightPct >= 3.5 ? "line-clamp-3 break-words" : "truncate w-full"}>
                          {event.summary ?? "Event"}
                          {event.location && <span className="text-text-tertiary"> · {event.location}</span>}
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
