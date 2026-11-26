import { useMemo, type CSSProperties } from "react";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import { EventCard } from "./EventCard";
import { CALENDAR_SNAP_DURATION_MS } from "@/hooks/useCalendarSwipe";

interface MonthViewProps {
  currentDate: Date;
  events: DbCalendarEvent[];
  onEventClick: (event: DbCalendarEvent) => void;
  swipeOffsetPx?: number;
  isSnapping?: boolean;
  snapDurationMs?: number;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface MonthGridData {
  year: number;
  month: number;
  cells: (number | null)[];
  eventsByDay: Map<number, DbCalendarEvent[]>;
}

function buildMonthGrid(year: number, month: number, events: DbCalendarEvent[]): MonthGridData {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay();
  const totalDays = lastDay.getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const eventsByDay = new Map<number, DbCalendarEvent[]>();
  for (let d = 1; d <= totalDays; d++) {
    const dayStart = new Date(year, month, d).getTime() / 1000;
    const dayEnd = new Date(year, month, d + 1).getTime() / 1000;
    const dayEvents = events.filter((e) => e.start_time < dayEnd && e.end_time > dayStart);
    if (dayEvents.length > 0) eventsByDay.set(d, dayEvents);
  }

  return { year, month, cells, eventsByDay };
}

export function MonthView({
  currentDate,
  events,
  onEventClick,
  swipeOffsetPx = 0,
  isSnapping = false,
  snapDurationMs = CALENDAR_SNAP_DURATION_MS,
}: MonthViewProps) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;

  // Render [prevMonth, currentMonth, nextMonth] so fluid horizontal swiping reveals adjacent months
  const months = useMemo(
    () =>
      [-1, 0, 1].map((offset) => {
        const d = new Date(year, month + offset, 1);
        return buildMonthGrid(d.getFullYear(), d.getMonth(), events);
      }),
    [events, year, month],
  );

  const trackStyle: CSSProperties = {
    width: "300%",
    transform: `translate3d(calc(-100% / 3 + ${swipeOffsetPx}px), 0, 0)`,
    transition: isSnapping ? `transform ${snapDurationMs}ms cubic-bezier(0.2, 0, 0, 1)` : "none",
    willChange: swipeOffsetPx !== 0 || isSnapping ? "transform" : undefined,
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-border-primary shrink-0">
        {DAY_NAMES.map((name) => (
          <div key={name} className="px-2 py-2 text-xs font-medium text-text-tertiary text-center">
            {name}
          </div>
        ))}
      </div>

      {/* Fluid sliding month panels */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="flex h-full" style={trackStyle}>
          {months.map((m, mi) => (
            <div
              key={`${m.year}-${m.month}-${mi}`}
              className="w-1/3 shrink-0 h-full grid grid-cols-7 auto-rows-fr overflow-y-auto"
              style={{ touchAction: "pan-y pinch-zoom" }}
            >
              {m.cells.map((day, idx) => {
                if (day === null) {
                  return <div key={`empty-${idx}`} className="border-b border-r border-border-secondary bg-bg-tertiary/30" />;
                }
                const isToday = `${m.year}-${m.month}-${day}` === todayStr;
                const dayEvents = m.eventsByDay.get(day) ?? [];

                return (
                  <div
                    key={day}
                    className="border-b border-r border-border-secondary p-1 min-h-[80px]"
                  >
                    <div className={`text-xs font-medium mb-0.5 w-6 h-6 flex items-center justify-center rounded-full ${
                      isToday ? "bg-accent text-white" : "text-text-secondary"
                    }`}>
                      {day}
                    </div>
                    <div className="space-y-0.5">
                      {dayEvents.slice(0, 3).map((event) => (
                        <EventCard
                          key={event.id}
                          event={event}
                          compact
                          onClick={() => onEventClick(event)}
                        />
                      ))}
                      {dayEvents.length > 3 && (
                        <div className="text-[0.625rem] text-text-tertiary pl-1">
                          +{dayEvents.length - 3} more
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
