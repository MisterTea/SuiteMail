import { useState, useEffect, type ComponentType } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Clock, Calendar, type LucideIcon } from "lucide-react";

export interface Preset {
  label: string;
  /** Unix timestamp in seconds */
  timestamp: number;
  /** Optional custom detail string; if omitted, a default date format is used */
  detail?: string;
  /** Optional icon component */
  icon?: LucideIcon | ComponentType<{ size?: number; className?: string }>;
  /** Optional keyboard shortcut hint (e.g. "1", "2") */
  shortcut?: string;
}

export interface DateTimePickerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  presets: Preset[];
  /** Called with a Unix timestamp in seconds */
  onSelect: (timestamp: number) => void;
  submitLabel: string;
  zIndex?: string;
  width?: string;
  headerIcon?: LucideIcon | ComponentType<{ size?: number; className?: string }>;
}

export function DateTimePickerDialog({
  isOpen,
  onClose,
  title,
  presets,
  onSelect,
  submitLabel,
  zIndex,
  width = "w-full sm:w-80",
  headerIcon: HeaderIcon = Clock,
}: DateTimePickerDialogProps) {
  const [customDate, setCustomDate] = useState("");
  const [customTime, setCustomTime] = useState("09:00");

  const handlePresetClick = (timestamp: number) => {
    onSelect(timestamp);
  };

  const handleCustomSubmit = () => {
    if (!customDate) return;
    const dt = new Date(`${customDate}T${customTime}`);
    onSelect(Math.floor(dt.getTime() / 1000));
  };

  // Keyboard shortcut listener (1-9 for presets when not in inputs)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === "input" || activeTag === "textarea") return;

      const num = parseInt(e.key, 10);
      if (!isNaN(num) && num >= 1 && num <= presets.length) {
        const target = presets[num - 1];
        if (target) {
          e.preventDefault();
          onSelect(target.timestamp);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, presets, onSelect]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      zIndex={zIndex}
      width={width}
      renderHeader={
        <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-accent/15 text-accent flex items-center justify-center">
              {HeaderIcon ? <HeaderIcon size={14} /> : <Clock size={14} />}
            </div>
            <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
      }
    >
      <div className="p-2 space-y-1">
        {presets.map((preset) => {
          const PresetIcon = preset.icon ?? Clock;
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() => handlePresetClick(preset.timestamp)}
              className="w-full text-left px-3 py-3 sm:py-2.5 rounded-lg border border-transparent hover:border-border-primary/50 hover:bg-bg-hover active:scale-[0.99] transition-all flex items-center gap-3 group"
            >
              <div className="w-8 h-8 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0 group-hover:bg-accent group-hover:text-white transition-colors">
                <PresetIcon size={15} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-text-primary group-hover:text-accent transition-colors">
                  {preset.label}
                </div>
                <div className="text-xs text-text-tertiary">
                  {preset.detail ??
                    new Date(preset.timestamp * 1000).toLocaleDateString(
                      undefined,
                      { weekday: "short", month: "short", day: "numeric" },
                    )}
                </div>
              </div>
              {preset.shortcut && (
                <kbd className="hidden sm:inline-flex items-center justify-center text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-secondary border border-border-primary/60 text-text-tertiary">
                  {preset.shortcut}
                </kbd>
              )}
            </button>
          );
        })}
      </div>

      <div className="border-t border-border-secondary p-3 space-y-2.5">
        <div className="flex items-center gap-1.5 text-xs text-text-tertiary font-medium">
          <Calendar size={13} className="text-accent" />
          <span>Pick date & time</span>
        </div>
        <div className="flex gap-2">
          <input
            type="date"
            value={customDate}
            onChange={(e) => setCustomDate(e.target.value)}
            className="flex-1 bg-bg-secondary text-text-primary text-base sm:text-xs px-2.5 py-2 sm:py-1.5 rounded-lg border border-border-primary focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all"
          />
          <input
            type="time"
            value={customTime}
            onChange={(e) => setCustomTime(e.target.value)}
            className="w-28 sm:w-24 bg-bg-secondary text-text-primary text-base sm:text-xs px-2.5 py-2 sm:py-1.5 rounded-lg border border-border-primary focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all"
          />
        </div>
        <Button
          variant="primary"
          onClick={handleCustomSubmit}
          disabled={!customDate}
          className="w-full rounded-lg"
        >
          {submitLabel}
        </Button>
      </div>
    </Modal>
  );
}
