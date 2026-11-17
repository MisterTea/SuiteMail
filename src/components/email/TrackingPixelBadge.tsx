import { useState, useRef, useEffect } from "react";
import { ShieldCheck } from "lucide-react";
import type { DetectedTracker } from "@/utils/trackingPixels";

interface TrackingPixelBadgeProps {
  trackers: DetectedTracker[];
}

export function TrackingPixelBadge({ trackers }: TrackingPixelBadgeProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (!trackers || trackers.length === 0) return null;

  const count = trackers.length;
  const primaryProvider = trackers[0]?.provider ?? "Spy Pixel";
  const label =
    count === 1
      ? `Blocked: ${primaryProvider}`
      : `${count} Trackers Blocked`;

  return (
    <div className="relative inline-flex items-center" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/15 transition-colors"
        title="Privacy Protection: Spy pixels stripped"
      >
        <ShieldCheck size={12} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
        <span className="truncate max-w-[130px]">{label}</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-30 w-64 rounded-md border border-border-primary bg-bg-primary p-2.5 shadow-lg glass-modal text-xs">
          <div className="font-semibold text-text-primary mb-1 flex items-center gap-1.5">
            <ShieldCheck size={14} className="text-emerald-500" />
            <span>Email Tracking Blocked</span>
          </div>
          <p className="text-text-secondary text-[11px] mb-2 leading-relaxed">
            Velo prevented the sender from seeing when, where, or how many times you opened this email.
          </p>
          <div className="border-t border-border-secondary pt-1.5 space-y-1">
            {trackers.map((t, idx) => (
              <div key={idx} className="flex items-center justify-between text-[11px]">
                <span className="font-medium text-text-primary">{t.provider}</span>
                <span className="text-[10px] text-text-tertiary truncate max-w-[120px]" title={t.url}>
                  {t.url.replace(/^https?:\/\//, "")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
