import { ChevronLeft, ChevronRight, Plus, CalendarDays } from "lucide-react";

export type CalendarView = "day" | "threeDay" | "week" | "month";

const VIEW_OPTIONS: { value: CalendarView; label: string; accessibleLabel: string }[] = [
  { value: "day", label: "1", accessibleLabel: "1 day" },
  { value: "threeDay", label: "3", accessibleLabel: "3 days" },
  { value: "week", label: "7", accessibleLabel: "7 days" },
  { value: "month", label: "Month", accessibleLabel: "Month" },
];

interface CalendarToolbarProps {
  currentDate: Date;
  view: CalendarView;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onViewChange: (view: CalendarView) => void;
  onCreateEvent: () => void;
  onToggleCalendarList?: () => void;
  showCalendarListButton?: boolean;
}

export function CalendarToolbar({
  currentDate,
  view,
  onPrev,
  onNext,
  onToday,
  onViewChange,
  onCreateEvent,
  onToggleCalendarList,
  showCalendarListButton,
}: CalendarToolbarProps) {
  const title = formatTitle(currentDate, view);

  return (
    <div className="flex min-w-0 shrink-0 flex-col gap-2 px-3 py-2 md:flex-row md:items-center md:justify-between md:px-6 md:py-3 border-b border-border-primary">
      <div className="flex min-w-0 items-center justify-between gap-2 md:gap-3">
        <h2 className="min-w-0 text-sm leading-tight font-semibold text-text-primary md:text-lg">{title}</h2>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={onPrev}
            aria-label="Previous date range"
            className="flex h-10 w-9 md:h-auto md:w-auto items-center justify-center p-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={onToday}
            className="h-10 md:h-auto px-2 py-1 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded transition-colors"
          >
            Today
          </button>
          <button
            onClick={onNext}
            aria-label="Next date range"
            className="flex h-10 w-9 md:h-auto md:w-auto items-center justify-center p-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-2 md:shrink-0">
        {showCalendarListButton && onToggleCalendarList && (
          <button
            onClick={onToggleCalendarList}
            className="flex h-10 w-10 shrink-0 md:h-auto md:w-auto items-center justify-center p-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded transition-colors"
            aria-label="Toggle calendar list"
            title="Toggle calendar list"
          >
            <CalendarDays size={16} />
          </button>
        )}
        <div className="flex min-w-0 bg-bg-tertiary rounded-md p-0.5" role="group" aria-label="Calendar view">
          {VIEW_OPTIONS.map(({ value: v, label, accessibleLabel }) => (
            <button
              key={v}
              onClick={() => onViewChange(v)}
              aria-pressed={view === v}
              aria-label={accessibleLabel}
              title={accessibleLabel}
              className={`min-w-9 h-9 md:h-auto px-2 py-1 text-xs font-medium rounded transition-colors ${
                view === v
                  ? "bg-bg-primary text-text-primary shadow-sm"
                  : "text-text-tertiary hover:text-text-secondary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={onCreateEvent}
          aria-label="Create event"
          title="Create event"
          className="flex h-10 w-10 shrink-0 items-center justify-center text-white bg-accent hover:bg-accent-hover rounded-md transition-colors md:h-8 md:w-8"
        >
          <Plus size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function formatTitle(date: Date, view: CalendarView): string {
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  if (view === "month") {
    return `${months[date.getMonth()]} ${date.getFullYear()}`;
  }
  if (view === "week" || view === "threeDay") {
    const start = new Date(date);
    if (view === "week") start.setDate(start.getDate() - start.getDay());
    const end = new Date(start);
    end.setDate(end.getDate() + (view === "threeDay" ? 2 : 6));
    if (start.getMonth() === end.getMonth()) {
      return `${months[start.getMonth()]} ${start.getDate()}-${end.getDate()}, ${start.getFullYear()}`;
    }
    return `${months[start.getMonth()]?.slice(0, 3)} ${start.getDate()} - ${months[end.getMonth()]?.slice(0, 3)} ${end.getDate()}, ${end.getFullYear()}`;
  }
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
