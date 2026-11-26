import { getDb } from "./connection";
import { getCurrentUnixTimestamp } from "@/utils/timestamp";

export interface DbScheduledEmail {
  id: string;
  account_id: string;
  to_addresses: string;
  from_address: string | null;
  cc_addresses: string | null;
  bcc_addresses: string | null;
  subject: string | null;
  body_html: string;
  reply_to_message_id: string | null;
  thread_id: string | null;
  scheduled_at: number;
  signature_id: string | null;
  attachment_paths: string | null;
  status: string;
  recurrence_rule: string | null;
  created_at: number;
  /** Base64url MIME built when the email was scheduled, so the native background jobs can send it without JS. */
  raw_mime?: string | null;
  /** Unix seconds when a sender claimed the row (status 'sending'). */
  claimed_at?: number | null;
}

/**
 * Scheduled times are Unix seconds. A value this large can only be milliseconds
 * written by mistake; reading it as seconds would hold the email for ~50,000
 * years, so treat it as milliseconds instead. Either reading is never early.
 */
export const MILLISECOND_TIMESTAMP_THRESHOLD = 100_000_000_000;
/** A 'sending' claim older than this belongs to a sender that was killed partway. */
export const STALE_SENDING_SECONDS = 10 * 60;

/**
 * The due/never-early rule, shared word-for-word with the native senders
 * (Android ScheduledSendRules.java, iOS BackgroundMail.swift):
 *  - due when the device clock has reached scheduled_at, and
 *  - the device clock is not earlier than the row's created_at (a clock that
 *    jumped backwards can't be trusted to say an email is due).
 */
const DUE_AT_SQL = `(CASE WHEN scheduled_at > ${MILLISECOND_TIMESTAMP_THRESHOLD} THEN scheduled_at / 1000 ELSE scheduled_at END)`;
const DUE_SQL = (nowParam: string) =>
  `${DUE_AT_SQL} <= ${nowParam} AND (created_at IS NULL OR created_at <= ${nowParam})`;

export function normalizeScheduledAt(scheduledAt: number): number {
  return scheduledAt > MILLISECOND_TIMESTAMP_THRESHOLD ? Math.floor(scheduledAt / 1000) : scheduledAt;
}

export function isScheduledEmailDue(
  email: Pick<DbScheduledEmail, "scheduled_at" | "created_at">,
  now: number = getCurrentUnixTimestamp(),
): boolean {
  if (!Number.isFinite(email.scheduled_at) || !Number.isFinite(now)) return false;
  if (email.created_at != null && now < email.created_at) return false;
  return now >= normalizeScheduledAt(email.scheduled_at);
}

export async function getPendingScheduledEmails(): Promise<DbScheduledEmail[]> {
  const db = await getDb();
  const now = getCurrentUnixTimestamp();
  return db.select<DbScheduledEmail[]>(
    `SELECT * FROM scheduled_emails WHERE status = 'pending' AND ${DUE_SQL("$1")} ORDER BY scheduled_at ASC`,
    [now],
  );
}

/**
 * Atomically claim a due row for sending (pending → sending in one conditional
 * UPDATE). Only the caller that gets `true` may send it. The native senders use
 * the same statement against the same SQLite file, so a row can't be claimed twice.
 */
export async function claimScheduledEmail(
  id: string,
  now: number = getCurrentUnixTimestamp(),
): Promise<boolean> {
  const db = await getDb();
  const result = await db.execute(
    `UPDATE scheduled_emails SET status = 'sending', claimed_at = $2 WHERE id = $1 AND status = 'pending' AND ${DUE_SQL("$2")}`,
    [id, now],
  );
  return result.rowsAffected === 1;
}

/**
 * A sender that was killed after claiming a row may or may not have reached
 * Gmail, so retrying could send the email twice. Mark those rows failed instead;
 * the user can see it and send again. Rows claimed by older app versions have no
 * claimed_at and are treated the same way.
 */
export async function failStaleScheduledSends(
  now: number = getCurrentUnixTimestamp(),
): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    "UPDATE scheduled_emails SET status = 'failed' WHERE status = 'sending' AND (claimed_at IS NULL OR claimed_at < $1)",
    [now - STALE_SENDING_SECONDS],
  );
  return result.rowsAffected;
}

export async function getScheduledEmailsMissingRawMime(): Promise<DbScheduledEmail[]> {
  const db = await getDb();
  return db.select<DbScheduledEmail[]>(
    "SELECT * FROM scheduled_emails WHERE status = 'pending' AND raw_mime IS NULL ORDER BY scheduled_at ASC",
  );
}

export async function setScheduledEmailRawMime(id: string, rawMime: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE scheduled_emails SET raw_mime = $2 WHERE id = $1 AND status = 'pending' AND raw_mime IS NULL",
    [id, rawMime],
  );
}

export async function getScheduledEmailsForAccount(
  accountId: string,
): Promise<DbScheduledEmail[]> {
  const db = await getDb();
  return db.select<DbScheduledEmail[]>(
    "SELECT * FROM scheduled_emails WHERE account_id = $1 AND status = 'pending' ORDER BY scheduled_at ASC",
    [accountId],
  );
}

export interface NewScheduledEmail {
  accountId: string;
  toAddresses: string;
  fromAddress?: string | null;
  ccAddresses: string | null;
  bccAddresses: string | null;
  subject: string | null;
  bodyHtml: string;
  replyToMessageId: string | null;
  threadId: string | null;
  scheduledAt: number;
  signatureId: string | null;
  attachmentPaths?: string | null;
  recurrenceRule?: string | null;
  rawMime?: string | null;
}

export async function insertScheduledEmail(email: NewScheduledEmail): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.execute(
    `INSERT INTO scheduled_emails (id, account_id, to_addresses, cc_addresses, bcc_addresses, subject, body_html, reply_to_message_id, thread_id, scheduled_at, signature_id, attachment_paths, recurrence_rule, from_address, raw_mime)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      id,
      email.accountId,
      email.toAddresses,
      email.ccAddresses,
      email.bccAddresses,
      email.subject,
      email.bodyHtml,
      email.replyToMessageId,
      email.threadId,
      email.scheduledAt,
      email.signatureId,
      email.attachmentPaths ?? null,
      email.recurrenceRule ?? null,
      email.fromAddress ?? null,
      email.rawMime ?? null,
    ],
  );
  return id;
}

export async function updateScheduledEmailStatus(
  id: string,
  status: "pending" | "sending" | "sent" | "failed" | "cancelled",
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE scheduled_emails SET status = $1 WHERE id = $2",
    [status, id],
  );
}

export async function deleteScheduledEmail(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM scheduled_emails WHERE id = $1", [id]);
}
