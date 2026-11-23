import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

export interface MeetingSpan { start: Date; end: Date }

export function formatMeetingSpan(span: MeetingSpan): string {
  const date = span.start.toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
  const options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", timeZoneName: "short" };
  const endDate = span.end.toDateString() === span.start.toDateString()
    ? "" : `${span.end.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}, `;
  return `${date}, ${span.start.toLocaleTimeString(undefined, options)} – ${endDate}${span.end.toLocaleTimeString(undefined, options)}`;
}

export function meetingTimesHtml(spans: MeetingSpan[]): string {
  const escape = (text: string) => text.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
  return `<p>Would any of the following times work for a meeting?</p><ul>${[...spans]
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map((span) => `<li>${escape(formatMeetingSpan(span))}</li>`).join("")}</ul><p>Please let me know which one(s) work best for you.</p><p></p>`;
}

const SLOTS = Array.from({ length: 48 }, (_, i) => i);
const SLOT_HEIGHT = 24;
function dayAt(date: Date, offset: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + offset);
  result.setHours(0, 0, 0, 0);
  return result;
}
function spanFor(day: Date, first: number, last: number): MeetingSpan {
  const start = new Date(day), end = new Date(day);
  start.setMinutes(Math.min(first, last) * 30);
  end.setMinutes((Math.max(first, last) + 1) * 30);
  return { start, end };
}

