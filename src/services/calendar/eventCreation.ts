import { getCalendarProvider, hasCalendarSupport } from "./providerFactory";
import { upsertCalendar, type DbCalendar } from "@/services/db/calendars";
import { upsertCalendarEvent } from "@/services/db/calendarEvents";
import { getAiCache, setAiCache } from "@/services/db/aiCache";
import { validInvitee } from "@/utils/calendarEvent";
import type { CalendarEventData, CreateEventInput } from "./types";

export interface EventTarget extends DbCalendar {
  accountEmail: string;
  canCreate: boolean;
  canInvite: boolean;
}

export interface EventSource { accountId: string; threadId: string; messageId: string; suggestionId: string }
export interface CreatedSuggestion { accountId: string; calendarId: string; event: CalendarEventData }
const receipts = new Map<string, CreatedSuggestion>();
const creating = new Map<string, Promise<CreatedSuggestion>>();
const sourceKey = (source: EventSource) => `${source.accountId}:${source.threadId}:${source.messageId}:${source.suggestionId}`;
const receiptType = (source: EventSource) => `calendar_created:${source.messageId}:${source.suggestionId}`;

export async function getCreatedSuggestion(source: EventSource): Promise<CreatedSuggestion | null> {
  const key = sourceKey(source);
  if (receipts.has(key)) return receipts.get(key)!;
  let raw: string | null = null;
  try { raw = localStorage.getItem(`calendar-created:${key}`); } catch { /* Storage may be unavailable. */ }
  raw ??= await getAiCache(source.accountId, source.threadId, receiptType(source)).catch(() => null);
  if (!raw) return null;
  try {
    const receipt = JSON.parse(raw) as CreatedSuggestion;
    if (!receipt.accountId || !receipt.calendarId || !receipt.event?.remoteEventId) return null;
    receipts.set(key, receipt);
    return receipt;
  } catch { return null; }
}

export async function loadEventTargets(accounts: { id: string; email: string }[]): Promise<{ targets: EventTarget[]; errors: string[] }> {
  const errors: string[] = [];
  const groups = await Promise.all(accounts.map(async (account) => {
    try {
      if (!await hasCalendarSupport(account.id)) return [];
      const provider = await getCalendarProvider(account.id);
      const calendars = await provider.listCalendars();
      return await Promise.all(calendars.map(async (calendar): Promise<EventTarget> => {
        const id = await upsertCalendar({ accountId: account.id, provider: provider.type, ...calendar });
        return { id, account_id: account.id, accountEmail: account.email, provider: provider.type,
          remote_id: calendar.remoteId, display_name: calendar.displayName, color: calendar.color,
          is_primary: calendar.isPrimary ? 1 : 0, is_visible: 1, sync_token: null, ctag: null, created_at: 0, updated_at: 0,
          canCreate: calendar.canCreate === true, canInvite: calendar.canInvite === true };
      }));
    } catch (error) {
      errors.push(`${account.email}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }));
  return { targets: groups.flat(), errors };
}

export async function cacheProviderEvent(accountId: string, calendarId: string | null, event: CalendarEventData): Promise<void> {
  await upsertCalendarEvent({ accountId, calendarId, googleEventId: event.remoteEventId,
    remoteEventId: event.remoteEventId, summary: event.summary, description: event.description,
    location: event.location, startTime: event.startTime, endTime: event.endTime,
    isAllDay: event.isAllDay, status: event.status, organizerEmail: event.organizerEmail,
    attendeesJson: event.attendeesJson, htmlLink: event.htmlLink, etag: event.etag, icalData: event.icalData, uid: event.uid });
}

/** Once the provider returns success, cache failures must never trigger a second creation. */
export async function createCalendarEvent(target: Pick<EventTarget, "account_id" | "id" | "remote_id" | "accountEmail" | "canCreate" | "canInvite">,
  input: CreateEventInput, source?: EventSource): Promise<CreatedSuggestion> {
  const key = source ? sourceKey(source) : null;
  if (key && creating.has(key)) return creating.get(key)!;
  const operation = (async () => {
    if (source) {
      const previous = await getCreatedSuggestion(source);
      if (previous) return previous;
    }
    if (!target.canCreate) throw new Error("This calendar is read-only. Choose another calendar.");
    const attendees = [...new Set((input.attendees ?? []).map(({ email }) => email.trim().toLowerCase()))]
      .filter((email) => email !== target.accountEmail.toLowerCase());
    if (attendees.some((email) => !validInvitee(email))) throw new Error("Enter valid invitee email addresses.");
    if (attendees.length && !target.canInvite) throw new Error("This calendar cannot send invitations. Choose another calendar.");
    if (!input.summary.trim() || !Number.isFinite(Date.parse(input.startTime)) || !Number.isFinite(Date.parse(input.endTime)) || Date.parse(input.endTime) <= Date.parse(input.startTime)) {
      throw new Error("Enter a title and an end time after the start time.");
    }
    const provider = await getCalendarProvider(target.account_id);
    const event = await provider.createEvent(target.remote_id, { ...input, attendees: attendees.map((email) => ({ email })), organizerEmail: target.accountEmail });
    const receipt = { accountId: target.account_id, calendarId: target.id, event };
    if (source && key) {
      receipts.set(key, receipt);
      // Write a receipt before the event cache. localStorage also protects a retry
      // after reload if SQLite becomes temporarily unavailable after remote success.
      try { localStorage.setItem(`calendar-created:${key}`, JSON.stringify(receipt)); } catch { /* SQLite receipt below is the primary store. */ }
      await setAiCache(source.accountId, source.threadId, receiptType(source), JSON.stringify(receipt))
        .catch((error) => console.warn("Could not cache calendar creation receipt", error));
    }
    await cacheProviderEvent(target.account_id, target.id, event)
      .catch((error) => console.warn("Event created; local cache will refresh on calendar sync", error));
    return receipt;
  })();
  if (key) creating.set(key, operation);
  try { return await operation; } finally { if (key) creating.delete(key); }
}
