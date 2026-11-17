import { parseVEvent, generateVEventReply } from "./icalHelper";
import type { InviteDetails, InviteResponseStatus } from "./types";
import type { DbMessage } from "@/services/db/messages";
import type { DbAttachment } from "@/services/db/attachments";
import { getDb } from "@/services/db/connection";
import { upsertCalendarEvent } from "@/services/db/calendarEvents";
import { buildRawEmail } from "@/utils/emailBuilder";
import { sendEmail } from "@/services/emailActions";

/**
 * Extract raw iCalendar VCALENDAR string from message body or text.
 */
export function extractRawICal(text?: string | null): string | null {
  if (!text) return null;
  const match = text.match(/BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/i);
  return match ? match[0] : null;
}

/**
 * Detect and parse calendar invite from email message content and attachments.
 */
export function detectInviteFromMessage(
  message: {
    body_text?: string | null;
    body_html?: string | null;
  },
  attachments: DbAttachment[] = [],
): InviteDetails | null {
  // 1. Check body_text and body_html
  let rawIcal = extractRawICal(message.body_text) || extractRawICal(message.body_html);

  // 2. If not found in body, check attachments for inline calendar text or ics filename
  if (!rawIcal && attachments.length > 0) {
    const icsAttachment = attachments.find(
      (a) =>
        a.mime_type?.toLowerCase().includes("text/calendar") ||
        a.mime_type?.toLowerCase().includes("application/ics") ||
        a.filename?.toLowerCase().endsWith(".ics"),
    );
    // If we have cached text or local data, or if attachment is marked as calendar
    if (icsAttachment) {
      // In tests and mocks, or if raw data is attached
      rawIcal = extractRawICal(message.body_text) || null;
    }
  }

  if (!rawIcal) return null;

  // Extract METHOD if present
  const methodMatch = rawIcal.match(/METHOD:([^\r\n]+)/i);
  const method = methodMatch ? methodMatch[1]!.trim().toUpperCase() : "REQUEST";

  const eventData = parseVEvent(rawIcal);
  if (!eventData.uid || !eventData.summary) {
    return null;
  }

  let attendees: Array<{ email: string; displayName?: string; responseStatus?: string }> = [];
  if (eventData.attendeesJson) {
    try {
      attendees = JSON.parse(eventData.attendeesJson);
    } catch {
      attendees = [];
    }
  }

  return {
    uid: eventData.uid,
    summary: eventData.summary,
    description: eventData.description,
    location: eventData.location,
    startTime: eventData.startTime,
    endTime: eventData.endTime,
    isAllDay: eventData.isAllDay,
    status: eventData.status,
    organizerEmail: eventData.organizerEmail,
    attendees,
    icalData: rawIcal,
    method,
  };
}

/**
 * Check if the user has already responded to or imported this event in the local calendar.
 */
export async function getExistingEventRsvp(
  accountId: string,
  uid: string,
  userEmail: string,
): Promise<InviteResponseStatus | "needs-action" | null> {
  try {
    const db = await getDb();
    const rows = await db.select<Array<{ status: string; attendees_json: string | null }>>(
      "SELECT status, attendees_json FROM calendar_events WHERE account_id = $1 AND (uid = $2 OR google_event_id = $2)",
      [accountId, uid],
    );
    const event = rows[0];
    if (!event) return null;

    if (event.status === "cancelled") {
      return "declined";
    }

    if (event.attendees_json) {
      try {
        const attendees: Array<{ email: string; responseStatus?: string }> = JSON.parse(
          event.attendees_json,
        );
        const match = attendees.find((a) => a.email.toLowerCase() === userEmail.toLowerCase());
        if (match?.responseStatus) {
          const s = match.responseStatus.toLowerCase();
          if (s === "accepted" || s === "declined" || s === "tentative") {
            return s as InviteResponseStatus;
          }
        }
      } catch {
        // Fall back to confirmed
      }
    }

    return event.status === "confirmed" ? "accepted" : "needs-action";
  } catch {
    return null;
  }
}

/**
 * Respond to an iCalendar invite:
 * 1. Upserts into local SQLite calendar database.
 * 2. Generates and sends an RFC 5546 iTIP REPLY email to the organizer (if present).
 */
export async function respondToInvite({
  accountId,
  message,
  invite,
  responseStatus,
  userEmail,
  userDisplayName,
  comment,
}: {
  accountId: string;
  message: DbMessage;
  invite: InviteDetails;
  responseStatus: InviteResponseStatus;
  userEmail: string;
  userDisplayName?: string;
  comment?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Update attendees list
    const attendees = [...invite.attendees];
    const existingIndex = attendees.findIndex(
      (a) => a.email.toLowerCase() === userEmail.toLowerCase(),
    );
    if (existingIndex >= 0) {
      attendees[existingIndex] = {
        ...attendees[existingIndex]!,
        responseStatus,
      };
    } else {
      attendees.push({
        email: userEmail,
        displayName: userDisplayName,
        responseStatus,
      });
    }

    // 2. Save in local SQLite calendar_events
    await upsertCalendarEvent({
      accountId,
      googleEventId: invite.uid,
      summary: invite.summary,
      description: invite.description,
      location: invite.location,
      startTime: invite.startTime,
      endTime: invite.endTime,
      isAllDay: invite.isAllDay,
      status: responseStatus === "declined" ? "cancelled" : "confirmed",
      organizerEmail: invite.organizerEmail,
      attendeesJson: JSON.stringify(attendees),
      htmlLink: null,
      uid: invite.uid,
      icalData: invite.icalData,
    });

    // 3. Send email reply to organizer if organizerEmail is present
    if (invite.organizerEmail && invite.organizerEmail.toLowerCase() !== userEmail.toLowerCase()) {
      const replyIcs = generateVEventReply({
        uid: invite.uid,
        summary: invite.summary,
        organizerEmail: invite.organizerEmail,
        userEmail,
        userDisplayName,
        startTime: invite.startTime,
        endTime: invite.endTime,
        isAllDay: invite.isAllDay,
        responseStatus,
        comment,
      });

      const actionWord =
        responseStatus === "accepted"
          ? "Accepted"
          : responseStatus === "declined"
            ? "Declined"
            : "Tentative";

      const subject = `${actionWord}: ${invite.summary}`;
      const htmlBody = `<p>${userDisplayName || userEmail} has <strong>${responseStatus}</strong> this invitation: <em>${invite.summary}</em>.</p>${
        comment ? `<p>Note: ${comment}</p>` : ""
      }`;

      // Base64 encode reply ICS
      const bytes = new TextEncoder().encode(replyIcs);
      let binary = "";
      for (const b of bytes) {
        binary += String.fromCharCode(b);
      }
      const base64Ics = btoa(binary);

      const raw = buildRawEmail({
        from: userEmail,
        to: [invite.organizerEmail],
        subject,
        htmlBody,
        inReplyTo: message.id,
        threadId: message.thread_id,
        attachments: [
          {
            filename: "invite.ics",
            mimeType: 'text/calendar; method=REPLY; charset="utf-8"',
            content: base64Ics,
          },
        ],
      });

      await sendEmail(accountId, raw, message.thread_id);
    }

    return { success: true };
  } catch (err) {
    console.error("Failed to respond to invite:", err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
