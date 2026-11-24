import type { DbMessage } from "@/services/db/messages";

export interface GoogleReminderEvent {
  eventId: string;
  calendarId: string;
  url: string;
}

const CALENDAR_DOMAINS = new Map([
  ["m", "gmail.com"],
  ["g", "group.calendar.google.com"],
  ["v", "group.v.calendar.google.com"],
]);

export function isGoogleCalendarReminder(message: DbMessage): boolean {
  if (message.from_address?.trim().toLowerCase() !== "calendar-notification@google.com") return false;
  if (/^\s*(?:notification|reminder)\s*:/i.test(message.subject ?? "")) return true;
  return [message.snippet, message.body_text, message.body_html]
    .some((body) => /\byou have an upcoming event\b/i.test(body ?? ""));
}

function parseEventLink(href: string): GoogleReminderEvent | null {
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (url.hostname !== "calendar.google.com" && url.hostname !== "www.google.com") return null;
    const path = url.pathname.match(/^\/calendar\/(?:u\/\d+\/)?(?:r\/)?(?:event(?:\/([\w=-]+))?|eventedit\/([\w=-]+))\/?$/);
    if (!path) return null;
    const eid = path[1] ?? path[2] ?? url.searchParams.get("eid");
    if (!eid || !/^[\w-]+={0,2}$/.test(eid)) return null;

    // Google event links encode an event ID and a calendar ID in an URL-safe base64 pair.
    const decoded = atob(eid.replace(/-/g, "+").replace(/_/g, "/"));
    const identity = decoded.match(/^([\w-]+) ([^\s@]+)@([\w.-]+)$/);
    if (!identity) return null;
    const [, eventId, calendar, domain] = identity;
    if (!eventId || !calendar || !domain) return null;
    return {
      eventId,
      calendarId: `${calendar}@${CALENDAR_DOMAINS.get(domain) ?? domain}`,
      url: `https://calendar.google.com/calendar/event?eid=${encodeURIComponent(eid)}`,
    };
  } catch {
    return null;
  }
}

export function getGoogleReminderEvent(message: DbMessage): GoogleReminderEvent | null {
  const links: string[] = message.body_text?.match(/https:\/\/[^\s<>"']+/g) ?? [];
  const actionLinks: string[] = [];
  if (message.body_html) {
    const template = document.createElement("template");
    template.innerHTML = message.body_html;
    for (const link of template.content.querySelectorAll("a[href]")) {
      const href = link.getAttribute("href") ?? "";
      links.push(href);
      if (/^\s*(?:view (?:all )?event details|view on google calendar)\s*$/i.test(link.textContent ?? "")) {
        actionLinks.push(href);
      }
    }
  }

  const events = new Map<string, GoogleReminderEvent>();
  for (const href of actionLinks.length ? actionLinks : links) {
    const event = parseEventLink(href);
    if (event) events.set(`${event.calendarId} ${event.eventId}`, event);
  }
  return events.size === 1 ? events.values().next().value ?? null : null;
}
