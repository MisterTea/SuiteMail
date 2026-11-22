import { DatabaseSync } from "node:sqlite";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { runMigrations } from "../db/migrations";
import { getAllAccounts } from "../db/accounts";
import { setSandboxEnabled, sendSandboxMessage, SANDBOX_ID, SANDBOX_EMAIL } from "./sandbox";
import { buildRawEmail } from "@/utils/emailBuilder";
import { SandboxProvider } from "./sandboxProvider";

let sqlite: DatabaseSync;
let queue = Promise.resolve();
const params = (values: unknown[] = []) => Object.fromEntries(values.map((v, i) => [String(i + 1), v]));
const db = {
  select: async (query: string, values?: unknown[]) => sqlite.prepare(query).all(params(values) as any),
  execute: async (query: string, values?: unknown[]) => sqlite.prepare(query).run(params(values) as any),
};
vi.mock("../db/connection", () => ({
  getDb: async () => db,
  selectFirstBy: async (query: string, values: unknown[]) => (await db.select(query, values))[0] ?? null,
  withTransaction: async (fn: (database: typeof db) => Promise<void>) => {
    const run = queue.then(async () => {
      sqlite.exec("BEGIN");
      try { await fn(db); sqlite.exec("COMMIT"); } catch (err) { sqlite.exec("ROLLBACK"); throw err; }
    });
    queue = run.catch(() => {});
    return run;
  },
}));
beforeEach(async () => { sqlite = new DatabaseSync(":memory:"); queue = Promise.resolve(); await runMigrations(); });
afterEach(() => sqlite.close());
const raw = (subject: string, inReplyTo?: string) => buildRawEmail({ from: SANDBOX_EMAIL, to: ["friend@sandbox.test"], subject, htmlBody: "<p>Could we meet on Friday at 2 PM?</p>", inReplyTo });
const count = () => Number(sqlite.prepare("SELECT COUNT(*) AS n FROM messages WHERE account_id = ?").get(SANDBOX_ID)!.n);

describe("local sandbox account", () => {
  it("seeds 75 varied emails and keeps them when disabled and re-enabled", async () => {
    await setSandboxEnabled(true);
    expect(count()).toBe(75);
    expect(sqlite.prepare("SELECT COUNT(DISTINCT subject) AS n FROM messages").get()!.n).toBe(75);
    await setSandboxEnabled(false);
    expect((await getAllAccounts()).some((a) => a.id === SANDBOX_ID)).toBe(false);
    expect(count()).toBe(75);
    await setSandboxEnabled(true);
    expect(count()).toBe(75);
  });
  it("replies immediately exactly once per conversation, including across provider recreation", async () => {
    await setSandboxEnabled(true);
    const first = await new SandboxProvider().sendMessage(raw("Meeting plan"));
    const sent = sqlite.prepare("SELECT thread_id, message_id_header FROM messages WHERE id = ?").get(first.id)!;
    expect(count()).toBe(77);
    expect(sqlite.prepare("SELECT message_count FROM threads WHERE id = ?").get(sent.thread_id as string)!.message_count).toBe(2);
    await new SandboxProvider().sendMessage(raw("Re: Meeting plan", sent.message_id_header as string), sent.thread_id as string);
    expect(count()).toBe(78);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM sandbox_replies").get()!.n).toBe(1);
  });
  it("deduplicates a retried send and concurrent sends to the same conversation", async () => {
    await setSandboxEnabled(true);
    const message = raw("Check-in");
    await Promise.all([sendSandboxMessage(message, "sandbox-thread-0"), sendSandboxMessage(message, "sandbox-thread-0")]);
    expect(count()).toBe(77);
    await Promise.all([sendSandboxMessage(raw("First follow-up"), "sandbox-thread-0"), sendSandboxMessage(raw("Second follow-up"), "sandbox-thread-0")]);
    expect(count()).toBe(79);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM sandbox_replies").get()!.n).toBe(1);
  });
  it("preserves sent attachments locally while generating a reply", async () => {
    await setSandboxEnabled(true);
    const mime = buildRawEmail({ from: SANDBOX_EMAIL, to: ["friend@sandbox.test"], subject: "Attachment test", htmlBody: "<p>Please review.</p>", attachments: [{ filename: "notes.txt", mimeType: "text/plain", content: btoa("Sandbox notes") }] });
    const provider = new SandboxProvider();
    const sent = await provider.sendMessage(mime);
    const message = await provider.fetchMessage(sent.id);
    expect(message.hasAttachments).toBe(true);
    const attachment = await provider.fetchAttachment(sent.id, message.attachments[0]!.gmailAttachmentId);
    expect(atob(attachment.data)).toBe("Sandbox notes");
    expect(count()).toBe(77);
  });

  it("rejects sending while disabled without contacting a server", async () => {
    await setSandboxEnabled(true); await setSandboxEnabled(false);
    await expect(sendSandboxMessage(raw("Disabled"))).rejects.toThrow("Enable the sandbox");
    expect(count()).toBe(75);
  });
});
