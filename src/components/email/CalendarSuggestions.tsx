import { useEffect, useRef, useState } from "react";
import { CalendarPlus, Check } from "lucide-react";
import { getCalendarSuggestions, type CalendarSuggestion } from "@/services/ai/calendarSuggestions";
import { createCalendarEvent, getCreatedSuggestion, loadEventTargets, type CreatedSuggestion, type EventSource, type EventTarget } from "@/services/calendar/eventCreation";
import type { DbMessage } from "@/services/db/messages";
import { useAccountStore } from "@/stores/accountStore";
import { EventCreateModal, type EventFormValues } from "@/components/calendar/EventCreateModal";
import { EventDetailModal } from "@/components/calendar/EventDetailModal";
import { Modal } from "@/components/ui/Modal";
import { getEventByRemoteId, type DbCalendarEvent } from "@/services/db/calendarEvents";
import { getCalendarsForAccount, type DbCalendar } from "@/services/db/calendars";
import { navigateToSettings } from "@/router/navigate";

interface Props { message: DbMessage; context?: DbMessage[] }
const EMPTY_CONTEXT: DbMessage[] = [];

export function CalendarSuggestions({ message, context = EMPTY_CONTEXT }: Props) {
  const accounts = useAccountStore((state) => state.accounts);
  const userEmail = accounts.find((account) => account.id === message.account_id)?.email ?? "";
  const [suggestions, setSuggestions] = useState<CalendarSuggestion[]>([]);
  const [created, setCreated] = useState<Record<string, CreatedSuggestion>>({});
  const [review, setReview] = useState<CalendarSuggestion | null>(null);
  const [targets, setTargets] = useState<EventTarget[] | null>(null);
  const [targetErrors, setTargetErrors] = useState<string[]>([]);
  const [detail, setDetail] = useState<{ event: DbCalendarEvent; calendars: DbCalendar[]; accountId: string } | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const generation = useRef(0);
  const contextKey = JSON.stringify(context.filter((item) => item.id !== message.id && item.date <= message.date).slice(-6)
    .map((item) => [item.id, item.date, item.subject, item.from_address, item.to_addresses, item.cc_addresses, item.body_text, item.body_html, item.snippet]));
  const source = (suggestion: CalendarSuggestion): EventSource => ({ accountId: message.account_id, threadId: message.thread_id, messageId: message.id, suggestionId: suggestion.id });

  useEffect(() => {
    let cancelled = false;
    setSuggestions([]);
    setCreated({});
    setReview(null);
    setDetail(null);
    getCalendarSuggestions(message, context, userEmail).then(async (items) => {
      const receipts = await Promise.all(items.map(async (item) => [item.id, await getCreatedSuggestion({ accountId: message.account_id, threadId: message.thread_id, messageId: message.id, suggestionId: item.id })] as const));
      if (!cancelled) {
        setSuggestions(items);
        setCreated(Object.fromEntries(receipts.filter((entry): entry is readonly [string, CreatedSuggestion] => entry[1] !== null)));
      }
    }).catch((error) => console.warn("Calendar suggestion analysis unavailable", error));
    return () => { cancelled = true; generation.current++; };
  }, [message.id, message.account_id, message.thread_id, message.date, message.subject, message.from_address, message.to_addresses,
    message.cc_addresses, message.body_text, message.body_html, message.snippet, contextKey, userEmail]);

  const loadTargets = async () => {
    const current = ++generation.current;
    setTargets(null);
    const result = await loadEventTargets(accounts.filter((account) => account.isActive));
    if (current !== generation.current) return;
    result.targets.sort((a, b) => Number(b.account_id === message.account_id) - Number(a.account_id === message.account_id) || b.is_primary - a.is_primary);
    setTargets(result.targets);
    setTargetErrors(result.errors);
  };

  const openReview = (suggestion: CalendarSuggestion) => {
    setReview(suggestion);
    setTargetErrors([]);
    void loadTargets();
  };

  const create = async (values: EventFormValues) => {
    if (!review) return;
    const target = targets?.find((item) => item.id === values.calendarId);
    if (!target) throw new Error("Choose a calendar first.");
    const receipt = await createCalendarEvent(target, values, source(review));
    setCreated((previous) => ({ ...previous, [review.id]: receipt }));
    setReview(null);
  };

  const view = async (receipt: CreatedSuggestion) => {
    setViewError(null);
    try {
      const [cached, calendars] = await Promise.all([getEventByRemoteId(receipt.calendarId, receipt.event.remoteEventId), getCalendarsForAccount(receipt.accountId)]);
      const event: DbCalendarEvent = cached ?? { id: receipt.event.remoteEventId, account_id: receipt.accountId,
        google_event_id: receipt.event.remoteEventId, remote_event_id: receipt.event.remoteEventId,
        calendar_id: receipt.calendarId, summary: receipt.event.summary, description: receipt.event.description,
        location: receipt.event.location, start_time: receipt.event.startTime, end_time: receipt.event.endTime,
        is_all_day: receipt.event.isAllDay ? 1 : 0, status: receipt.event.status,
        organizer_email: receipt.event.organizerEmail, attendees_json: receipt.event.attendeesJson,
        html_link: receipt.event.htmlLink, etag: receipt.event.etag, ical_data: receipt.event.icalData, uid: receipt.event.uid, updated_at: 0 };
      setDetail({ event, calendars, accountId: receipt.accountId });
    } catch { setViewError("Could not open this event. Open Calendar to view it."); }
  };

  if (!suggestions.length) return null;
  const defaultTarget = targets?.find((target) => target.canCreate && (!review?.attendees.length || target.canInvite));
  return <div className="mb-2 space-y-1.5" aria-label="Suggested calendar events">
    <div className={`grid gap-2 ${suggestions.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
      {suggestions.map((suggestion) => <div key={suggestion.id} className="flex min-w-0 flex-col justify-between rounded-lg border border-accent/30 bg-accent/5 p-2.5 text-sm">
        <div className="flex min-w-0 items-start gap-1.5"><CalendarPlus size={15} className="mt-0.5 shrink-0 text-accent" /><div className="min-w-0 flex-1">
          <p className="text-xs sm:text-sm font-medium leading-snug text-text-primary break-words">{suggestion.title}</p>
          <p className="mt-0.5 text-[11px] sm:text-xs leading-snug text-text-secondary break-words">{suggestion.startTime ? suggestion.isAllDay ? `${suggestion.startTime} · All day` : new Date(suggestion.startTime).toLocaleString() : "Date and time need review"}</p>
          {suggestion.attendees.length > 0 && <p className="mt-0.5 text-[11px] sm:text-xs leading-snug text-text-secondary break-words">Invitees: {suggestion.attendees.join(", ")}</p>}
        </div></div>
        <button className={`mt-2 inline-flex min-h-8 items-center justify-center gap-1 rounded bg-accent px-2.5 py-1 text-xs font-medium text-white ${suggestions.length > 1 ? "w-full sm:w-auto sm:self-start" : "self-start"}`}
          onClick={() => created[suggestion.id] ? void view(created[suggestion.id]!) : openReview(suggestion)}>
          {created[suggestion.id] && <Check size={13} />}{created[suggestion.id] ? "View event" : "Add to calendar"}
        </button>
      </div>)}
    </div>
    {viewError && <p role="alert" className="text-xs text-danger">{viewError}</p>}
    {review && (targets && targets.some((target) => target.canCreate) ? <EventCreateModal
      key={review.id} calendars={targets} targets={targets}
      initialValues={{ summary: review.title, startTime: review.startTime ?? "", endTime: review.endTime ?? "", isAllDay: review.isAllDay,
        description: `${review.description}\n\nFrom email: ${message.subject ?? "(No subject)"}\n${review.evidence}`.trim(), location: review.location,
        attendees: review.attendees.map((email) => ({ email })), calendarId: defaultTarget?.id ?? targets.find((target) => target.canCreate)?.id }}
      notes={[...review.missingDetails, `Source timezone: ${review.timeZone}. Review all details before creating.`, ...targetErrors]}
      onClose={() => { generation.current++; setReview(null); }} onCreate={create}
    /> : <Modal isOpen onClose={() => { generation.current++; setReview(null); }} title="Add to calendar" width="w-full max-w-md">
      <div className="p-4 space-y-3 text-sm text-text-secondary">
        <p>{targets === null ? "Loading your calendars…" : "No writable calendars are available. Connect or configure a calendar in Settings."}</p>
        {targetErrors.map((error, index) => <p key={index} role="alert">{error}</p>)}
        {targets !== null && <><button className="text-accent" onClick={() => { setReview(null); navigateToSettings("accounts"); }}>Open calendar settings</button>
          <button className="ml-3 text-accent" onClick={() => void loadTargets()}>Retry</button></>}
      </div>
    </Modal>)}
    {detail && <EventDetailModal {...detail} onClose={() => setDetail(null)} onUpdated={() => setDetail(null)} />}
  </div>;
}
