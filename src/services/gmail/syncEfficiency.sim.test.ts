/**
 * End-to-end Gmail sync simulation against e2e/fakeGmail.ts with a real SQLite schema.
 *
 * Counts HTTP requests, Gmail calls and quota units, and measures simulated wall-clock time (fake timers,
 * fixed per-request latency) for: an initial sync, one delta sync after typical server-side activity,
 * and draining 30 queued archive operations. It also checks that the local mailbox matches the server.
 * Set GMAIL_SYNC_BENCH_OUT=/path.json to save the measurements.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { MIGRATIONS, splitStatements } from "../db/migrations";
import { FakeGmail } from "../../../e2e/fakeGmail";
import { GmailClient } from "./client";

const ACCOUNT = "gmail-sim";
const LATENCY_MS = 150; // Round trip per HTTP request.
const PER_CALL_MS = 5; // Extra server time per call inside a batch.

vi.mock("./tokenManager", () => {
  // Like the real token manager: one client per account.
  const clients = new Map<string, GmailClient>();
  return {
    getGmailClient: vi.fn(async (accountId: string) => {
      if (!clients.has(accountId)) clients.set(accountId, new GmailClient(accountId, "client", { accessToken: "token", refreshToken: "refresh", expiresAt: 4_000_000_000 }));
      return clients.get(accountId)!;
    }),
  };
});
vi.mock("../calendar/providerFactory", () => ({ hasCalendarSupport: vi.fn().mockResolvedValue(false), getCalendarProvider: vi.fn() }));
vi.mock("../notifications/notificationManager", () => ({ shouldNotifyForMessage: vi.fn().mockReturnValue(false), queueNewEmailNotification: vi.fn() }));
vi.mock("@/services/ai/embeddingIndexer", () => ({ indexBatchForAccount: vi.fn().mockResolvedValue({ indexedCount: 0 }) }));
vi.mock("@/services/ai/categorizationManager", () => ({ categorizeNewThreads: vi.fn() }));
vi.mock("@/services/smartLabels/smartLabelManager", () => ({ applySmartLabelsToMessages: vi.fn() }));
vi.mock("../sync/outgoingSyncGuard", () => ({ checkOutgoingSyncAllowed: vi.fn().mockResolvedValue(true), buildOutgoingSyncRequest: vi.fn(), LARGE_DIFF_THRESHOLD: 5 }));

function createDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const migration of MIGRATIONS) {
    for (const statement of splitStatements(migration.sql)) {
      try { db.exec(statement); } catch (error) { if (!String(error).includes("duplicate column")) throw error; }
    }
  }
  return db;
}

function bind(values: unknown[] = []): (string | number | null)[] {
  return values.map((value) => value === undefined ? null : typeof value === "boolean" ? Number(value) : value as string | number | null);
}

const gmail = new FakeGmail();
let sqlite: DatabaseSync;
const results: Record<string, unknown> = {};

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

/** Drive fake timers until the promise settles. */
async function run<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  let failure: unknown;
  let value: T | undefined;
  promise.then((result) => { value = result; done = true; }, (error) => { failure = error; done = true; });
  while (!done) {
    await flush();
    if (done) break;
    if (vi.getTimerCount() > 0) await vi.advanceTimersToNextTimerAsync();
  }
  if (failure) throw failure;
  return value as T;
}

function row<T>(sql: string, ...params: unknown[]): T {
  return sqlite.prepare(sql.replace(/\$(\d+)/g, "?$1")).get(...bind(params)) as T;
}

function snapshot(label: string, started: number): Record<string, number> {
  const totals = gmail.totals();
  const result = { ...totals, simulatedSeconds: Math.round((Date.now() - started) / 100) / 10 };
  results[label] = result;
  return result;
}

