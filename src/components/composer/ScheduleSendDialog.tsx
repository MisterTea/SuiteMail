import { useNativePhone } from "@/hooks/useNativePhone";
import { useState, useMemo, useRef } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import {
  Repeat,
  Sunrise,
  Sun,
  CalendarDays,
  CalendarClock,
  Clock,
  ChevronDown,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";

export type RecurrenceRule = "none" | "daily" | "weekdays" | "weekly" | "monthly";

export interface ScheduleSendDialogProps {
  onSchedule: (timestamp: number, recurrenceRule?: string | null) => void;
  onClose: () => void;
}

export interface PresetItem {
  label: string;
  subtext: string;
  detail: string;
  timestamp: number;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
}

function getSchedulePresets(): PresetItem[] {
  const now = new Date();
  const today = new Date(now);

  // Tomorrow morning 9am
  const tomorrowMorning = new Date(today);
  tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
  tomorrowMorning.setHours(9, 0, 0, 0);

  // Tomorrow afternoon 1pm
  const tomorrowAfternoon = new Date(today);
  tomorrowAfternoon.setDate(tomorrowAfternoon.getDate() + 1);
  tomorrowAfternoon.setHours(13, 0, 0, 0);

  // Monday morning 9am
  const monday = new Date(today);
  const dayOfWeek = monday.getDay();
  const daysUntilMonday = (1 - dayOfWeek + 7) % 7 || 7;
  monday.setDate(monday.getDate() + daysUntilMonday);
  monday.setHours(9, 0, 0, 0);

  return [
    {
      label: "Tomorrow morning",
      subtext: "Start of next business day",
      detail:
        tomorrowMorning.toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        }) + " 9:00 AM",
      timestamp: Math.floor(tomorrowMorning.getTime() / 1000),
      icon: Sunrise,
      iconColor: "text-amber-500",
      iconBg: "bg-amber-500/10",
    },
    {
      label: "Tomorrow afternoon",
      subtext: "Afternoon follow-up",
      detail:
        tomorrowAfternoon.toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        }) + " 1:00 PM",
      timestamp: Math.floor(tomorrowAfternoon.getTime() / 1000),
      icon: Sun,
      iconColor: "text-orange-500",
      iconBg: "bg-orange-500/10",
    },
    {
      label: "Monday morning",
      subtext: "First thing next week",
      detail:
        monday.toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        }) + " 9:00 AM",
      timestamp: Math.floor(monday.getTime() / 1000),
      icon: CalendarDays,
      iconColor: "text-blue-500",
      iconBg: "bg-blue-500/10",
    },
  ];
}

