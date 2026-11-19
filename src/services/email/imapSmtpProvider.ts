import type { EmailProvider, EmailFolder, SyncResult } from "./types";
import type { ParsedMessage } from "../gmail/messageParser";
import { buildImapConfig, buildSmtpConfig } from "../imap/imapConfigBuilder";
import { imapInitialSync, imapDeltaSync, imapMessageToParsedMessage } from "../imap/imapSync";
import { mapFolderToLabel, getSyncableFolders } from "../imap/folderMapper";
import {
  imapListFolders,
  imapSetFlags,
  imapDeleteMessages,
  imapFetchMessageBody,
  imapFetchAttachment,
  imapFetchRawMessage,
  imapTestConnection,
  imapAppendMessage,
  smtpSendEmail,
  smtpTestConnection,
  type ImapConfig,
  type SmtpConfig,
} from "../imap/tauriCommands";
import { getAccount, type DbAccount } from "../db/accounts";
import { findSpecialFolder } from "../imap/messageHelper";
import { ensureFreshToken } from "../oauth/oauthTokenManager";
import { upsertMessage } from "../db/messages";
import { upsertThread, setThreadLabels, getThreadLabelIds } from "../db/threads";
import { markEmailFiltered } from "../filters/filterEngine";
import { syncConversationLabelsToRemote } from "../imap/metadataSidecarSync";
import { getDb } from "../db/connection";

/**
 * Decode base64url (Gmail/RFC 4648 URL-safe, no padding) to a UTF-8 string.
 */
