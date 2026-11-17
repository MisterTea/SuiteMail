import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Repeat } from "lucide-react";

export type RecurrenceRule = "none" | "daily" | "weekdays" | "weekly" | "monthly";

export interface ScheduleSendDialogProps {
  onSchedule: (timestamp: number, recurrenceRule?: string | null) => void;
  onClose: () => void;
}

function getSchedulePresets(): { label: string; detail: string; timestamp: number }[] {
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
      detail: tomorrowMorning.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + " 9:00 AM",
      timestamp: Math.floor(tomorrowMorning.getTime() / 1000),
    },
    {
      label: "Tomorrow afternoon",
      detail: tomorrowAfternoon.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + " 1:00 PM",
      timestamp: Math.floor(tomorrowAfternoon.getTime() / 1000),
    },
    {
      label: "Monday morning",
      detail: monday.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + " 9:00 AM",
      timestamp: Math.floor(monday.getTime() / 1000),
    },
  ];
}

export function ScheduleSendDialog({ onSchedule, onClose }: ScheduleSendDialogProps) {
  const presets = getSchedulePresets();
  const [recurrence, setRecurrence] = useState<RecurrenceRule>("none");
  const [customDate, setCustomDate] = useState("");
  const [customTime, setCustomTime] = useState("09:00");

  const handleSelect = (timestamp: number) => {
    onSchedule(timestamp, recurrence === "none" ? null : recurrence);
  };

  const handleCustomSubmit = () => {
    if (!customDate) return;
    const dt = new Date(`${customDate}T${customTime}`);
    onSchedule(Math.floor(dt.getTime() / 1000), recurrence === "none" ? null : recurrence);
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="Schedule send" zIndex="z-[60]">
      <div className="py-1 space-y-3">
        {/* Recurrence Selector */}
        <div className="flex items-center justify-between px-3 py-2 bg-bg-secondary rounded-lg border border-border-primary/50 text-xs">
          <div className="flex items-center gap-1.5 text-text-secondary font-medium">
            <Repeat size={13} className="text-accent" />
            Repeat
          </div>
          <select
            value={recurrence}
            onChange={(e) => setRecurrence(e.target.value as RecurrenceRule)}
            className="bg-bg-tertiary text-text-primary text-xs px-2 py-1 rounded border border-border-primary focus:border-accent outline-none"
          >
            <option value="none">Does not repeat</option>
            <option value="daily">Every day</option>
            <option value="weekdays">Every weekday (Mon–Fri)</option>
            <option value="weekly">Every week</option>
            <option value="monthly">Every month</option>
          </select>
        </div>

        {/* Presets */}
        <div className="divide-y divide-border-primary/30 border border-border-primary/40 rounded-lg overflow-hidden">
          {presets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => handleSelect(preset.timestamp)}
              className="w-full flex items-center justify-between px-3 py-2.5 text-xs text-text-primary hover:bg-bg-hover transition-colors text-left"
            >
              <span className="font-medium">{preset.label}</span>
              <span className="text-[0.7rem] text-text-tertiary">{preset.detail}</span>
            </button>
          ))}
        </div>

        {/* Custom date/time picker */}
        <div className="pt-2 border-t border-border-primary/50 space-y-2">
          <div className="text-[0.7rem] font-medium text-text-tertiary uppercase tracking-wider">
            Custom date & time
          </div>
          <div className="flex gap-2">
            <input
              type="date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              className="flex-1 text-xs bg-bg-tertiary border border-border-primary rounded px-2 py-1.5 text-text-primary focus:border-accent outline-none"
            />
            <input
              type="time"
              value={customTime}
              onChange={(e) => setCustomTime(e.target.value)}
              className="w-24 text-xs bg-bg-tertiary border border-border-primary rounded px-2 py-1.5 text-text-primary focus:border-accent outline-none"
            />
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={handleCustomSubmit}
            disabled={!customDate}
            className="w-full mt-1"
          >
            {recurrence !== "none" ? "Schedule Recurring Send" : "Schedule Send"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
