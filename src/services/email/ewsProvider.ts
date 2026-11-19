import type { EmailFolder, EmailProvider, SyncResult } from "./types";
import { getAccount } from "../db/accounts";
import { getDb } from "../db/connection";
import { deleteLabel, upsertLabel } from "../db/labels";
import { getMessagesForThread, relinkMessageId } from "../db/messages";
import { ensureFreshToken } from "../oauth/oauthTokenManager";
import {
  ewsCreateDraftMime,
  ewsCreateFolder,
  ewsDeleteFolder,
  ewsDeleteMessage,
  ewsGetAttachment,
  ewsGetMessage,
  ewsGetRaw,
  ewsListFolders,
  ewsMoveMessage,
  ewsPing,
  ewsRenameFolder,
  ewsSendMime,
  ewsSetFocused,
  ewsUpdateFlags,
} from "../microsoft/ewsCommands";
import { graphMessageToStored, graphMoveDestination, mapGraphFolder } from "../microsoft/graphModel";
import { ewsFolderIdForLabel, syncEwsAccount } from "../microsoft/ewsSync";

export class EwsProvider implements EmailProvider {
  readonly accountId: string;
  readonly type = "ews" as const;

  constructor(accountId: string) {
    this.accountId = accountId;
  }

  private async session(): Promise<{ token: string; email: string }> {
    const account = await getAccount(this.accountId);
    if (!account) throw new Error("Account not found");
    return { token: await ensureFreshToken(account), email: account.email };
  }

  private async messageIds(
    threadId: string,
    messageIds: string[],
    onlyLabelId?: string,
  ): Promise<string[]> {
    const rows = await getMessagesForThread(this.accountId, threadId);
    const chosen = messageIds.length > 0
      ? rows.filter((row) => messageIds.includes(row.id))
      : rows;
    if (!onlyLabelId) return chosen.map((row) => row.id);
    const folderId = await ewsFolderIdForLabel(this.accountId, onlyLabelId);
    if (!folderId) return chosen.map((row) => row.id);
    const inFolder = chosen.filter((row) => row.imap_folder === folderId);
    return (inFolder.length > 0 ? inFolder : chosen).map((row) => row.id);
  }

  private async moveAll(messageIds: string[], destination: string): Promise<void> {
    if (messageIds.length === 0) return;
    const { token, email } = await this.session();
    for (const messageId of messageIds) {
      const moved = await ewsMoveMessage(token, email, messageId, destination);
      await relinkMessageId(
        this.accountId,
        messageId,
        moved.id,
        moved.parentFolderId ?? null,
      );
    }
  }

  private async setFlag(
    messageIds: string[],
    isRead: boolean | null,
    flagged: boolean | null,
  ): Promise<void> {
    if (messageIds.length === 0) return;
    const { token, email } = await this.session();
    const db = await getDb();
    for (const messageId of messageIds) {
      await ewsUpdateFlags(token, email, messageId, isRead, flagged);
      if (isRead !== null) {
        await db.execute(
          "UPDATE messages SET is_read = $1 WHERE account_id = $2 AND id = $3",
          [isRead ? 1 : 0, this.accountId, messageId],
        );
      }
      if (flagged !== null) {
        await db.execute(
          "UPDATE messages SET is_starred = $1 WHERE account_id = $2 AND id = $3",
          [flagged ? 1 : 0, this.accountId, messageId],
        );
      }
    }
  }

  async listFolders(): Promise<EmailFolder[]> {
    const { token, email } = await this.session();
    const folders = await ewsListFolders(token, email);
    return folders.map((folder) => {
      const mapped = mapGraphFolder(folder);
      return {
        id: folder.id,
        name: mapped.name,
        path: folder.id,
        type: mapped.type,
        specialUse: mapped.specialUse,
        delimiter: "/",
        messageCount: folder.totalCount ?? 0,
        unreadCount: folder.unreadCount ?? 0,
      };
    });
  }

  async createFolder(name: string, _parentPath?: string): Promise<EmailFolder> {
    const { token, email } = await this.session();
    const created = await ewsCreateFolder(token, email, name);
    await upsertLabel({
      id: created.id,
      accountId: this.accountId,
      name: created.displayName || name,
      type: "user",
      imapFolderPath: created.id,
    });
    return {
      id: created.id,
      name: created.displayName || name,
      path: created.id,
      type: "user",
      specialUse: null,
      delimiter: "/",
      messageCount: 0,
      unreadCount: 0,
    };
  }

  async deleteFolder(path: string): Promise<void> {
    const { token, email } = await this.session();
    await ewsDeleteFolder(token, email, path);
    await deleteLabel(this.accountId, path);
  }

  async renameFolder(path: string, newName: string): Promise<void> {
    const { token, email } = await this.session();
    await ewsRenameFolder(token, email, path, newName);
    await upsertLabel({
      id: path,
      accountId: this.accountId,
      name: newName,
      type: "user",
      imapFolderPath: path,
    });
  }

