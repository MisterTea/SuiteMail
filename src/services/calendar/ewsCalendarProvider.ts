import { platformInvoke } from "@/platform";
import { getAccount } from "@/services/db/accounts";
import { ensureFreshToken } from "@/services/oauth/oauthTokenManager";
import type {
  CalendarProvider, CalendarInfo, CalendarEventData, CalendarSyncResult,
  CreateEventInput, UpdateEventInput,
} from "./types";

export class EwsCalendarProvider implements CalendarProvider {
  readonly type = "ews" as const;

  constructor(readonly accountId: string) {}

  private async call<T>(operation: string, args: Record<string, unknown> = {}): Promise<T> {
    const account = await getAccount(this.accountId);
    if (!account) throw new Error("Account not found");
    const token = await ensureFreshToken(account);
    try {
      return await platformInvoke<T>("ews_calendar", {
        ...args, operation, token, anchor: account.email,
      });
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  async listCalendars(): Promise<CalendarInfo[]> {
    const calendars = await this.call<CalendarInfo[]>("list");
    return calendars.map((calendar) => ({ ...calendar,
      canCreate: calendar.canCreate ?? calendar.isPrimary,
      canInvite: calendar.canCreate ?? calendar.isPrimary }));
  }

  async fetchEvents(calendarId: string, start: string, end: string): Promise<CalendarEventData[]> {
    try {
      return await this.call("fetch", { calendarId, start, end });
    } catch (err) {
      // CalendarView has no offset pagination. Split dense ranges to avoid losing occurrences.
      const min = Date.parse(start);
      const max = Date.parse(end);
      if (!(err instanceof Error) || !err.message.includes("EWS_CALENDAR_RANGE_FULL") || max - min <= 1000) throw err;
      const middle = new Date(Math.floor((min + max) / 2)).toISOString();
      const first = await this.fetchEvents(calendarId, start, middle);
      const second = await this.fetchEvents(calendarId, middle, end);
      return [...new Map([...first, ...second].map((event) => [event.remoteEventId, event])).values()];
    }
  }

  createEvent(calendarId: string, event: CreateEventInput): Promise<CalendarEventData> {
    if (event.isAllDay) {
      // EWS requires DateTime values even for whole-day events.
      event = { ...event, startTime: `${event.startTime.slice(0, 10)}T00:00:00Z`, endTime: `${event.endTime.slice(0, 10)}T00:00:00Z` };
    }
    return this.call("create", { calendarId, event });
  }

  updateEvent(calendarId: string, eventId: string, event: UpdateEventInput, etag?: string): Promise<CalendarEventData> {
    return this.call("update", { calendarId, eventId, event, etag });
  }

  deleteEvent(calendarId: string, eventId: string, etag?: string): Promise<void> {
    return this.call("delete", { calendarId, eventId, etag });
  }

  async syncEvents(calendarId: string): Promise<CalendarSyncResult> {
    // Match the CalDAV provider's bounded full refresh; the UI fetches its visible range.
    const start = new Date();
    start.setDate(start.getDate() - 90);
    const end = new Date();
    end.setFullYear(end.getFullYear() + 1);
    return {
      created: await this.fetchEvents(calendarId, start.toISOString(), end.toISOString()),
      updated: [], deletedRemoteIds: [], newSyncToken: null, newCtag: null,
    };
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const calendars = await this.listCalendars();
      return { success: true, message: `Connected to ${calendars.length} Exchange calendar(s).` };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
}
