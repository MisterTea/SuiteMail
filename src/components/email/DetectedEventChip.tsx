import { useState } from "react";
import { Calendar, Plus, Check } from "lucide-react";
import type { DetectedDateTime } from "@/utils/dateTimeDetector";
import { upsertCalendarEvent } from "@/services/db/calendarEvents";
import { navigateToLabel } from "@/router/navigate";

interface DetectedEventChipProps {
  detected: DetectedDateTime;
  accountId: string;
  defaultTitle?: string;
}

export function DetectedEventChip({ detected, accountId, defaultTitle }: DetectedEventChipProps) {
  const [added, setAdded] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleAdd = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (added || submitting) {
      navigateToLabel("calendar");
      return;
    }

    setSubmitting(true);
    try {
      const startSec = Math.floor(detected.startDate.getTime() / 1000);
      const endSec = Math.floor(detected.endDate.getTime() / 1000);

      await upsertCalendarEvent({
        accountId,
        googleEventId: crypto.randomUUID(),
        summary: defaultTitle ?? "Meeting",
        description: `Created from email mention: "${detected.rawMatch}"`,
        location: null,
        startTime: startSec,
        endTime: endSec,
        isAllDay: false,
        status: "confirmed",
        organizerEmail: null,
        attendeesJson: null,
        htmlLink: null,
      });

      setAdded(true);
    } catch (err) {
      console.error("Failed to add detected event:", err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mb-2.5 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-accent/30 bg-accent/5 dark:bg-accent/10 text-xs">
      <Calendar size={13} className="text-accent shrink-0" />
      <span className="font-medium text-text-primary">
        {detected.formattedDisplay}
      </span>
      <button
        onClick={handleAdd}
        disabled={submitting}
        className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
          added
            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
            : "bg-accent text-white hover:bg-accent-hover shadow-xs"
        }`}
      >
        {added ? (
          <>
            <Check size={11} />
            <span>Added</span>
          </>
        ) : (
          <>
            <Plus size={11} />
            <span>Add to Calendar</span>
          </>
        )}
      </button>
    </div>
  );
}
