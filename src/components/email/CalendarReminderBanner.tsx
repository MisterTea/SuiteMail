import { useState } from "react";
import { BellOff } from "lucide-react";
import { platformOpenUrl } from "@/platform";
import { GoogleCalendarProvider } from "@/services/calendar/googleCalendarProvider";
import type { GoogleReminderEvent } from "@/services/calendar/reminderDetector";
import { useAccountStore } from "@/stores/accountStore";

interface Props {
  accountId: string;
  event: GoogleReminderEvent | null;
}

export function CalendarReminderBanner({ accountId, event }: Props) {
  const account = useAccountStore((state) => state.accounts.find((item) => item.id === accountId));
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canUpdate = account?.provider === "gmail_api";

  async function turnOffReminders() {
    if (!event || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { isSeries } = await new GoogleCalendarProvider(accountId)
        .turnOffEmailReminders(event.calendarId, event.eventId);
      setSuccess(isSeries ? "Email reminders are off for this series." : "Email reminders are off for this event.");
    } catch {
      setError("Couldn’t turn off email reminders. Try again or manage them in Google Calendar.");
    } finally {
      setBusy(false);
    }
  }

  async function openCalendar() {
    if (!event) return;
    try {
      await platformOpenUrl(event.url);
    } catch {
      setError("Couldn’t open Google Calendar.");
    }
  }

  return (
    <div className="mb-3 flex items-start gap-2 rounded-lg border border-accent/30 bg-accent/5 p-3 text-sm">
      <BellOff size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-text-primary">Calendar reminder</p>
        {!event && <p className="mt-1 text-xs text-text-secondary">Open the event in Google Calendar to change its email reminders.</p>}
        {event && !canUpdate && (
          <p className="mt-1 text-xs text-text-secondary">Edit the event in Google Calendar and remove its email reminders. For a recurring event, apply the change to the series.</p>
        )}
        {event && canUpdate && !success && (
          <button type="button" disabled={busy} onClick={turnOffReminders}
            className="mt-2 inline-flex min-h-11 items-center rounded-md bg-accent px-3 text-sm font-medium text-white dark:text-black disabled:opacity-60">
            {busy ? "Turning off email reminders…" : "Turn off email reminders"}
          </button>
        )}
        {success && <p role="status" className="mt-1 text-xs text-text-secondary">{success}</p>}
        {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
        {event && (!canUpdate || error) && (
          <button type="button" onClick={openCalendar} className="inline-flex min-h-11 items-center text-xs font-medium text-accent">
            Manage email reminders in Google Calendar
          </button>
        )}
      </div>
    </div>
  );
}