/** Threads whose local labels, read state or message set differ from the server. */
function mismatches(): string[] {
  const problems: string[] = [];
  for (const threadId of gmail.threadIds()) {
    const messages = gmail.threadMessages(threadId);
    const serverLabels = [...new Set(messages.flatMap((m) => m.labelIds))].sort();
    const localLabels = (sqlite.prepare("SELECT label_id FROM thread_labels WHERE account_id = ? AND thread_id = ?").all(ACCOUNT, threadId) as { label_id: string }[])
      .map((r) => r.label_id).sort();
    const thread = sqlite.prepare("SELECT is_read, message_count FROM threads WHERE account_id = ? AND id = ?").get(ACCOUNT, threadId) as { is_read: number; message_count: number } | undefined;
    const localIds = (sqlite.prepare("SELECT id FROM messages WHERE account_id = ? AND thread_id = ? ORDER BY id").all(ACCOUNT, threadId) as { id: string }[]).map((r) => r.id);
    const serverIds = messages.map((m) => m.id).sort();
    if (!thread) { problems.push(`${threadId}: missing`); continue; }
    if (JSON.stringify(localLabels) !== JSON.stringify(serverLabels)) problems.push(`${threadId}: labels ${localLabels} != ${serverLabels}`);
    if (Boolean(thread.is_read) !== messages.every((m) => !m.labelIds.includes("UNREAD"))) problems.push(`${threadId}: read state`);
    if (thread.message_count !== messages.length || JSON.stringify(localIds) !== JSON.stringify(serverIds)) problems.push(`${threadId}: messages ${localIds.length} != ${serverIds.length}`);
  }
  return problems;
}