function base64UrlDecode(input: string): string {
  // Convert base64url to standard base64
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  // Add padding if needed
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Parse basic RFC 2822 headers from a raw email string.
 * Returns a map of header name (lowercase) → header value.
 */
function parseBasicHeaders(raw: string): Map<string, string> {
  const headers = new Map<string, string>();
  // Headers end at the first blank line
  const headerEnd = raw.indexOf("\r\n\r\n");
  const headerSection = headerEnd !== -1 ? raw.slice(0, headerEnd) : raw;

  // Unfold continuation lines (lines starting with space/tab are continuations)
  const unfolded = headerSection.replace(/\r\n([ \t])/g, " ");

  for (const line of unfolded.split("\r\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const name = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();
    headers.set(name, value);
  }

  return headers;
}

/**
 * Extract a plain-text snippet from a raw RFC 2822 email body.
 */
function extractSnippet(raw: string, maxLen = 200): string {
  const bodyStart = raw.indexOf("\r\n\r\n");
  if (bodyStart === -1) return "";

  let body = raw.slice(bodyStart + 4);

  // For multipart messages, try to find the text/plain part
  const contentType = parseBasicHeaders(raw).get("content-type") ?? "";
  const boundaryMatch = contentType.match(/boundary="?([^";\s]+)"?/);
  if (boundaryMatch) {
    const boundary = boundaryMatch[1]!;
    const parts = body.split(`--${boundary}`);
    for (const part of parts) {
      if (part.toLowerCase().includes("content-type: text/plain")) {
        const partBodyStart = part.indexOf("\r\n\r\n");
        if (partBodyStart !== -1) {
          body = part.slice(partBodyStart + 4);
          break;
        }
      }
    }
  }

  // Strip HTML tags if present, trim, and truncate
  return body
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

/**
 * EmailProvider adapter for IMAP/SMTP accounts.
 * Delegates to Tauri IMAP/SMTP commands via the imapSync engine.
 */
export class ImapSmtpProvider implements EmailProvider {
  readonly accountId: string;
  readonly type = "imap" as const;

  private _imapConfig: ImapConfig | null = null;
  private _smtpConfig: SmtpConfig | null = null;

  constructor(accountId: string) {
    this.accountId = accountId;
  }

  private async getAccount(): Promise<DbAccount> {
    const account = await getAccount(this.accountId);
    if (!account) {
      throw new Error(`Account ${this.accountId} not found`);
    }
    return account;
  }

  private async getImapConfig(): Promise<ImapConfig> {
    const account = await this.getAccount();
    if (account.auth_method === "oauth2") {
      // OAuth accounts need a fresh token every time
      const token = await ensureFreshToken(account);
      return buildImapConfig(account, token);
    }
    if (!this._imapConfig) {
      this._imapConfig = buildImapConfig(account);
    }
    return this._imapConfig;
  }

  private async getSmtpConfig(): Promise<SmtpConfig> {
    const account = await this.getAccount();
    if (account.auth_method === "oauth2") {
      const token = await ensureFreshToken(account);
      return buildSmtpConfig(account, token);
    }
    if (!this._smtpConfig) {
      this._smtpConfig = buildSmtpConfig(account);
    }
    return this._smtpConfig;
  }

  /**
   * Invalidate cached configs (e.g., after password change).
   */
  clearConfigCache(): void {
    this._imapConfig = null;
    this._smtpConfig = null;
  }

  // ---- Folder/Label operations ----

  async listFolders(): Promise<EmailFolder[]> {
    const config = await this.getImapConfig();
    const imapFolders = await imapListFolders(config);
    const syncable = getSyncableFolders(imapFolders);

    return syncable.map((f) => {
      const mapping = mapFolderToLabel(f);
      return {
        id: mapping.labelId,
        name: mapping.labelName,
        path: f.path,
        type: mapping.type as "system" | "user",
        specialUse: f.special_use,
        delimiter: f.delimiter,
        messageCount: f.exists,
        unreadCount: f.unseen,
      };
    });
  }

  async createFolder(
    _name: string,
    _parentPath?: string,
  ): Promise<EmailFolder> {
    throw new Error(
      "Creating folders is not supported for IMAP accounts via the current command set. " +
        "Please create the folder directly on the mail server.",
    );
  }

  async deleteFolder(_path: string): Promise<void> {
    throw new Error(
      "Deleting folders is not supported for IMAP accounts via the current command set. " +
        "Please delete the folder directly on the mail server.",
    );
  }

  async renameFolder(_path: string, _newName: string): Promise<void> {
    throw new Error(
      "Renaming folders is not supported for IMAP accounts via the current command set. " +
        "Please rename the folder directly on the mail server.",
    );
  }

  // ---- Sync operations ----

  async initialSync(
    daysBack: number,
    onProgress?: (phase: string, current: number, total: number) => void,
  ): Promise<SyncResult> {
    return imapInitialSync(this.accountId, daysBack, onProgress ? (p) => {
      onProgress(p.phase, p.current, p.total);
    } : undefined);
  }

  async deltaSync(_syncToken: string): Promise<SyncResult> {
    return imapDeltaSync(this.accountId);
  }

  // ---- Message operations ----

  async fetchMessage(messageId: string): Promise<ParsedMessage> {
    const { folder, uid } = this.parseImapMessageId(messageId);

    if (uid === null || !folder) {
      throw new Error(`Invalid IMAP message ID format: ${messageId}`);
    }

    const config = await this.getImapConfig();
    const imapMsg = await imapFetchMessageBody(config, folder, uid);

    const { parsed } = imapMessageToParsedMessage(
      imapMsg,
      this.accountId,
      folder,
    );
    parsed.id = messageId;

    return parsed;
  }

  async fetchAttachment(
    messageId: string,
    attachmentId: string,
  ): Promise<{ data: string; size: number }> {
    const { folder, uid } = this.parseImapMessageId(messageId);

    if (uid === null || !folder) {
      throw new Error(`Invalid IMAP message ID format: ${messageId}`);
    }

    const config = await this.getImapConfig();
    const data = await imapFetchAttachment(config, folder, uid, attachmentId);
    return { data, size: data.length };
  }

  async fetchRawMessage(messageId: string): Promise<string> {
    const { folder, uid } = this.parseImapMessageId(messageId);

    if (uid === null || !folder) {
      throw new Error(`Invalid IMAP message ID format: ${messageId}`);
    }

    const config = await this.getImapConfig();
    return imapFetchRawMessage(config, folder, uid);
  }

  // ---- Actions ----

  private async resolveThreadId(threadId: string, messageIds?: string[]): Promise<string> {
    if (threadId) return threadId;
    if (!messageIds || messageIds.length === 0) return "";
    try {
      const db = await getDb();
      const rows = await db.select<{ thread_id: string }[]>(
        "SELECT thread_id FROM messages WHERE account_id = $1 AND id = $2 LIMIT 1",
        [this.accountId, messageIds[0]],
      );
      return rows[0]?.thread_id ?? "";
    } catch {
      return "";
    }
  }

  async archive(
    threadId: string,
    messageIds: string[],
  ): Promise<void> {
    // When syncing mail in the other direction, update the labels based on conversation labels.
    // Do not change the IMAP folder.
    const effectiveThreadId = await this.resolveThreadId(threadId, messageIds);
    if (!effectiveThreadId) return;
    const existingLabels = await getThreadLabelIds(this.accountId, effectiveThreadId);
    const updatedLabels = existingLabels.filter((l) => l !== "INBOX");
    if (!updatedLabels.includes("archive")) {
      updatedLabels.push("archive");
    }
    await setThreadLabels(this.accountId, effectiveThreadId, updatedLabels);
    await syncConversationLabelsToRemote(this.accountId, effectiveThreadId, updatedLabels);
  }

  async trash(
    threadId: string,
    messageIds: string[],
  ): Promise<void> {
    // When syncing mail in the other direction, update the labels based on conversation labels.
    // Do not change the IMAP folder.
    const effectiveThreadId = await this.resolveThreadId(threadId, messageIds);
    if (!effectiveThreadId) return;
    const existingLabels = await getThreadLabelIds(this.accountId, effectiveThreadId);
    const updatedLabels = existingLabels.filter((l) => l !== "INBOX");
    if (!updatedLabels.includes("TRASH")) {
      updatedLabels.push("TRASH");
    }
    await setThreadLabels(this.accountId, effectiveThreadId, updatedLabels);
    await syncConversationLabelsToRemote(this.accountId, effectiveThreadId, updatedLabels);
  }

  async permanentDelete(
    _threadId: string,
    _messageIds: string[],
  ): Promise<void> {
    const config = await this.getImapConfig();
    const grouped = this.groupByFolder(_messageIds);

    for (const [folder, uids] of grouped) {
      await imapDeleteMessages(config, folder, uids);
    }
  }

  async markRead(
    _threadId: string,
    _messageIds: string[],
    read: boolean,
  ): Promise<void> {
    const config = await this.getImapConfig();
    const grouped = this.groupByFolder(_messageIds);

    for (const [folder, uids] of grouped) {
      await imapSetFlags(config, folder, uids, ["Seen"], read);
    }
  }

  async star(
    _threadId: string,
    _messageIds: string[],
    starred: boolean,
  ): Promise<void> {
    const config = await this.getImapConfig();
    const grouped = this.groupByFolder(_messageIds);

    for (const [folder, uids] of grouped) {
      await imapSetFlags(config, folder, uids, ["Flagged"], starred);
    }
  }

  async spam(
    threadId: string,
    messageIds: string[],
    isSpam: boolean,
  ): Promise<void> {
    // When syncing mail in the other direction, update the labels based on conversation labels.
    // Do not change the IMAP folder.
    const effectiveThreadId = await this.resolveThreadId(threadId, messageIds);
    if (!effectiveThreadId) return;
    const existingLabels = await getThreadLabelIds(this.accountId, effectiveThreadId);
    let updatedLabels: string[];
    if (isSpam) {
      updatedLabels = existingLabels.filter((l) => l !== "INBOX");
      if (!updatedLabels.includes("SPAM")) {
        updatedLabels.push("SPAM");
      }
    } else {
      updatedLabels = existingLabels.filter((l) => l !== "SPAM");
      if (!updatedLabels.includes("INBOX")) {
        updatedLabels.push("INBOX");
      }
    }
    await setThreadLabels(this.accountId, effectiveThreadId, updatedLabels);
    await syncConversationLabelsToRemote(this.accountId, effectiveThreadId, updatedLabels);
  }

  async moveToFolder(
    threadId: string,
    messageIds: string[],
    folderPath: string,
  ): Promise<void> {
    // When syncing mail in the other direction, update the labels based on conversation labels.
    // Do not change the IMAP folder.
    const effectiveThreadId = await this.resolveThreadId(threadId, messageIds);
    if (!effectiveThreadId) return;
    const mapping = mapFolderToLabel({
      path: folderPath,
      name: folderPath.split("/").pop() ?? folderPath,
      delimiter: "/",
      special_use: null,
      raw_path: folderPath,
      exists: 0,
      unseen: 0,
    });
    const targetLabel = mapping.labelId;
    const existingLabels = await getThreadLabelIds(this.accountId, effectiveThreadId);
    let updatedLabels = existingLabels;
    if (targetLabel !== "INBOX") {
      updatedLabels = updatedLabels.filter((l) => l !== "INBOX");
    }
    if (!updatedLabels.includes(targetLabel)) {
      updatedLabels = [...updatedLabels, targetLabel];
    }
    await setThreadLabels(this.accountId, effectiveThreadId, updatedLabels);
    await syncConversationLabelsToRemote(this.accountId, effectiveThreadId, updatedLabels);
  }

  async addLabel(
    threadId: string,
    labelId: string,
  ): Promise<void> {
    // When syncing mail in the other direction, update the labels based on conversation labels.
    // Do not change the IMAP folder.
    const existingLabels = await getThreadLabelIds(this.accountId, threadId);
    const updatedLabels = existingLabels.includes(labelId)
      ? existingLabels
      : [...existingLabels, labelId];
    await setThreadLabels(this.accountId, threadId, updatedLabels);
    await syncConversationLabelsToRemote(this.accountId, threadId, updatedLabels);
  }

  async removeLabel(
    threadId: string,
    labelId: string,
  ): Promise<void> {
    // When syncing mail in the other direction, update the labels based on conversation labels.
    // Do not change the IMAP folder.
    const existingLabels = await getThreadLabelIds(this.accountId, threadId);
    const updatedLabels = existingLabels.filter((l) => l !== labelId);
    await setThreadLabels(this.accountId, threadId, updatedLabels);
    await syncConversationLabelsToRemote(this.accountId, threadId, updatedLabels);
  }

  // ---- Send/Draft operations ----

  async sendMessage(
    rawBase64Url: string,
    _threadId?: string,
  ): Promise<{ id: string }> {
    const smtpConfig = await this.getSmtpConfig();
    const result = await smtpSendEmail(smtpConfig, rawBase64Url);
    if (!result.success) {
      throw new Error(`SMTP send failed: ${result.message}`);
    }

    const messageId = `imap-sent-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Save sent message to local DB so it appears in Sent folder immediately
    try {
      await this.saveSentMessageLocally(rawBase64Url, messageId, _threadId);
    } catch (err) {
      console.warn("[IMAP] Failed to save sent message to local DB:", err);
    }

    // Copy sent message to Sent folder on IMAP server
    try {
      const imapConfig = await this.getImapConfig();
      const sentFolder =
        (await findSpecialFolder(this.accountId, "\\Sent")) ?? "Sent";
      await imapAppendMessage(imapConfig, sentFolder, rawBase64Url, "(\\Seen)");
    } catch (err) {
      // Non-fatal: message was sent successfully, just not copied to server Sent folder
      console.error(
        "[IMAP] Failed to copy sent message to Sent folder on server:",
        err,
      );
    }

    return { id: messageId };
  }

  /**
   * Save a sent message to the local SQLite DB with the SENT label.
   * This ensures the message appears in the Sent folder view immediately
   * without waiting for the next IMAP delta sync.
   */
  private async saveSentMessageLocally(
    rawBase64Url: string,
    messageId: string,
    threadId?: string,
  ): Promise<void> {
    const raw = base64UrlDecode(rawBase64Url);
    const headers = parseBasicHeaders(raw);
    const snippet = extractSnippet(raw);

    const from = headers.get("from") ?? "";
    const to = headers.get("to") ?? "";
    const cc = headers.get("cc") ?? null;
    const subject = headers.get("subject") ?? null;
    const messageIdHeader = headers.get("message-id") ?? null;
    const inReplyTo = headers.get("in-reply-to") ?? null;
    const references = headers.get("references") ?? null;
    const now = Date.now();

    // For replies, add the SENT label to the existing thread.
    // For new compositions, create a new thread.
    const effectiveThreadId = threadId ?? messageId;

    if (threadId) {
      // Reply: add SENT label to existing thread
      const existingLabels = await getThreadLabelIds(this.accountId, threadId);
      if (!existingLabels.includes("SENT")) {
        const updated = [...existingLabels, "SENT"];
        await setThreadLabels(this.accountId, threadId, updated);
        await syncConversationLabelsToRemote(this.accountId, threadId, updated).catch(() => {});
      }
    } else {
      // New thread: create thread record
      await upsertThread({
        id: effectiveThreadId,
        accountId: this.accountId,
        subject,
        snippet,
        lastMessageAt: now,
        messageCount: 1,
        isRead: true,
        isStarred: false,
        isImportant: false,
        hasAttachments: false,
        isFiltered: true,
      });
      await setThreadLabels(this.accountId, effectiveThreadId, ["SENT"]);
      await syncConversationLabelsToRemote(this.accountId, effectiveThreadId, ["SENT"]).catch(() => {});
      await markEmailFiltered(this.accountId, effectiveThreadId, true).catch(() => {});
    }

    // Extract sender name from "Name <email>" format
    const fromNameMatch = from.match(/^([^<]*)<[^>]+>/);
    const fromName = fromNameMatch ? fromNameMatch[1]!.trim() : null;
    const fromAddress = from.replace(/.*<([^>]+)>.*/, "$1").trim();

    // Parse body for HTML and text
    const bodyStart = raw.indexOf("\r\n\r\n");
    const bodyHtml = bodyStart !== -1 ? raw.slice(bodyStart + 4) : null;

    await upsertMessage({
      id: messageId,
      accountId: this.accountId,
      threadId: effectiveThreadId,
      fromAddress,
      fromName,
      toAddresses: to,
      ccAddresses: cc,
      bccAddresses: null, // BCC is intentionally omitted from stored messages
      replyTo: null,
      subject,
      snippet,
      date: now,
      isRead: true,
      isStarred: false,
      bodyHtml: bodyHtml ? bodyHtml.slice(0, 50000) : null, // Limit stored body size
      bodyText: snippet,
      rawSize: raw.length,
      internalDate: now,
      messageIdHeader,
      referencesHeader: references,
      inReplyToHeader: inReplyTo,
    });
  }

  async createDraft(
    rawBase64Url: string,
    _threadId?: string,
  ): Promise<{ draftId: string }> {
    const config = await this.getImapConfig();
    const draftsFolder =
      (await findSpecialFolder(this.accountId, "\\Drafts")) ?? "Drafts";

    await imapAppendMessage(config, draftsFolder, rawBase64Url, "(\\Draft)");

    // IMAP APPEND does not return the new UID, so generate a pseudo draft ID
    const draftId = `imap-draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return { draftId };
  }

  async updateDraft(
    draftId: string,
    rawBase64Url: string,
    _threadId?: string,
  ): Promise<{ draftId: string }> {
    // Delete the old draft first, then create a new one
    try {
      await this.deleteDraft(draftId);
    } catch {
      // Old draft may already be gone; continue with creating the new one
    }

    return this.createDraft(rawBase64Url, _threadId);
  }

  async deleteDraft(draftId: string): Promise<void> {
    // Try to parse draft ID to get folder + UID info
    // Draft IDs from IMAP are in message ID format: imap-{accountId}-{folder}-{uid}
    const { folder, uid } = this.parseImapMessageId(draftId);

    if (uid !== null && folder) {
      const config = await this.getImapConfig();
      await imapDeleteMessages(config, folder, [uid]);
    } else {
      // Generated draft IDs (imap-draft-...) can't be mapped back to a server UID
      console.warn(
        `Draft ${draftId} has a generated ID and cannot be deleted from server. ` +
          "It will be cleaned up on next sync.",
      );
    }
  }

  // ---- Connection ----

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const imapConfig = await this.getImapConfig();
      const imapResult = await imapTestConnection(imapConfig);

      // Also test SMTP connectivity
      try {
        const smtpConfig = await this.getSmtpConfig();
        const smtpResult = await smtpTestConnection(smtpConfig);
        if (!smtpResult.success) {
          return {
            success: false,
            message: `IMAP OK, but SMTP failed: ${smtpResult.message}`,
          };
        }
      } catch (err) {
        return {
          success: false,
          message: `IMAP OK, but SMTP failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      return { success: true, message: `Connected: ${imapResult}` };
    } catch (err) {
      return {
        success: false,
        message: `IMAP connection failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async getProfile(): Promise<{ email: string; name?: string }> {
    const account = await this.getAccount();
    return {
      email: account.email,
      name: account.display_name ?? undefined,
    };
  }

  // ---- Helpers ----

  /**
   * Parse IMAP message IDs and group UIDs by folder.
   * Message ID format: imap-{accountId}-{folder}-{uid}
   * Since accountId can contain hyphens, we strip the known prefix
   * "imap-{this.accountId}-" and then parse the remaining "{folder}-{uid}".
   */
  private groupByFolder(messageIds: string[]): Map<string, number[]> {
    const grouped = new Map<string, number[]>();
    const prefix = `imap-${this.accountId}-`;

    for (const messageId of messageIds) {
      const { folder, uid } = this.parseImapMessageId(messageId, prefix);

      if (uid === null || !folder) {
        console.warn(`Skipping invalid IMAP message ID: ${messageId}`);
        continue;
      }

      const existing = grouped.get(folder);
      if (existing) {
        existing.push(uid);
      } else {
        grouped.set(folder, [uid]);
      }
    }

    return grouped;
  }

  /**
   * Parse an IMAP message ID into folder and uid.
   * Returns { folder, uid } or { folder: null, uid: null } if invalid.
   */
  private parseImapMessageId(
    messageId: string,
    prefix?: string,
  ): { folder: string | null; uid: number | null } {
    const p = prefix ?? `imap-${this.accountId}-`;

    if (!messageId.startsWith(p)) {
      return { folder: null, uid: null };
    }

    // After stripping prefix, remainder is "{folder}-{uid}"
    const remainder = messageId.slice(p.length);
    const lastDash = remainder.lastIndexOf("-");
    if (lastDash === -1) {
      return { folder: null, uid: null };
    }

    const folder = remainder.slice(0, lastDash);
    const uid = parseInt(remainder.slice(lastDash + 1), 10);

    if (!folder || isNaN(uid)) {
      return { folder: null, uid: null };
    }

    return { folder, uid };
  }
}