export function MeetingTimesDialog({ onAccept, onClose }: {
  onAccept: (spans: MeetingSpan[]) => void;
  onClose: () => void;
}) {
  const [week, setWeek] = useState(() => dayAt(new Date(), 0));
  const [spans, setSpans] = useState<MeetingSpan[]>([]);
  const [drag, setDrag] = useState<{ day: Date; first: number; last: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const days = Array.from({ length: 7 }, (_, i) => dayAt(week, i));
  const preview = drag ? spanFor(drag.day, drag.first, drag.last) : null;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 8 * 2 * SLOT_HEIGHT;
  }, []);

  function addSpan(span: MeetingSpan) {
    setSpans((current) => current.some((item) => +item.start === +span.start && +item.end === +span.end)
      ? current : [...current, span].sort((a, b) => +a.start - +b.start));
  }
  function slotAt(event: PointerEvent<HTMLDivElement>) {
    return Math.max(0, Math.min(47, Math.floor((event.clientY - event.currentTarget.getBoundingClientRect().top) / SLOT_HEIGHT)));
  }

  return (
    <Modal isOpen onClose={onClose} title="Suggest meeting times" zIndex="z-[80]"
      width="w-full sm:w-[900px]" panelClassName="sm:max-w-[900px]">
      <div className="p-4 space-y-3">
        <p className="text-sm text-text-secondary">Drag on a day to select a time span. Repeat to add more options, or select a half-hour slot with your keyboard.</p>
        <p className="text-xs text-text-tertiary">All times in {timeZone}. These options do not reserve calendar events.</p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button aria-label="Previous week" iconOnly onClick={() => { setWeek(dayAt(week, -7)); setDrag(null); }}><ChevronLeft size={18} /></Button>
            <Button onClick={() => { setWeek(dayAt(new Date(), 0)); setDrag(null); }}>Today</Button>
            <Button aria-label="Next week" iconOnly onClick={() => { setWeek(dayAt(week, 7)); setDrag(null); }}><ChevronRight size={18} /></Button>
          </div>
          <label className="text-xs text-text-secondary flex items-center gap-2">Go to date
            <input type="date" className="bg-bg-secondary border border-border-primary rounded p-1.5 text-text-primary"
              value={`${week.getFullYear()}-${String(week.getMonth() + 1).padStart(2, "0")}-${String(week.getDate()).padStart(2, "0")}`}
              onChange={(e) => { if (e.target.value) { setWeek(new Date(`${e.target.value}T00:00:00`)); setDrag(null); } }} />
          </label>
        </div>
        <div className="border border-border-primary rounded-lg overflow-hidden">
          <div ref={scrollRef} className="max-h-[38vh] overflow-auto overscroll-contain">
            <div className="min-w-[640px]">
              <div className="sticky top-0 z-10 grid bg-bg-primary border-b border-border-primary" style={{ gridTemplateColumns: "56px repeat(7, minmax(0, 1fr))" }}>
                <div />
                {days.map((day) => <div key={+day} className="text-xs text-center py-2 border-l border-border-secondary font-medium">
                  {day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                </div>)}
              </div>
              <div className="grid" style={{ gridTemplateColumns: "56px repeat(7, minmax(0, 1fr))" }}>
                <div aria-hidden="true">{SLOTS.map((slot) => <div key={slot} style={{ height: SLOT_HEIGHT }} className="text-[10px] text-right pr-1 text-text-tertiary">
                  {slot % 2 === 0 ? new Date(2000, 0, 1, slot / 2).toLocaleTimeString(undefined, { hour: "numeric" }) : ""}
                </div>)}</div>
                {days.map((day) => (
                  <div key={+day} data-testid="meeting-day" className="relative border-l border-border-secondary select-none" style={{ touchAction: "none" }}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      e.preventDefault();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      const slot = slotAt(e);
                      setDrag({ day, first: slot, last: slot });
                    }}
                    onPointerMove={(e) => { if (drag && e.currentTarget.hasPointerCapture(e.pointerId)) setDrag({ ...drag, last: slotAt(e) }); }}
                    onPointerUp={(e) => {
                      if (!drag || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
                      addSpan(spanFor(drag.day, drag.first, slotAt(e)));
                      setDrag(null);
                      e.currentTarget.releasePointerCapture(e.pointerId);
                    }}
                    onPointerCancel={() => setDrag(null)}
                    onLostPointerCapture={() => setDrag(null)}>
                    {SLOTS.map((slot) => <button key={slot} type="button"
                      aria-label={`Add ${formatMeetingSpan(spanFor(day, slot, slot))}`}
                      onClick={(e) => { if (e.detail === 0) addSpan(spanFor(day, slot, slot)); }}
                      style={{ height: SLOT_HEIGHT }}
                      className="block w-full border-b border-border-secondary hover:bg-accent/10 focus-visible:bg-accent/20 focus-visible:outline-2 focus-visible:outline-accent cursor-crosshair" />)}
                    {[...spans, ...(preview ? [preview] : [])].filter((span) => span.start.toDateString() === day.toDateString()).map((span, index) => (
                      <div key={`${+span.start}-${+span.end}-${index}`} className="absolute inset-x-0.5 pointer-events-none rounded bg-accent/25 border border-accent text-accent text-[10px] px-1 overflow-hidden"
                        style={{ top: (span.start.getHours() * 60 + span.start.getMinutes()) / 30 * SLOT_HEIGHT,
                          height: ((span.end.toDateString() === day.toDateString() ? span.end.getHours() * 60 + span.end.getMinutes() : 1440)
                            - span.start.getHours() * 60 - span.start.getMinutes()) / 30 * SLOT_HEIGHT }}>
                        {span.start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} – {span.end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div aria-live="polite" className="text-sm font-medium">Selected times ({spans.length})</div>
        {spans.length === 0 ? <p className="text-sm text-text-tertiary">No times selected yet.</p> : (
          <ul className="max-h-36 overflow-y-auto space-y-1">
            {spans.map((span) => <li key={`${+span.start}-${+span.end}`} className="flex items-center justify-between gap-2 rounded bg-bg-secondary px-3 py-1 text-xs">
              <span>{formatMeetingSpan(span)}</span>
              <Button iconOnly aria-label={`Remove ${formatMeetingSpan(span)}`} onClick={() => setSpans((current) => current.filter((item) => item !== span))}><Trash2 size={16} /></Button>
            </li>)}
          </ul>
        )}
        <div className="flex justify-end gap-2 border-t border-border-secondary pt-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={spans.length === 0} onClick={() => onAccept(spans)}>Insert meeting times</Button>
        </div>
      </div>
    </Modal>
  );
}
