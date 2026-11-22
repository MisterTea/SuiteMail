import type { EmailProvider, EmailFolder, SyncResult } from "./types";
import { getDb } from "../db/connection";
import { upsertLabel, getLabelsForAccount } from "../db/labels";
import { type DbMessage } from "../db/messages";
import { deleteThread, getThreadLabelIds, setThreadLabels } from "../db/threads";
import { SANDBOX_ID, SANDBOX_EMAIL, sendSandboxMessage, sandboxMessageAsParsed, sandboxIsEnabled, parseSandboxRaw, sandboxAttachmentBase64 } from "./sandbox";
import { buildRawEmail } from "@/utils/emailBuilder";

export class SandboxProvider implements EmailProvider {
  readonly type = "sandbox" as const;
  readonly accountId = SANDBOX_ID;
  async listFolders(): Promise<EmailFolder[]> {
    return (await getLabelsForAccount(this.accountId)).map((l) => ({ id: l.id, name: l.name, path: l.id, type: l.type === "system" ? "system" : "user", specialUse: null, delimiter: "/", messageCount: 0, unreadCount: 0 }));
  }
  async createFolder(name: string): Promise<EmailFolder> {
    const id = `sandbox-label-${crypto.randomUUID()}`;
    await upsertLabel({ id, accountId: this.accountId, name, type: "user" });
    return { id, name, path: id, type: "user", specialUse: null, delimiter: "/", messageCount: 0, unreadCount: 0 };
  }
  async deleteFolder(path: string) { const db = await getDb(); await db.execute("DELETE FROM labels WHERE account_id = $1 AND id = $2 AND type = 'user'", [this.accountId, path]); }
  async renameFolder(path: string, name: string) { const db = await getDb(); await db.execute("UPDATE labels SET name = $1 WHERE account_id = $2 AND id = $3 AND type = 'user'", [name, this.accountId, path]); }
  async initialSync(): Promise<SyncResult> { return { messages: [] }; }
  async deltaSync(): Promise<SyncResult> { return { messages: [] }; }
  async fetchMessage(id: string) {
    const db = await getDb();
    const rows = await db.select<DbMessage[]>("SELECT * FROM messages WHERE account_id = $1 AND id = $2", [this.accountId, id]);
    if (!rows[0]) throw new Error("Sandbox message not found");
    const message = sandboxMessageAsParsed(rows[0]);
    const attachments = await db.select<import("../db/attachments").DbAttachment[]>("SELECT * FROM attachments WHERE account_id=$1 AND message_id=$2", [this.accountId, id]);
    return { ...message, hasAttachments: attachments.length > 0, attachments: attachments.map((a) => ({ filename: a.filename ?? "attachment", mimeType: a.mime_type ?? "application/octet-stream", size: a.size ?? 0, gmailAttachmentId: a.id, contentId: a.content_id, isInline: a.is_inline === 1 })) };
  }
  async fetchAttachment(messageId: string, attachmentId: string): Promise<{ data: string; size: number }> {
    const mail = await parseSandboxRaw(await this.fetchRawMessage(messageId));
    const index = mail.attachments.findIndex((_a, i) => `${messageId}-attachment-${i}` === attachmentId);
    if (index < 0) throw new Error("Sandbox attachment not found");
    const data = sandboxAttachmentBase64(mail.attachments[index]!.content);
    return { data, size: atob(data).length };
  }
  async fetchRawMessage(id: string) {
    const db = await getDb();
    const raw = await db.select<{ raw: string }[]>("SELECT raw FROM sandbox_raw_messages WHERE account_id = $1 AND id = $2", [this.accountId, id]);
    if (raw[0]) return raw[0].raw;
    const m = await this.fetchMessage(id);
    return buildRawEmail({ from: m.fromAddress!, to: [m.toAddresses || SANDBOX_EMAIL], subject: m.subject || "", htmlBody: m.bodyHtml || "" });
  }
  async archive(threadId: string) { await this.removeLabel(threadId, "INBOX"); }
  async trash(threadId: string) { await this.removeLabel(threadId, "INBOX"); await this.addLabel(threadId, "TRASH"); }
  async permanentDelete(threadId: string) { await deleteThread(this.accountId, threadId); }
  async markRead(threadId: string, _ids: string[], read: boolean) {
    const db = await getDb();
    await db.execute("UPDATE messages SET is_read = $1 WHERE account_id = $2 AND thread_id = $3", [read ? 1 : 0, this.accountId, threadId]);
    await db.execute("UPDATE threads SET is_read = $1 WHERE account_id = $2 AND id = $3", [read ? 1 : 0, this.accountId, threadId]);
  }
  async star(threadId: string, _ids: string[], starred: boolean) {
    const db = await getDb();
    await db.execute("UPDATE messages SET is_starred = $1 WHERE account_id = $2 AND thread_id = $3", [starred ? 1 : 0, this.accountId, threadId]);
    await db.execute("UPDATE threads SET is_starred = $1 WHERE account_id = $2 AND id = $3", [starred ? 1 : 0, this.accountId, threadId]);
    if (starred) await this.addLabel(threadId, "STARRED"); else await this.removeLabel(threadId, "STARRED");
  }
  async spam(threadId: string, _ids: string[], spam: boolean) {
    if (spam) { await this.removeLabel(threadId, "INBOX"); await this.addLabel(threadId, "SPAM"); }
    else { await this.removeLabel(threadId, "SPAM"); await this.addLabel(threadId, "INBOX"); }
  }
  async moveToFolder(threadId: string, _ids: string[], path: string) {
    const labels = (await getThreadLabelIds(this.accountId, threadId)).filter((l) => ["STARRED", "SENT"].includes(l));
    await setThreadLabels(this.accountId, threadId, [...new Set([...labels, path])]);
  }
  async addLabel(threadId: string, labelId: string) {
    const db = await getDb();
    await db.execute("INSERT OR IGNORE INTO thread_labels (account_id, thread_id, label_id) VALUES ($1, $2, $3)", [this.accountId, threadId, labelId]);
  }
  async removeLabel(threadId: string, labelId: string) {
    const db = await getDb();
    await db.execute("DELETE FROM thread_labels WHERE account_id = $1 AND thread_id = $2 AND label_id = $3", [this.accountId, threadId, labelId]);
  }
  sendMessage(raw: string, threadId?: string) { return sendSandboxMessage(raw, threadId); }
  async createDraft(raw: string, threadId?: string) { const id = `sandbox-draft-${crypto.randomUUID()}`; return this.updateDraft(id, raw, threadId); }
  async updateDraft(id: string, raw: string, threadId?: string) {
    const db = await getDb();
    await db.execute("INSERT INTO sandbox_raw_messages (account_id, id, thread_id, raw) VALUES ($1, $2, $3, $4) ON CONFLICT(account_id, id) DO UPDATE SET raw = $4, thread_id = $3", [this.accountId, id, threadId ?? null, raw]);
    return { draftId: id };
  }
  async deleteDraft(id: string) { const db = await getDb(); await db.execute("DELETE FROM sandbox_raw_messages WHERE account_id = $1 AND id = $2", [this.accountId, id]); }
  async testConnection() { return { success: await sandboxIsEnabled(), message: "Local sandbox account" }; }
  async getProfile() { return { email: SANDBOX_EMAIL, name: "Sandbox" }; }
}