  async initialSync(
    daysBack: number,
    onProgress?: (phase: string, current: number, total: number) => void,
  ): Promise<SyncResult> {
    await syncEwsAccount(this.accountId, onProgress, daysBack);
    const account = await getAccount(this.accountId);
    return { messages: [], latestSyncToken: account?.history_id ?? undefined };
  }

  async deltaSync(syncToken: string): Promise<SyncResult> {
    await syncEwsAccount(this.accountId);
    const account = await getAccount(this.accountId);
    return {
      messages: [],
      latestSyncToken: account?.history_id ?? syncToken,
    };
  }

  async fetchMessage(messageId: string) {
    const { token, email } = await this.session();
    return graphMessageToStored(await ewsGetMessage(token, email, messageId)).parsed;
  }

  async fetchAttachment(_messageId: string, attachmentId: string) {
    const { token, email } = await this.session();
    return ewsGetAttachment(token, email, attachmentId);
  }

  async fetchRawMessage(messageId: string): Promise<string> {
    const { token, email } = await this.session();
    return ewsGetRaw(token, email, messageId);
  }

  async archive(threadId: string, messageIds: string[]): Promise<void> {
    const ids = await this.messageIds(threadId, messageIds, "INBOX");
    await this.moveAll(ids, "archive");
  }

  async trash(threadId: string, messageIds: string[]): Promise<void> {
    const ids = await this.messageIds(threadId, messageIds, "INBOX");
    await this.moveAll(ids, "deleteditems");
  }

  async permanentDelete(threadId: string, messageIds: string[]): Promise<void> {
    const ids = messageIds.length > 0
      ? messageIds
      : await this.messageIds(threadId, []);
    if (ids.length === 0) return;
    const { token, email } = await this.session();
    for (const id of ids) {
      await ewsDeleteMessage(token, email, id);
    }
  }

  async markRead(threadId: string, messageIds: string[], read: boolean): Promise<void> {
    const ids = await this.messageIds(threadId, messageIds);
    await this.setFlag(ids, read, null);
  }

  async star(threadId: string, messageIds: string[], starred: boolean): Promise<void> {
    const ids = await this.messageIds(threadId, messageIds);
    await this.setFlag(ids, null, starred);
  }

  async spam(threadId: string, messageIds: string[], isSpam: boolean): Promise<void> {
    const ids = await this.messageIds(threadId, messageIds, isSpam ? "INBOX" : "SPAM");
    await this.moveAll(ids, isSpam ? "junkemail" : "inbox");
  }

  async moveToFolder(threadId: string, messageIds: string[], folderPath: string): Promise<void> {
    const ids = await this.messageIds(threadId, messageIds);
    await this.moveAll(ids, graphMoveDestination(folderPath));
  }

  async addLabel(threadId: string, labelId: string): Promise<void> {
    if (labelId === "FOCUSED") {
      const ids = await this.messageIds(threadId, []);
      const { token, email } = await this.session();
      for (const id of ids) {
        await ewsSetFocused(token, email, id, true);
      }
      return;
    }
    if (labelId === "INBOX") {
      await this.moveToFolder(threadId, [], "INBOX");
      return;
    }
    if (labelId === "TRASH" || labelId === "SPAM" || labelId === "archive") {
      await this.moveToFolder(threadId, [], labelId);
      return;
    }
    if (labelId === "STARRED" || labelId === "UNREAD") return;
    await this.moveToFolder(threadId, [], labelId);
  }

  async removeLabel(threadId: string, labelId: string): Promise<void> {
    if (labelId === "FOCUSED") {
      const ids = await this.messageIds(threadId, []);
      const { token, email } = await this.session();
      for (const id of ids) {
        await ewsSetFocused(token, email, id, false);
      }
      return;
    }
    if (labelId === "INBOX") {
      await this.archive(threadId, []);
    }
  }

  async sendMessage(rawBase64Url: string, _threadId?: string): Promise<{ id: string }> {
    const { token, email } = await this.session();
    return ewsSendMime(token, email, rawBase64Url);
  }

  async createDraft(rawBase64Url: string, _threadId?: string): Promise<{ draftId: string }> {
    const { token, email } = await this.session();
    return ewsCreateDraftMime(token, email, rawBase64Url);
  }

  async updateDraft(
    draftId: string,
    rawBase64Url: string,
    _threadId?: string,
  ): Promise<{ draftId: string }> {
    const { token, email } = await this.session();
    await ewsDeleteMessage(token, email, draftId);
    return ewsCreateDraftMime(token, email, rawBase64Url);
  }

  async deleteDraft(draftId: string): Promise<void> {
    const { token, email } = await this.session();
    await ewsDeleteMessage(token, email, draftId);
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const profile = await this.getProfile();
      return { success: true, message: `Connected as ${profile.email}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, message };
    }
  }

  async getProfile(): Promise<{ email: string; name?: string }> {
    const account = await getAccount(this.accountId);
    if (!account) throw new Error("Account not found");
    const token = await ensureFreshToken(account);
    await ewsPing(token, account.email);
    return { email: account.email, name: account.display_name ?? undefined };
  }
}
