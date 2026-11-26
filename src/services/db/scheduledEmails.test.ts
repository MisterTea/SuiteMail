import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "./connection";
import {
  claimScheduledEmail,
  failStaleScheduledSends,
  getPendingScheduledEmails,
  isScheduledEmailDue,
  STALE_SENDING_SECONDS,
} from "./scheduledEmails";

vi.mock("./connection", () => ({ getDb: vi.fn() }));

const NOW = 1_800_000_000;
let sqlite: DatabaseSync;

function insert(id: string, scheduledAt: number, extra: Partial<Record<"status" | "created_at" | "claimed_at", unknown>> = {}) {
  sqlite.prepare(`INSERT INTO scheduled_emails (id, account_id, to_addresses, body_html, scheduled_at, status, created_at, claimed_at)
    VALUES (?, 'acc', 'to@example.com', '<p>x</p>', ?, ?, ?, ?)`).run(
    id, scheduledAt, (extra.status as string) ?? "pending", (extra.created_at as number) ?? NOW - 3600, (extra.claimed_at as number) ?? null,
  );
}
const status = (id: string) => sqlite.prepare("SELECT status FROM scheduled_emails WHERE id = ?").get(id)?.status;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW * 1000);
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE scheduled_emails (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL, to_addresses TEXT NOT NULL, cc_addresses TEXT, bcc_addresses TEXT,
    subject TEXT, body_html TEXT NOT NULL, reply_to_message_id TEXT, thread_id TEXT, scheduled_at INTEGER NOT NULL,
    signature_id TEXT, attachment_paths TEXT, status TEXT DEFAULT 'pending', created_at INTEGER DEFAULT (unixepoch()),
    recurrence_rule TEXT, from_address TEXT, raw_mime TEXT, claimed_at INTEGER)`);
  const bind = (values: unknown[]) => Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]));
  vi.mocked(getDb).mockResolvedValue({
    execute: async (sql: string, values: unknown[] = []) => {
      const result = sqlite.prepare(sql).run(bind(values) as never);
      return { rowsAffected: Number(result.changes), lastInsertId: 0 };
    },
    select: async (sql: string, values: unknown[] = []) => sqlite.prepare(sql).all(bind(values) as never),
  } as unknown as Awaited<ReturnType<typeof getDb>>);
});
afterEach(() => {
  sqlite.close();
  vi.useRealTimers();
});

describe("isScheduledEmailDue (never early)", () => {
  it("is not due one second before the scheduled time and is due at it", () => {
    expect(isScheduledEmailDue({ scheduled_at: NOW + 1, created_at: NOW - 60 }, NOW)).toBe(false);
    expect(isScheduledEmailDue({ scheduled_at: NOW, created_at: NOW - 60 }, NOW)).toBe(true);
  });

  it("reads a millisecond timestamp as milliseconds instead of sending it early or never", () => {
    expect(isScheduledEmailDue({ scheduled_at: (NOW + 60) * 1000, created_at: NOW - 60 }, NOW)).toBe(false);
    expect(isScheduledEmailDue({ scheduled_at: (NOW - 60) * 1000, created_at: NOW - 120 }, NOW)).toBe(true);
  });

  it("holds the email while the device clock reads earlier than when it was scheduled", () => {
    expect(isScheduledEmailDue({ scheduled_at: NOW - 600, created_at: NOW + 3600 }, NOW)).toBe(false);
  });
});

describe("scheduled email claims", () => {
  it("only lists rows whose time has come", async () => {
    insert("due", NOW - 5);
    insert("future", NOW + 60);
    insert("future-ms", (NOW + 60) * 1000);
    expect((await getPendingScheduledEmails()).map((row) => row.id)).toEqual(["due"]);
  });

  it("refuses to claim a row before its scheduled time", async () => {
    insert("future", NOW + 60);
    expect(await claimScheduledEmail("future", NOW)).toBe(false);
    expect(status("future")).toBe("pending");
  });

  it("lets exactly one of two concurrent senders claim a due row", async () => {
    insert("due", NOW - 5);
    const results = await Promise.all([claimScheduledEmail("due", NOW), claimScheduledEmail("due", NOW)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(sqlite.prepare("SELECT status, claimed_at FROM scheduled_emails WHERE id = 'due'").get())
      .toEqual({ status: "sending", claimed_at: NOW });
  });

  it("never claims cancelled, sent or failed rows", async () => {
    for (const state of ["cancelled", "sent", "failed"]) {
      insert(state, NOW - 5, { status: state });
      expect(await claimScheduledEmail(state, NOW)).toBe(false);
      expect(status(state)).toBe(state);
    }
  });

  it("marks sends abandoned by a killed sender as failed instead of retrying them", async () => {
    insert("recent", NOW - 5, { status: "sending", claimed_at: NOW - 30 });
    insert("stale", NOW - 5, { status: "sending", claimed_at: NOW - STALE_SENDING_SECONDS - 1 });
    insert("legacy", NOW - 5, { status: "sending" });
    expect(await failStaleScheduledSends(NOW)).toBe(2);
    expect([status("recent"), status("stale"), status("legacy")]).toEqual(["sending", "failed", "failed"]);
  });
});
