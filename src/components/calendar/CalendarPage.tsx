import { useState, useEffect, useCallback, useRef } from "react";
import { useAccountStore } from "@/stores/accountStore";
import { useUIStore } from "@/stores/uiStore";
import { getCalendarEventsInRangeMulti, removeMissingEventsInRange, type DbCalendarEvent } from "@/services/db/calendarEvents";
import { getVisibleCalendars, getCalendarsForAccount, upsertCalendar, type DbCalendar } from "@/services/db/calendars";
import { getCalendarProvider, hasCalendarSupport } from "@/services/calendar/providerFactory";
import { cacheProviderEvent, createCalendarEvent, loadEventTargets } from "@/services/calendar/eventCreation";
import { CalendarToolbar } from "./CalendarToolbar";
import { MonthView } from "./MonthView";
import { WeekView } from "./WeekView";
import { DayView } from "./DayView";
import { EventCreateModal, type EventFormValues } from "./EventCreateModal";
import { EventDetailModal } from "./EventDetailModal";
import { CalendarList } from "./CalendarList";
import { CalendarReauthBanner } from "./CalendarReauthBanner";
import { useCalendarSwipe } from "@/hooks/useCalendarSwipe";

export function CalendarPage() {
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const accounts = useAccountStore((s) => s.accounts);
  const activeAccount = accounts.find((a) => a.id === activeAccountId) ?? null;
  const [currentDate, setCurrentDate] = useState(new Date());
  const view = useUIStore((s) => s.calendarView);
  const setView = useUIStore((s) => s.setCalendarView);
  const [events, setEvents] = useState<DbCalendarEvent[]>([]);
  const [calendars, setCalendars] = useState<DbCalendar[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<DbCalendarEvent | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [showCalendarList, setShowCalendarList] = useState(false);
  const [hasCalendar, setHasCalendar] = useState(true);
  const reauthDoneRef = useRef(false);

  const getRange = useCallback((): { start: Date; end: Date } => {
    const d = new Date(currentDate);
    if (view === "month") {
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      start.setDate(start.getDate() - start.getDay());
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      end.setDate(end.getDate() + (6 - end.getDay()));
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    if (view === "week" || view === "threeDay") {
      const start = new Date(d);
      if (view === "week") start.setDate(start.getDate() - start.getDay());
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + (view === "threeDay" ? 2 : 6));
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    const start = new Date(d);
    start.setHours(0, 0, 0, 0);
    const end = new Date(d);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }, [currentDate, view]);

  const loadCalendars = useCallback(async () => {
    if (!activeAccountId) return;
    try {
      const supported = await hasCalendarSupport(activeAccountId);
      setHasCalendar(supported);
      if (!supported) return;

      const cals = await getCalendarsForAccount(activeAccountId);
      setCalendars(cals);
    } catch {
      // ignore
    }
  }, [activeAccountId]);

  const loadEvents = useCallback(async () => {
    if (!activeAccountId) return;
    setLoading(true);

    const { start, end } = getRange();
    const startTs = Math.floor(start.getTime() / 1000);
    const endTs = Math.floor(end.getTime() / 1000);

    // Load from local cache first
    try {
      const visibleCals = await getVisibleCalendars(activeAccountId);
      const calendarIds = visibleCals.map((c) => c.id);
      const cached = await getCalendarEventsInRangeMulti(activeAccountId, calendarIds, startTs, endTs);
      setEvents(cached);
    } catch {
      // ignore cache errors
    }

    // Fetch from provider API
    try {
      const supported = await hasCalendarSupport(activeAccountId);
      if (!supported) {
        setLoading(false);
        return;
      }

      const provider = await getCalendarProvider(activeAccountId);

      // Discover/update calendars
      const providerCalendars = await provider.listCalendars();
      for (const cal of providerCalendars) {
        await upsertCalendar({
          accountId: activeAccountId,
          provider: provider.type,
          remoteId: cal.remoteId,
          displayName: cal.displayName,
          color: cal.color,
          isPrimary: cal.isPrimary,
        });
      }

      // Reload calendars from DB
      const allCals = await getCalendarsForAccount(activeAccountId);
      setCalendars(allCals);

      // Fetch events for visible calendars
      const visibleCals = await getVisibleCalendars(activeAccountId);
      for (const cal of visibleCals) {
        const apiEvents = await provider.fetchEvents(
          cal.remote_id,
          start.toISOString(),
          end.toISOString(),
        );

        for (const event of apiEvents) {
          await cacheProviderEvent(activeAccountId, cal.id, event);
        }
        if (provider.type === "ews") {
          await removeMissingEventsInRange(
            activeAccountId, cal.id, startTs, endTs, apiEvents.map((event) => event.remoteEventId),
          );
        }
      }

      // Reload events from DB
      const calendarIds = visibleCals.map((c) => c.id);
      const fresh = await getCalendarEventsInRangeMulti(activeAccountId, calendarIds, startTs, endTs);
      setEvents(fresh);
      setNeedsReauth(false);
      setCalendarError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const account = useAccountStore.getState().accounts.find((a) => a.id === activeAccountId);
      if (account?.provider === "gmail_api" && (message.includes("403") || message.includes("insufficient"))) {
        if (reauthDoneRef.current) {
          reauthDoneRef.current = false;
          setCalendarError(
            "Calendar access is still denied after re-authorization. " +
            "Make sure the Google Calendar API is enabled in your Google Cloud Console project. " +
            "Visit console.cloud.google.com → APIs & Services → Enable the \"Google Calendar API\".",
          );
        } else {
          setNeedsReauth(true);
        }
      } else {
        setNeedsReauth(false);
        setCalendarError(message);
        console.error("Failed to load calendar events:", err);
      }
    } finally {
      setLoading(false);
    }
  }, [activeAccountId, getRange]);

  useEffect(() => {
    loadCalendars();
    loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId, currentDate, view]);

  const handlePrev = useCallback(() => {
    setCurrentDate((d) => {
      const next = new Date(d);
      if (view === "month") next.setMonth(next.getMonth() - 1);
      else if (view === "week") next.setDate(next.getDate() - 7);
      else if (view === "threeDay") next.setDate(next.getDate() - 3);
      else next.setDate(next.getDate() - 1);
      return next;
    });
  }, [view]);

  const handleNext = useCallback(() => {
    setCurrentDate((d) => {
      const next = new Date(d);
      if (view === "month") next.setMonth(next.getMonth() + 1);
      else if (view === "week") next.setDate(next.getDate() + 7);
      else if (view === "threeDay") next.setDate(next.getDate() + 3);
      else next.setDate(next.getDate() + 1);
      return next;
    });
  }, [view]);

  const handleToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  const swipeHandlers = useCalendarSwipe(handlePrev, handleNext);

  const handleCreateEvent = useCallback(async (eventData: EventFormValues) => {
    if (!activeAccountId) return;
    const account = accounts.find((item) => item.id === activeAccountId);
    if (!account) throw new Error("Account not found");
    const { targets, errors } = await loadEventTargets([account]);
    const target = eventData.calendarId
      ? targets.find((item) => item.id === eventData.calendarId)
      : targets.find((item) => item.is_primary && item.canCreate) ?? targets.find((item) => item.canCreate);
    if (!target) throw new Error(errors[0] ?? "Choose a writable calendar first.");
    await createCalendarEvent(target, eventData);
    setShowCreate(false);
    void loadEvents();
  }, [activeAccountId, accounts, loadEvents]);

  const handleEventClick = useCallback((event: DbCalendarEvent) => {
    setSelectedEvent(event);
  }, []);

  const handleEventUpdated = useCallback(() => {
    setSelectedEvent(null);
    loadEvents();
  }, [loadEvents]);

  if (!activeAccountId) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
        Connect an account to use Calendar
      </div>
    );
  }

  if (!hasCalendar) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
        <div className="text-center">
          <p>Calendar is not configured for this account.</p>
          <p className="mt-1 text-xs">For IMAP accounts, configure CalDAV in Settings.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden bg-bg-primary">
      <CalendarToolbar
        currentDate={currentDate}
        view={view}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
        onViewChange={setView}
        onCreateEvent={() => setShowCreate(true)}
        onToggleCalendarList={() => setShowCalendarList((v) => !v)}
        showCalendarListButton={calendars.length > 1}
      />

      {needsReauth && activeAccount && (
        <CalendarReauthBanner
          accountId={activeAccount.id}
          email={activeAccount.email}
          onReauthSuccess={() => {
            reauthDoneRef.current = true;
            setNeedsReauth(false);
            setCalendarError(null);
            loadEvents();
          }}
        />
      )}

      {calendarError && !needsReauth && (
        <div className="mx-6 my-4 p-4 rounded-lg bg-danger/10 border border-danger/30 flex items-start gap-3">
          <div>
            <p className="text-sm font-medium text-text-primary">Calendar access error</p>
            <p className="text-xs text-text-secondary mt-1">{calendarError}</p>
          </div>
        </div>
      )}

      {loading && events.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
          Loading calendar...
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {showCalendarList && calendars.length > 1 && (
          <CalendarList
            calendars={calendars}
            onVisibilityChange={async (calendarId, visible) => {
              const { setCalendarVisibility } = await import("@/services/db/calendars");
              await setCalendarVisibility(calendarId, visible);
              await loadCalendars();
              loadEvents();
            }}
          />
        )}

        <div
          className="flex flex-col flex-1 min-h-0 min-w-0"
          style={{ touchAction: "pan-y pinch-zoom" }}
          {...swipeHandlers}
        >
          {view === "month" && (
            <MonthView
              currentDate={currentDate}
              events={events}
              onEventClick={handleEventClick}
            />
          )}
          {(view === "week" || view === "threeDay") && (
            <WeekView
              dayCount={view === "threeDay" ? 3 : 7}
              currentDate={currentDate}
              events={events}
              onEventClick={handleEventClick}
            />
          )}
          {view === "day" && (
            <DayView
              currentDate={currentDate}
              events={events}
              onEventClick={handleEventClick}
            />
          )}
        </div>
      </div>

      {showCreate && (
        <EventCreateModal
          calendars={calendars}
          onClose={() => setShowCreate(false)}
          onCreate={handleCreateEvent}
        />
      )}

      {selectedEvent && (
        <EventDetailModal
          event={selectedEvent}
          calendars={calendars}
          accountId={activeAccountId}
          onClose={() => setSelectedEvent(null)}
          onUpdated={handleEventUpdated}
        />
      )}
    </div>
  );
}
