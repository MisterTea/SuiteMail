import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "./connection";
import { removeMissingEventsInRange } from "./calendarEvents";

vi.mock("./connection", () => ({ getDb: vi.fn(), selectFirstBy: vi.fn() }));

let sqlite: DatabaseSync;
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE calendar_events (
    account_id TEXT, calendar_id TEXT, remote_event_id TEXT, start_time INTEGER, end_time INTEGER
  )`);
  vi.mocked(getDb).mockResolvedValue({
    execute: async (sql: string, values: unknown[] = []) => {
      const bindings = Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]));
      const result = sqlite.prepare(sql).run(bindings);
      return { rowsAffected: Number(result.changes), lastInsertId: 0 };
    },
  } as unknown as Awaited<ReturnType<typeof getDb>>);
});
afterEach(() => sqlite.close());

describe("Exchange calendar range reconciliation", () => {
  it("removes missing events only within the successfully fetched account, calendar and range", async () => {
    const insert = sqlite.prepare("INSERT INTO calendar_events VALUES (?, ?, ?, ?, ?)");
    insert.run("a", "cal", "retained", 100, 200);
    insert.run("a", "cal", "remote-deleted", 100, 200);
    insert.run("a", "cal", "outside-range", 400, 500);
    insert.run("a", "other-cal", "other-calendar", 100, 200);
    insert.run("other-account", "cal", "other-account", 100, 200);
    await removeMissingEventsInRange("a", "cal", 50, 250, ["retained"]);
    expect(sqlite.prepare("SELECT remote_event_id FROM calendar_events").all().map((r) => r.remote_event_id))
      .toEqual(["retained", "outside-range", "other-calendar", "other-account"]);
    // A successful empty response clears the fetched range, while preserving other data.
    await removeMissingEventsInRange("a", "cal", 50, 250, []);
    expect(sqlite.prepare("SELECT count(*) AS count FROM calendar_events").get()?.count).toBe(3);
  });
});
