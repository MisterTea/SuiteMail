import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../db/connection";

vi.mock("../db/connection", () => ({ getDb: vi.fn() }));
const sendMessage = vi.fn();
vi.mock("../gmail/tokenManager", () => ({ getGmailClient: vi.fn(async () => ({ sendMessage })) }));
vi.mock("../db/accounts", () => ({ getAccount: vi.fn(async (id: string) => (id === "acc" ? { id, email: "me@example.com" } : null)) }));
const native = vi.hoisted(() => ({ available: false, run: vi.fn(async () => ({ sent: 0, failed: 0 })) }));
vi.mock("./nativeScheduledSend", () => ({
  hasNativeScheduledSend: () => native.available,
  runNativeScheduledSends: native.run,
}));

import { checkNativeScheduledEmails, checkScheduledEmails } from "./scheduledSendManager";

const NOW = 1_800_000_000;
let sqlite: DatabaseSync;
const rows = () => sqlite.prepare("SELECT id, status, scheduled_at, raw_mime FROM scheduled_emails ORDER BY scheduled_at").all();

function insert(id: string, scheduledAt: number, extra: { recurrence?: string; raw?: string | null } = {}) {
  sqlite.prepare(`INSERT INTO scheduled_emails (id, account_id, to_addresses, subject, body_html, scheduled_at, status, created_at, recurrence_rule, raw_mime)
    VALUES (?, 'acc', 'to@example.com', 'Hello', '<p>Hi</p>', ?, 'pending', ?, ?, ?)`).run(
    id, scheduledAt, NOW - 3600, extra.recurrence ?? null, extra.raw === undefined ? "cmF3" : extra.raw,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000);
  sendMessage.mockReset().mockResolvedValue({ id: "sent-1" });
  native.available = false;
  native.run.mockClear();
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

describe("desktop scheduled sending", () => {
  it("does not send before the scheduled time", async () => {
    insert("soon", NOW + 30);
    await checkScheduledEmails();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(rows()[0]).toMatchObject({ status: "pending" });
  });

  it("sends a due email exactly once even when two checks overlap", async () => {
    insert("due", NOW - 1);
    await Promise.all([checkScheduledEmails(), checkScheduledEmails()]);
    await checkScheduledEmails();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(rows()[0]).toMatchObject({ status: "sent" });
  });

  it("schedules the next occurrence of a recurring email with its MIME ready for native senders", async () => {
    const due = Math.floor(new Date(2027, 0, 15, 9, 0).getTime() / 1000);
    vi.setSystemTime(due * 1000);
    insert("daily", due, { recurrence: "daily" });
    await checkScheduledEmails();
    const [sent, next] = rows() as { status: string; scheduled_at: number; raw_mime: string | null }[];
    expect(sent!.status).toBe("sent");
    expect(next!.status).toBe("pending");
    expect(new Date(next!.scheduled_at * 1000)).toEqual(new Date(2027, 0, 16, 9, 0));
    expect(next!.raw_mime).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("native platforms", () => {
  it("leave sending to the native job and only prepare missing MIME in JS", async () => {
    native.available = true;
    insert("legacy", NOW - 1, { raw: null });
    await checkNativeScheduledEmails();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(native.run).toHaveBeenCalledTimes(1);
    const [row] = rows() as { status: string; raw_mime: string | null }[];
    expect(row!.status).toBe("pending");
    expect(atob(row!.raw_mime!.replace(/-/g, "+").replace(/_/g, "/"))).toContain("Subject: Hello");
  });
});