describe("Gmail sync efficiency simulation", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2026-11-20T12:00:00Z"));
    sqlite = createDatabase();
    sqlite.prepare("INSERT INTO accounts (id, email, display_name, provider, is_active) VALUES (?, ?, ?, 'gmail_api', 1)").run(ACCOUNT, gmail.email, "Sim");
    sqlite.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('sync_period_days', '365')").run();
    (window as unknown as { supermail: unknown }).supermail = {
      db: {
        select: async (query: string, values?: unknown[]) => sqlite.prepare(query.replace(/\$(\d+)/g, "?$1")).all(...bind(values)),
        execute: async (query: string, values?: unknown[]) => {
          const result = sqlite.prepare(query.replace(/\$(\d+)/g, "?$1")).run(...bind(values));
          return { rowsAffected: Number(result.changes), lastInsertId: Number(result.lastInsertRowid) };
        },
      },
    };
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input instanceof Request ? input.url : input);
      const headers = Object.fromEntries(new Headers(init.headers).entries());
      const before = gmail.calls.length;
      const response = gmail.handle(init.method ?? "GET", url, headers, typeof init.body === "string" ? init.body : "");
      const calls = gmail.calls.length - before;
      await new Promise((resolve) => setTimeout(resolve, LATENCY_MS + PER_CALL_MS * Math.max(0, calls - 1)));
      return new Response(response.status === 204 ? null : response.body, { status: response.status, headers: response.headers });
    });
    gmail.seed({ threadCount: 400, recentThreads: 60, now: Date.now() });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (process.env.GMAIL_SYNC_BENCH_OUT) writeFileSync(process.env.GMAIL_SYNC_BENCH_OUT, JSON.stringify(results, null, 2));
    process.stdout.write(`\nGmail sync simulation: ${JSON.stringify(results, null, 2)}\n`);
  });

  it("initial sync downloads the whole sync window", async () => {
    const { triggerSync } = await import("./syncManager");
    gmail.resetLog();
    const started = Date.now();
    let listed = 0;
    let recentBodies = 0;
    let cycles = 0;
    const recentCutoff = Date.now() - 30 * 86_400_000;
    while (cycles++ < 300) {
      const cycleStart = Date.now();
      await run(triggerSync([ACCOUNT]));
      const account = row<{ history_id: string | null }>("SELECT history_id FROM accounts WHERE id = $1", ACCOUNT);
      if (!listed && account.history_id) listed = Date.now();
      const missingRecent = row<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE account_id = $1 AND body_cached = 0 AND date >= $2", ACCOUNT, recentCutoff).n;
      if (listed && !recentBodies && missingRecent === 0) recentBodies = Date.now();
      const missingAny = row<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE account_id = $1 AND body_cached = 0", ACCOUNT).n;
      if (listed && recentBodies && missingAny === 0) break;
      if (listed && recentBodies && process.env.GMAIL_SYNC_BENCH_RECENT_ONLY) break;
      if (Date.now() < cycleStart + 60_000) vi.setSystemTime(cycleStart + 60_000);
    }
    const result = snapshot("initialSync", started);
    results.initialSyncListComplete = Math.round((listed - started) / 1000);
    results.initialSyncRecentBodiesComplete = Math.round((recentBodies - started) / 1000);
    results.initialSyncCycles = cycles;
    expect(result.calls).toBeGreaterThan(0);
    expect(mismatches()).toEqual([]);
  }, 600_000);

  it("delta sync applies typical server activity", async () => {
    const { triggerSync } = await import("./syncManager");
    const threads = gmail.threadIds().map((id) => gmail.threadMessages(id)).sort((a, b) => b.at(-1)!.internalDate - a.at(-1)!.internalDate);
    const now = Date.now();
    for (let i = 0; i < 5; i++) gmail.deliver({ at: now + i });
    for (let i = 0; i < 3; i++) gmail.deliver({ threadId: threads[10 + i]![0]!.threadId, at: now + 10 + i });
    for (const messages of threads.slice(0, 15)) gmail.modifyMessages(messages.map((m) => m.id), [], ["UNREAD"]);
    for (const messages of threads.slice(20, 26)) gmail.modifyMessages(messages.map((m) => m.id), [], ["INBOX"]);
    gmail.modifyMessages([threads[30]![0]!.id, threads[31]![0]!.id], ["STARRED"]);
    gmail.deleteMessage(threads[40]!.at(-1)!.id);
    gmail.resetLog();
    vi.setSystemTime(Date.now() + 60_000);
    const started = Date.now();
    await run(triggerSync([ACCOUNT]));
    snapshot("deltaSync", started);
    expect(mismatches()).toEqual([]);
  }, 120_000);

  it("drains 30 queued archive operations", async () => {
    const { enqueuePendingOperation } = await import("../db/pendingOperations");
    const { useUIStore } = await import("@/stores/uiStore");
    useUIStore.setState({ isOnline: true });
    const inbox = gmail.threadIds().filter((id) => gmail.threadMessages(id).some((m) => m.labelIds.includes("INBOX"))).slice(0, 30);
    expect(inbox).toHaveLength(30);
    for (const threadId of inbox) await enqueuePendingOperation(ACCOUNT, "archive", threadId, { threadId, messageIds: [] });
    gmail.resetLog();
    const started = Date.now();
    const queue = await import("../queue/queueProcessor") as unknown as { processQueue?: () => Promise<void> };
    if (queue.processQueue) {
      await run(queue.processQueue());
    } else {
      // Baseline: the processor executed queued operations one at a time.
      const { executeQueuedAction } = await import("../emailActions");
      for (const threadId of inbox) await run(executeQueuedAction(ACCOUNT, "archive", { threadId, messageIds: [] }));
    }
    snapshot("queuedArchive30", started);
    for (const threadId of inbox) expect(gmail.threadMessages(threadId).some((m) => m.labelIds.includes("INBOX"))).toBe(false);
  }, 120_000);

  it("archives a 20-thread selection online", async () => {
    const { executeEmailAction } = await import("../emailActions");
    const inbox = gmail.threadIds().filter((id) => gmail.threadMessages(id).some((m) => m.labelIds.includes("INBOX"))).slice(0, 20);
    expect(inbox).toHaveLength(20);
    gmail.resetLog();
    const started = Date.now();
    // Like EmailList's bulk archive: one action per selected thread, all at once.
    const outcomes = await run(Promise.all(inbox.map((threadId) => executeEmailAction(ACCOUNT, { type: "archive", threadId, messageIds: [] }))));
    snapshot("onlineArchive20", started);
    expect(outcomes.every((o) => o.success && !o.queued)).toBe(true);
    for (const threadId of inbox) expect(gmail.threadMessages(threadId).some((m) => m.labelIds.includes("INBOX"))).toBe(false);
  }, 120_000);
});
