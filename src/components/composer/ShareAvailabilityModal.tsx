import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/Modal";
import { Calendar, Clock, Check, Plus } from "lucide-react";
import type { Editor } from "@tiptap/react";
import { getCalendarEventsInRange, type DbCalendarEvent } from "@/services/db/calendarEvents";
import { useAccountStore } from "@/stores/accountStore";

interface ShareAvailabilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  editor: Editor | null;
}

interface TimeSlot {
  id: string;
  dateStr: string;
  startTimeStr: string;
  endTimeStr: string;
  startTimestamp: number;
  endTimestamp: number;
}

export function ShareAvailabilityModal({ isOpen, onClose, editor }: ShareAvailabilityModalProps) {
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [selectedSlotIds, setSelectedSlotIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !activeAccountId) return;
    setLoading(true);

    const now = new Date();
    // Start from tomorrow or today afternoon
    const startRange = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
    const endRange = new Date(startRange.getTime() + 5 * 24 * 60 * 60 * 1000); // next 5 days

    getCalendarEventsInRange(
      activeAccountId,
      Math.floor(startRange.getTime() / 1000),
      Math.floor(endRange.getTime() / 1000),
    )
      .then((events) => {
        const generated = computeAvailableSlots(startRange, events);
        setSlots(generated);
        // Pre-select first 3 slots
        setSelectedSlotIds(new Set(generated.slice(0, 3).map((s) => s.id)));
      })
      .catch((err) => {
        console.error("Failed to load calendar events for availability:", err);
      })
      .finally(() => setLoading(false));
  }, [isOpen, activeAccountId]);

  const toggleSlot = (id: string) => {
    const next = new Set(selectedSlotIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedSlotIds(next);
  };

  const handleInsert = () => {
    if (!editor || selectedSlotIds.size === 0) return;

    const chosen = slots.filter((s) => selectedSlotIds.has(s.id));
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, " ");

    const itemsHtml = chosen
      .map((s) => `<li><strong>${s.dateStr}</strong>: ${s.startTimeStr} – ${s.endTimeStr}</li>`)
      .join("");

    const blockHtml = `
      <p>I am available at any of the following times (${timeZone}):</p>
      <ul>${itemsHtml}</ul>
      <p>Please let me know if any of these work for you!</p>
    `;

    editor.chain().focus().insertContent(blockHtml).run();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Share Calendar Availability" width="w-[480px]">
      <div className="space-y-4">
        <p className="text-xs text-text-secondary leading-relaxed">
          Select open slots from your calendar to insert into your email with automatic timezone formatting.
        </p>

        {loading ? (
          <div className="py-8 text-center text-xs text-text-tertiary">
            Checking calendar availability...
          </div>
        ) : slots.length === 0 ? (
          <div className="py-6 text-center text-xs text-text-tertiary">
            No open daytime slots found over the next 5 days.
          </div>
        ) : (
          <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
            {slots.map((slot) => {
              const isSelected = selectedSlotIds.has(slot.id);
              return (
                <button
                  key={slot.id}
                  type="button"
                  onClick={() => toggleSlot(slot.id)}
                  className={`w-full text-left p-2.5 rounded-lg border text-xs flex items-center justify-between transition-colors ${
                    isSelected
                      ? "border-accent/50 bg-accent/10 text-text-primary"
                      : "border-border-primary bg-bg-secondary hover:bg-bg-hover text-text-secondary"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Calendar size={14} className={isSelected ? "text-accent" : "text-text-tertiary"} />
                    <span className="font-medium text-text-primary">{slot.dateStr}</span>
                    <span className="text-text-tertiary">·</span>
                    <Clock size={13} className="text-text-tertiary" />
                    <span>{slot.startTimeStr} – {slot.endTimeStr}</span>
                  </div>
                  <div
                    className={`w-5 h-5 rounded-md flex items-center justify-center transition-colors ${
                      isSelected ? "bg-accent text-white" : "border border-border-primary bg-bg-primary"
                    }`}
                  >
                    {isSelected && <Check size={12} />}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-border-secondary">
          <span className="text-xs text-text-tertiary">
            {selectedSlotIds.size} slot{selectedSlotIds.size !== 1 ? "s" : ""} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleInsert}
              disabled={selectedSlotIds.size === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:pointer-events-none"
            >
              <Plus size={13} />
              <span>Insert Availability</span>
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Generate 1-hour candidate slots (9am-5pm) across the next few weekdays, skipping busy event intervals.
 */
export function computeAvailableSlots(startDate: Date, busyEvents: DbCalendarEvent[]): TimeSlot[] {
  const result: TimeSlot[] = [];
  const current = new Date(startDate);

  // Scan 5 business days
  let daysChecked = 0;
  while (daysChecked < 5) {
    current.setDate(current.getDate() + 1);
    const dayOfWeek = current.getDay();
    // Skip weekends
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;
    daysChecked++;

    // Propose 10:00-11:00, 14:00-15:00, 15:30-16:30 slots
    const candidateHours = [
      { startH: 10, startM: 0, endH: 11, endM: 0 },
      { startH: 14, startM: 0, endH: 15, endM: 0 },
      { startH: 15, startM: 30, endH: 16, endM: 30 },
    ];

    for (const cand of candidateHours) {
      const slotStart = new Date(current.getFullYear(), current.getMonth(), current.getDate(), cand.startH, cand.startM);
      const slotEnd = new Date(current.getFullYear(), current.getMonth(), current.getDate(), cand.endH, cand.endM);
      const startSec = Math.floor(slotStart.getTime() / 1000);
      const endSec = Math.floor(slotEnd.getTime() / 1000);

      // Check collision with busy events
      const hasConflict = busyEvents.some((ev) => {
        if (ev.status === "cancelled") return false;
        return ev.start_time < endSec && ev.end_time > startSec;
      });

      if (!hasConflict) {
        const dateStr = slotStart.toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        });
        const startTimeStr = slotStart.toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        });
        const endTimeStr = slotEnd.toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        });

        result.push({
          id: `slot-${startSec}`,
          dateStr,
          startTimeStr,
          endTimeStr,
          startTimestamp: startSec,
          endTimestamp: endSec,
        });
      }
    }
  }

  return result;
}
