import { useState, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TextField } from "@/components/ui/TextField";
import type { DbCalendar } from "@/services/db/calendars";
import type { EventTarget } from "@/services/calendar/eventCreation";
import type { CreateEventInput } from "@/services/calendar/types";
import { validInvitee } from "@/utils/calendarEvent";

export interface EventFormValues extends CreateEventInput {
  description: string;
  location: string;
  calendarId?: string;
}

interface EventCreateModalProps {
  calendars?: DbCalendar[];
  targets?: EventTarget[];
  initialValues?: Partial<EventFormValues>;
  notes?: string[];
  onClose: () => void;
  onCreate: (event: EventFormValues) => void | Promise<void>;
}

export function EventCreateModal({ calendars, targets, initialValues, notes, onClose, onCreate }: EventCreateModalProps) {
  const [summary, setSummary] = useState(initialValues?.summary ?? "");
  const [description, setDescription] = useState(initialValues?.description ?? "");
  const [location, setLocation] = useState(initialValues?.location ?? "");
  const [startTime, setStartTime] = useState(() => initialTime(initialValues?.startTime, 1));
  const [endTime, setEndTime] = useState(() => initialTime(initialValues?.endTime, 2));
  const [isAllDay, setIsAllDay] = useState(initialValues?.isAllDay ?? false);
  const [invitees, setInvitees] = useState(initialValues?.attendees?.map(({ email }) => email).join(", ") ?? "");
  const [calendarId, setCalendarId] = useState(initialValues?.calendarId ?? calendars?.find((c) => c.is_primary)?.id ?? calendars?.[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const selectedTarget = targets?.find((target) => target.id === calendarId);
  const emails = [...new Set(invitees.split(/[,;\n]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))]
    .filter((email) => email !== selectedTarget?.accountEmail.toLowerCase());
  const invalidInvitees = emails.some((email) => !validInvitee(email));
  const unsupported = targets !== undefined && (!selectedTarget?.canCreate || (emails.length > 0 && !selectedTarget.canInvite));
  const validTimes = Number.isFinite(Date.parse(startTime)) && Number.isFinite(Date.parse(endTime)) && Date.parse(endTime) > Date.parse(startTime);
  const canSubmit = summary.trim() && validTimes && !invalidInvitees && !unsupported;
  const close = () => { if (!submittingRef.current) onClose(); };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({ summary: summary.trim(), description, location,
        startTime: isAllDay ? startTime : new Date(startTime).toISOString(),
        endTime: isAllDay ? endTime : new Date(endTime).toISOString(), isAllDay,
        attendees: emails.map((email) => ({ email })), calendarId: calendarId || undefined });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not create the event. Try again.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={true} onClose={close} title="Create Event" width="w-full max-w-md">
      <form onSubmit={handleSubmit} className="p-4 space-y-3">
        {notes && notes.length > 0 && <div className="text-xs text-text-secondary space-y-1">{notes.map((note, index) => <p key={index}>{note}</p>)}</div>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <fieldset disabled={submitting} className="space-y-3">
          <TextField label="Title" type="text" required value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Event title" autoFocus />
          {calendars && calendars.length > 0 && (
            <div>
              <label htmlFor="event-calendar" className="text-xs text-text-secondary block mb-1">Calendar</label>
              <select id="event-calendar" value={calendarId} onChange={(e) => setCalendarId(e.target.value)}
                className="w-full px-3 py-1.5 bg-bg-tertiary border border-border-primary rounded text-sm text-text-primary outline-none focus:border-accent">
                {calendars.map((calendar) => {
                  const target = targets?.find((item) => item.id === calendar.id);
                  return <option key={calendar.id} value={calendar.id} disabled={target?.canCreate === false}>
                    {target ? `${target.accountEmail} — ` : ""}{calendar.display_name ?? "Calendar"}{calendar.is_primary ? " (Primary)" : ""}{target?.canCreate === false ? " (Read-only)" : ""}
                  </option>;
                })}
              </select>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={isAllDay} onChange={(e) => {
              const allDay = e.target.checked;
              setIsAllDay(allDay);
              setStartTime((value) => value ? allDay ? value.slice(0, 10) : `${value.slice(0, 10)}T09:00` : "");
              setEndTime((value) => value ? allDay ? value.slice(0, 10) : `${value.slice(0, 10)}T10:00` : "");
            }} />All day
          </label>
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Start" type={isAllDay ? "date" : "datetime-local"} required value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            <TextField label={isAllDay ? "End (exclusive)" : "End"} type={isAllDay ? "date" : "datetime-local"} required value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
          {!isAllDay && <p className="text-xs text-text-secondary">Times shown in {Intl.DateTimeFormat().resolvedOptions().timeZone}.</p>}
          {startTime && endTime && !validTimes && <p role="alert" className="text-xs text-danger">End must be after start.</p>}
          <TextField label="Invitees" type="text" value={invitees} onChange={(e) => setInvitees(e.target.value)} placeholder="alice@example.com, bob@example.com" error={invalidInvitees ? "Enter valid email addresses, separated by commas." : undefined} />
          {unsupported && <p role="alert" className="text-xs text-danger">{!selectedTarget?.canCreate ? "Choose a writable calendar." : "This calendar cannot send invitations. Choose another calendar."}</p>}
          <TextField label="Location" type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Add location" />
          <div>
            <label htmlFor="event-description" className="text-xs text-text-secondary block mb-1">Description</label>
            <textarea id="event-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Add description" rows={3}
              className="w-full px-3 py-1.5 bg-bg-tertiary border border-border-primary rounded text-sm text-text-primary outline-none focus:border-accent resize-none" />
          </div>
        </fieldset>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" size="md" onClick={close} disabled={submitting}>Cancel</Button>
          <Button type="submit" variant="primary" size="md" disabled={!canSubmit || submitting}>
            {submitting ? "Creating…" : emails.length ? "Create & send invitations" : "Create event"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function initialTime(value: string | undefined, hours: number): string {
  if (value !== undefined) return value ? toLocalDateTime(value) : "";
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + hours);
  return toLocalDateTime(date.toISOString());
}

export function toLocalDateTime(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