export function ScheduleSendDialog({ onSchedule, onClose }: ScheduleSendDialogProps) {
  const android = useNativePhone();
  const [validationError, setValidationError] = useState("");
  const presets = useMemo(() => getSchedulePresets(), []);
  const [recurrence, setRecurrence] = useState<RecurrenceRule>("none");
  const [customDateTime, setCustomDateTime] = useState("");
  const [customDate, setCustomDate] = useState("");
  const [customTime, setCustomTime] = useState("09:00");
  const touchStartY = useRef<number | null>(null);

  const todayStr = useMemo(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }, []);

  const timeZoneName = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, " ");
    } catch {
      return "Local time";
    }
  }, []);

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (touch) {
      touchStartY.current = touch.clientY;
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const changed = e.changedTouches[0];
    if (touchStartY.current !== null && changed) {
      const deltaY = changed.clientY - touchStartY.current;
      if (deltaY > 50) {
        onClose();
      }
    }
    touchStartY.current = null;
  };

  const handleDateTimeChange = (val: string) => {
    setCustomDateTime(val);
    if (val) {
      const [d, t] = val.split("T");
      if (d) setCustomDate(d);
      if (t) setCustomTime(t);
    }
  };

  const handleDateChange = (val: string) => {
    setCustomDate(val);
    if (val && customTime) setCustomDateTime(`${val}T${customTime}`);
  };

  const handleTimeChange = (val: string) => {
    setCustomTime(val);
    if (customDate && val) setCustomDateTime(`${customDate}T${val}`);
  };

  const handleSelect = (timestamp: number) => {
    onSchedule(timestamp, recurrence === "none" ? null : recurrence);
  };

  const handleCustomSubmit = () => {
    let dt: Date;
    if (customDateTime) {
      dt = new Date(customDateTime);
    } else if (customDate) {
      dt = new Date(`${customDate}T${customTime}`);
    } else {
      return;
    }
    if (!Number.isFinite(dt.getTime()) || dt.getTime() <= Date.now()) {
      setValidationError("Choose a future date and time");
      return;
    }
    onSchedule(Math.floor(dt.getTime() / 1000), recurrence === "none" ? null : recurrence);
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={android ? "Send later" : "Schedule send"}
      width="w-full sm:w-[400px] max-w-full sm:max-w-md"
      zIndex="z-[60]"
      panelClassName="overflow-hidden shadow-2xl rounded-t-3xl sm:rounded-2xl border-t sm:border border-border-primary/80 transition-all duration-200"
      renderHeader={
        <div
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className="flex flex-col bg-bg-secondary/50 border-b border-border-primary/60 shrink-0 select-none"
        >
          {/* Mobile Sheet Drag Handle */}
          <div className="sm:hidden flex justify-center pt-2.5 pb-1 cursor-grab active:cursor-grabbing">
            <div className="w-10 h-1 rounded-full bg-border-primary/80 dark:bg-white/25 active:bg-accent/60 transition-colors" />
          </div>

          <div className="px-4 py-3 sm:py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-accent/10 text-accent flex items-center justify-center shrink-0 shadow-2xs">
                <Clock size={16} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-text-primary leading-tight">Schedule send</h3>
                <p className="text-[0.68rem] text-text-tertiary">Select delivery time ({timeZoneName})</p>
              </div>
            </div>
            <button
              style={android ? { minHeight: 48, minWidth: 48 } : undefined}
              type="button"
              onClick={onClose}
              className="min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:w-8 sm:h-8 rounded-xl flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-hover active:bg-bg-tertiary transition-colors touch-manipulation text-base leading-none"
              title="Close"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>
      }
    >
      <div className="p-4 space-y-3.5 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] sm:pb-4">
        {android && <p className="text-sm text-text-secondary" role="note">Keep SuiteMail open and connected to send at the selected time. If the app is closed, sending waits until you reopen it. This also applies to repeated sends.</p>}
        {/* Recurrence Selector */}
        <div className="flex items-center justify-between px-3.5 py-2.5 bg-bg-secondary/70 hover:bg-bg-secondary rounded-xl border border-border-primary/60 transition-colors min-h-[48px]">
          <div className="flex items-center gap-2.5 min-w-0 pr-2">
            <div className="w-8 h-8 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0">
              <Repeat size={14} className="text-accent" />
            </div>
            <div className="min-w-0">
              <span className="text-text-primary font-medium text-xs sm:text-xs block">Repeat</span>
              <div className={android ? "text-sm text-text-tertiary whitespace-normal" : "text-[0.68rem] text-text-tertiary truncate"}>Recurring delivery</div>
            </div>
          </div>
          <div className="relative shrink-0">
            <select
              role="combobox"
              aria-label="Repeat frequency"
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value as RecurrenceRule)}
              className="min-h-[44px] h-11 sm:h-9 bg-bg-tertiary hover:bg-bg-hover text-text-primary text-xs font-medium pl-3 pr-8 rounded-xl border border-border-primary/80 focus:border-accent focus:ring-1 focus:ring-accent outline-none appearance-none cursor-pointer transition-all touch-manipulation"
            >
              <option value="none">Does not repeat</option>
              <option value="daily">Every day</option>
              <option value="weekdays">Every weekday (Mon–Fri)</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
            </select>
            <ChevronDown
              size={14}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
            />
          </div>
        </div>

        {/* Presets List */}
        <div className="divide-y divide-border-primary/30 border border-border-primary/50 rounded-xl overflow-hidden shadow-2xs bg-bg-secondary/20">
          {presets.map((preset) => {
            const Icon = preset.icon;
            return (
              <button
              style={android ? { minHeight: 48, minWidth: 48 } : undefined}
                key={preset.label}
                type="button"
                onClick={() => handleSelect(preset.timestamp)}
                className="w-full min-h-[52px] flex items-center justify-between px-3.5 py-3 sm:py-2.5 text-xs text-text-primary hover:bg-bg-hover active:bg-bg-tertiary active:scale-[0.99] transition-all duration-150 text-left group cursor-pointer focus-visible:outline-none focus-visible:bg-bg-hover touch-manipulation select-none"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-8 h-8 rounded-xl ${preset.iconBg} ${preset.iconColor} flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 group-active:scale-95 shadow-2xs`}
                  >
                    <Icon size={16} />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className={android ? "font-semibold text-base text-text-primary whitespace-normal" : "font-semibold text-sm sm:text-xs text-text-primary group-hover:text-accent transition-colors truncate"}>
                      {preset.label}
                    </span>
                    <span className={android ? "text-sm text-text-tertiary whitespace-normal" : "text-[0.68rem] text-text-tertiary truncate"}>
                      {android ? new Date(preset.timestamp * 1000).toLocaleString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " · " + timeZoneName : preset.subtext}
                    </span>
                  </div>
                </div>

                <div className={android ? "hidden" : "flex items-center gap-1.5 shrink-0 pl-2"}>
                  <span className="text-[0.72rem] font-medium text-text-secondary bg-bg-secondary/90 px-2.5 py-1 rounded-lg border border-border-primary/40 shadow-2xs group-hover:border-accent/30 group-hover:text-text-primary transition-colors">
                    {preset.detail}
                  </span>
                  <ChevronRight
                    size={14}
                    className="text-text-tertiary opacity-40 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all duration-150"
                  />
                </div>
              </button>
            );
          })}
        </div>

        {/* Custom date/time picker */}
        <div className="pt-3 border-t border-border-primary/50 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[0.72rem] font-semibold text-text-secondary uppercase tracking-wider">
              <CalendarClock size={14} className="text-accent" />
              <span>Custom date & time</span>
            </div>
            <span className="text-[0.68rem] text-text-tertiary">
              24-hour / local
            </span>
          </div>

          {/* Touchscreen ergonomic datetime input for mobile */}
          <div className="block sm:hidden">
            <input
                      style={android ? { minHeight: 48 } : undefined}
              type="datetime-local"
              aria-label="Custom delivery date and time"
              min={`${todayStr}T00:00`}
              value={customDateTime || (customDate ? `${customDate}T${customTime}` : "")}
              onChange={(e) => handleDateTimeChange(e.target.value)}
              className="w-full min-h-[48px] h-12 text-sm bg-bg-secondary hover:bg-bg-tertiary focus:bg-bg-primary border border-border-primary/80 rounded-xl px-3 py-2.5 text-text-primary focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all touch-manipulation cursor-pointer"
            />
          </div>

          {/* Desktop/tablet split date and time picker */}
          <div className="hidden sm:grid sm:grid-cols-5 gap-2">
            <div className="col-span-3">
              <input
                      style={android ? { minHeight: 48 } : undefined}
                type="date"
                aria-label="Custom delivery date"
                min={todayStr}
                value={customDate}
                onChange={(e) => handleDateChange(e.target.value)}
                className="w-full min-h-[44px] h-10 text-xs bg-bg-secondary hover:bg-bg-tertiary focus:bg-bg-primary border border-border-primary/80 rounded-xl px-2.5 py-2 text-text-primary focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all"
              />
            </div>
            <div className="col-span-2">
              <input
                      style={android ? { minHeight: 48 } : undefined}
                type="time"
                aria-label="Custom delivery time"
                value={customTime}
                onChange={(e) => handleTimeChange(e.target.value)}
                className="w-full min-h-[44px] h-10 text-xs bg-bg-secondary hover:bg-bg-tertiary focus:bg-bg-primary border border-border-primary/80 rounded-xl px-2.5 py-2 text-text-primary focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all"
              />
            </div>
          </div>

          {/* Quick Time Pills */}
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span className="text-[0.68rem] text-text-tertiary mr-0.5 font-medium">Quick:</span>
            {[
              { label: "8:00 AM", value: "08:00" },
              { label: "1:00 PM", value: "13:00" },
              { label: "5:00 PM", value: "17:00" },
              { label: "8:00 PM", value: "20:00" },
            ].map((slot) => (
              <button
              style={android ? { minHeight: 48, minWidth: 48 } : undefined}
                key={slot.value}
                type="button"
                onClick={() => {
                  handleTimeChange(slot.value);
                  if (!customDate && !customDateTime) {
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    const yyyy = tomorrow.getFullYear();
                    const mm = String(tomorrow.getMonth() + 1).padStart(2, "0");
                    const dd = String(tomorrow.getDate()).padStart(2, "0");
                    const nextDate = `${yyyy}-${mm}-${dd}`;
                    setCustomDate(nextDate);
                    setCustomDateTime(`${nextDate}T${slot.value}`);
                  }
                }}
                className={`min-h-[40px] px-3 py-2 sm:min-h-0 sm:px-2.5 sm:py-1 rounded-lg border text-xs sm:text-[0.68rem] font-medium transition-all touch-manipulation cursor-pointer ${
                  customTime === slot.value
                    ? "bg-accent/15 border-accent text-accent font-semibold shadow-2xs"
                    : "bg-bg-secondary/60 hover:bg-bg-hover text-text-secondary border-border-primary/50"
                }`}
              >
                {slot.label}
              </button>
            ))}
          </div>

          {validationError && <p role="alert" className="text-sm text-danger">{validationError}</p>}
          <Button
            variant="primary"
            onClick={handleCustomSubmit}
            disabled={!customDate && !customDateTime}
            className="w-full mt-2 min-h-[48px] h-12 sm:h-10 text-sm sm:text-xs font-semibold rounded-xl shadow-xs hover:shadow-md active:scale-[0.99] transition-all flex items-center justify-center gap-2 touch-manipulation"
          >
            <Clock size={15} />
            <span>{recurrence !== "none" ? "Schedule Recurring Send" : "Schedule Send"}</span>
          </Button>
        </div>
      </div>
    </Modal>
  );
}
