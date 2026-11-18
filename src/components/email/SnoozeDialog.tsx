import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { CSSTransition } from "react-transition-group";
import {
  Sun,
  Sunrise,
  Coffee,
  CalendarDays,
  CalendarClock,
  Clock,
  ChevronRight,
  ChevronDown,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

export interface SnoozePreset {
  label: string;
  detail: string;
  timestamp: number;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
  shortcut?: string;
}

export interface SnoozeDialogProps {
  isOpen?: boolean;
  onSnooze: (until: number) => void;
  onClose: () => void;
}

export function getSnoozePresets(): SnoozePreset[] {
  const now = new Date();
  const today = new Date(now);

  // Later today: 5pm if before 2pm, or +3 hours
  const laterToday = new Date(now);
  if (now.getHours() < 14) {
    laterToday.setHours(17, 0, 0, 0);
  } else {
    laterToday.setTime(now.getTime() + 3 * 60 * 60 * 1000);
  }
  const laterTodayTimeStr = laterToday.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  // Tomorrow morning: 9:00 AM
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const tomorrowDayStr = tomorrow.toLocaleDateString(undefined, {
    weekday: "short",
  });
  const tomorrowDateStr = tomorrow.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  // This weekend (Saturday 9:00 AM)
  const weekend = new Date(today);
  const dayOfWeek = weekend.getDay();
  const daysUntilSaturday = (6 - dayOfWeek + 7) % 7 || 7;
  weekend.setDate(weekend.getDate() + daysUntilSaturday);
  weekend.setHours(9, 0, 0, 0);
  const weekendDateStr = weekend.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  // Next week (Monday 9:00 AM)
  const nextWeek = new Date(today);
  const daysUntilMonday = (1 - dayOfWeek + 7) % 7 || 7;
  nextWeek.setDate(nextWeek.getDate() + daysUntilMonday);
  nextWeek.setHours(9, 0, 0, 0);
  const nextWeekDateStr = nextWeek.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  return [
    {
      label: "Later today",
      detail: `Today • ${laterTodayTimeStr}`,
      timestamp: Math.floor(laterToday.getTime() / 1000),
      icon: Sun,
      iconColor: "text-amber-500",
      iconBg: "bg-amber-500/10",
      shortcut: "1",
    },
    {
      label: "Tomorrow morning",
      detail: `${tomorrowDayStr}, ${tomorrowDateStr} • 9:00 AM`,
      timestamp: Math.floor(tomorrow.getTime() / 1000),
      icon: Sunrise,
      iconColor: "text-orange-500",
      iconBg: "bg-orange-500/10",
      shortcut: "2",
    },
    {
      label: "This weekend",
      detail: `Sat, ${weekendDateStr} • 9:00 AM`,
      timestamp: Math.floor(weekend.getTime() / 1000),
      icon: Coffee,
      iconColor: "text-emerald-500",
      iconBg: "bg-emerald-500/10",
      shortcut: "3",
    },
    {
      label: "Next week",
      detail: `Mon, ${nextWeekDateStr} • 9:00 AM`,
      timestamp: Math.floor(nextWeek.getTime() / 1000),
      icon: CalendarDays,
      iconColor: "text-blue-500",
      iconBg: "bg-blue-500/10",
      shortcut: "4",
    },
  ];
}

export function SnoozeDialog({ isOpen = true, onSnooze, onClose }: SnoozeDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const presets = useMemo(() => getSnoozePresets(), []);
  const [isCustomOpen, setIsCustomOpen] = useState(false);
  const [customDate, setCustomDate] = useState("");
  const [customTime, setCustomTime] = useState("09:00");
  const [dragOffset, setDragOffset] = useState(0);
  const touchStartY = useRef<number | null>(null);

  const todayStr = useMemo(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }, []);

  const handlePresetClick = (timestamp: number) => {
    onSnooze(timestamp);
  };

  const handleCustomSubmit = () => {
    if (!customDate) return;
    const dt = new Date(`${customDate}T${customTime}`);
    onSnooze(Math.floor(dt.getTime() / 1000));
  };

  // Touch drag to dismiss on mobile bottom sheet
  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (touch) {
      touchStartY.current = touch.clientY;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (touchStartY.current === null || !touch) return;
    const diff = touch.clientY - touchStartY.current;
    if (diff > 0) {
      setDragOffset(diff);
    }
  };

  const handleTouchEnd = () => {
    if (dragOffset > 70) {
      onClose();
    }
    setDragOffset(0);
    touchStartY.current = null;
  };

  // Keyboard shortcut listener (1-4 for presets, 5 for custom, ESC for close)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === "input" || activeTag === "textarea") return;

      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 4) {
        const target = presets[num - 1];
        if (target) {
          e.preventDefault();
          onSnooze(target.timestamp);
        }
      } else if (num === 5) {
        e.preventDefault();
        setIsCustomOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, presets, onSnooze, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <CSSTransition
      in={isOpen}
      timeout={200}
      classNames="modal"
      unmountOnExit
      nodeRef={overlayRef}
    >
      <div
        ref={overlayRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="snooze-dialog-title"
        className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {/* Scrim Backdrop */}
        <div
          className="glass-backdrop absolute inset-0 bg-black/60 dark:bg-black/75 backdrop-blur-xs transition-opacity"
          aria-hidden="true"
          onClick={onClose}
        />

        {/* Modal / Android Bottom Sheet Panel */}
        <div
          style={{
            transform: dragOffset > 0 ? `translateY(${dragOffset}px)` : undefined,
            transition: dragOffset > 0 ? "none" : undefined,
          }}
          className="modal-panel relative flex flex-col w-full sm:w-[420px] max-w-full sm:max-w-md bg-bg-primary dark:bg-zinc-900 border-t sm:border border-border-primary/80 rounded-t-[28px] sm:rounded-2xl shadow-2xl overflow-hidden transition-all duration-150 max-h-[88dvh] sm:max-h-[85dvh] pb-[max(1.25rem,calc(env(safe-area-inset-bottom,0px)+0.75rem))] sm:pb-3"
        >
          {/* Mobile Drag Handle (Material 3 pill affordance) */}
          <div
            className="sm:hidden flex flex-col items-center pt-3 pb-1 cursor-grab active:cursor-grabbing select-none shrink-0 touch-none"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onClick={onClose}
            aria-label="Drag down to dismiss"
          >
            <div className="w-12 h-1.5 rounded-full bg-border-primary/90 dark:bg-zinc-600 transition-transform active:scale-95" />
          </div>

          {/* Header */}
          <div
            className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-border-primary/60 shrink-0 select-none"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-accent/15 text-accent flex items-center justify-center shrink-0">
                <Clock size={16} />
              </div>
              <div>
                <h3 id="snooze-dialog-title" className="text-base sm:text-sm font-semibold text-text-primary leading-tight">
                  Snooze until...
                </h3>
                <p className="text-[11px] sm:text-xs text-text-tertiary">
                  Select when to return this email to Inbox
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 w-11 h-11 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-hover active:bg-bg-tertiary active:scale-95 transition-all"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>

          {/* Presets List */}
          <div className="p-2 sm:p-2.5 space-y-1 overflow-y-auto overscroll-contain">
            {presets.map((preset) => {
              const Icon = preset.icon;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => handlePresetClick(preset.timestamp)}
                  className="w-full min-h-[52px] sm:min-h-[48px] px-3.5 py-2.5 rounded-xl border border-transparent hover:border-border-primary/60 hover:bg-bg-hover active:bg-accent/10 active:border-accent/30 active:scale-[0.99] transition-all flex items-center gap-3 text-left group touch-manipulation cursor-pointer"
                >
                  <div
                    className={`w-9 h-9 rounded-xl ${preset.iconBg} ${preset.iconColor} flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 group-active:scale-95`}
                  >
                    <Icon size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text-primary group-hover:text-accent transition-colors leading-tight">
                      {preset.label}
                    </div>
                    <div className="text-xs text-text-tertiary mt-0.5 truncate">
                      {preset.detail}
                    </div>
                  </div>
                  {preset.shortcut && (
                    <kbd className="hidden sm:inline-flex items-center justify-center text-[10px] font-mono w-5 h-5 rounded bg-bg-secondary border border-border-primary/60 text-text-tertiary">
                      {preset.shortcut}
                    </kbd>
                  )}
                </button>
              );
            })}

            {/* Custom date & time row */}
            <button
              type="button"
              onClick={() => setIsCustomOpen((prev) => !prev)}
              aria-expanded={isCustomOpen}
              className={`w-full min-h-[52px] sm:min-h-[48px] px-3.5 py-2.5 rounded-xl border transition-all flex items-center gap-3 text-left group touch-manipulation cursor-pointer ${
                isCustomOpen
                  ? "border-accent/40 bg-accent/5 text-accent"
                  : "border-transparent hover:border-border-primary/60 hover:bg-bg-hover active:bg-accent/10 active:border-accent/30 active:scale-[0.99]"
              }`}
            >
              <div
                className={`w-9 h-9 rounded-xl ${
                  isCustomOpen ? "bg-accent text-white" : "bg-purple-500/10 text-purple-500"
                } flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 group-active:scale-95`}
              >
                <CalendarClock size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-text-primary group-hover:text-accent transition-colors leading-tight">
                  Custom date & time
                </div>
                <div className="text-xs text-text-tertiary mt-0.5 truncate">
                  {customDate ? `${customDate} • ${customTime}` : "Pick date and exact time"}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 text-text-tertiary">
                <kbd className="hidden sm:inline-flex items-center justify-center text-[10px] font-mono w-5 h-5 rounded bg-bg-secondary border border-border-primary/60 text-text-tertiary">
                  5
                </kbd>
                {isCustomOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </div>
            </button>

            {/* Expandable Custom date & time section */}
            {isCustomOpen && (
              <div className="pt-2 px-1 pb-1 space-y-3 animate-in fade-in duration-200">
                <div className="grid grid-cols-5 gap-2">
                  <div className="col-span-3">
                    <label className="block text-[11px] font-medium text-text-secondary mb-1">Date</label>
                    <input
                      type="date"
                      min={todayStr}
                      value={customDate}
                      onChange={(e) => setCustomDate(e.target.value)}
                      className="w-full h-11 sm:h-9 text-sm sm:text-xs bg-bg-secondary hover:bg-bg-tertiary focus:bg-bg-primary border border-border-primary rounded-xl sm:rounded-lg px-3 py-2 text-text-primary focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[11px] font-medium text-text-secondary mb-1">Time</label>
                    <input
                      type="time"
                      value={customTime}
                      onChange={(e) => setCustomTime(e.target.value)}
                      className="w-full h-11 sm:h-9 text-sm sm:text-xs bg-bg-secondary hover:bg-bg-tertiary focus:bg-bg-primary border border-border-primary rounded-xl sm:rounded-lg px-3 py-2 text-text-primary focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all"
                    />
                  </div>
                </div>

                {/* Quick Time Pills */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-text-tertiary mr-0.5">Quick:</span>
                  {[
                    { label: "8:00 AM", value: "08:00" },
                    { label: "1:00 PM", value: "13:00" },
                    { label: "5:00 PM", value: "17:00" },
                    { label: "8:00 PM", value: "20:00" },
                  ].map((slot) => (
                    <button
                      key={slot.value}
                      type="button"
                      onClick={() => setCustomTime(slot.value)}
                      className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all touch-manipulation ${
                        customTime === slot.value
                          ? "bg-accent/15 border-accent text-accent font-medium shadow-2xs"
                          : "bg-bg-secondary/60 hover:bg-bg-hover text-text-secondary border-border-primary/50"
                      }`}
                    >
                      {slot.label}
                    </button>
                  ))}
                </div>

                <Button
                  variant="primary"
                  onClick={handleCustomSubmit}
                  disabled={!customDate}
                  className="w-full min-h-[48px] sm:min-h-[40px] rounded-xl font-medium text-sm shadow-xs hover:shadow-md transition-all flex items-center justify-center gap-2"
                >
                  <Clock size={15} />
                  <span>Snooze</span>
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </CSSTransition>,
    document.body,
  );
}
