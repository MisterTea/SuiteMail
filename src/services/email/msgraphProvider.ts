import type { EmailFolder, EmailProvider, SyncResult } from "./types";
import { getAccount } from "../db/accounts";
import { getDb } from "../db/connection";
import { deleteLabel, upsertLabel } from "../db/labels";
import { getMessagesForThread, relinkMessageId } from "../db/messages";
import { ensureFreshToken } from "../oauth/oauthTokenManager";
import {
  msgraphCreateDraftMime,
  msgraphCreateFolder,
  msgraphDeleteFolder,
  msgraphDeleteMessage,
  msgraphGetAttachment,
  msgraphGetMessage,
  msgraphGetProfile,
  msgraphGetRaw,
  msgraphListFolders,
  msgraphMoveMessage,
  msgraphRenameFolder,
  msgraphSendMime,
  msgraphUpdateFlags,
} from "../microsoft/graphCommands";
import {
  graphMessageToStored,
  graphMoveDestination,
  mapGraphFolder,
} from "../microsoft/graphModel";
import { graphFolderIdForLabel, syncGraphAccount } from "../microsoft/graphSync";

export class MsGraphProvider implements EmailProvider {
  readonly accountId: string;
  readonly type = "msgraph" as const;

  constructor(accountId: string) {
    this.accountId = accountId;
  }

  private async token(): Promise<string> {
    const account = await getAccount(this.accountId);
    if (!account) throw new Error("Account not found");
    return ensureFreshToken(account);
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
    const folderId = await graphFolderIdForLabel(this.accountId, onlyLabelId);
    if (!folderId) return chosen.map((row) => row.id);
    const inFolder = chosen.filter((row) => row.imap_folder === folderId);
    return (inFolder.length > 0 ? inFolder : chosen).map((row) => row.id);
  }

  private async moveAll(messageIds: string[], destination: string): Promise<void> {
    if (messageIds.length === 0) return;
    const token = await this.token();
    for (const messageId of messageIds) {
      const moved = await msgraphMoveMessage(token, messageId, destination);
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
    const token = await this.token();
    const db = await getDb();
    for (const messageId of messageIds) {
      await msgraphUpdateFlags(token, messageId, isRead, flagged);
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
    const folders = await msgraphListFolders(await this.token());
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
    const created = await msgraphCreateFolder(await this.token(), name);
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
    await msgraphDeleteFolder(await this.token(), path);
    await deleteLabel(this.accountId, path);
  }

  async renameFolder(path: string, newName: string): Promise<void> {
    await msgraphRenameFolder(await this.token(), path, newName);
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
    await syncGraphAccount(this.accountId, onProgress, daysBack);
    const account = await getAccount(this.accountId);
    return { messages: [], latestSyncToken: account?.history_id ?? undefined };
  }

  async deltaSync(syncToken: string): Promise<SyncResult> {
    await syncGraphAccount(this.accountId);
    const account = await getAccount(this.accountId);
    return {
      messages: [],
      latestSyncToken: account?.history_id ?? syncToken,
    };
  }

  async fetchMessage(messageId: string) {
    const stored = graphMessageToStored(
      await msgraphGetMessage(await this.token(), messageId),
    );
    return stored.parsed;
  }

  async fetchAttachment(messageId: string, attachmentId: string) {
    return msgraphGetAttachment(await this.token(), messageId, attachmentId);
  }

  async fetchRawMessage(messageId: string): Promise<string> {
    return msgraphGetRaw(await this.token(), messageId);
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
    const token = await this.token();
    for (const id of ids) {
      await msgraphDeleteMessage(token, id);
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
    if (labelId === "INBOX") {
      await this.archive(threadId, []);
    }
  }

  async sendMessage(rawBase64Url: string, _threadId?: string): Promise<{ id: string }> {
    return msgraphSendMime(await this.token(), rawBase64Url);
  }

  async createDraft(rawBase64Url: string, _threadId?: string): Promise<{ draftId: string }> {
    return msgraphCreateDraftMime(await this.token(), rawBase64Url);
  }

  async updateDraft(
    draftId: string,
    rawBase64Url: string,
    _threadId?: string,
  ): Promise<{ draftId: string }> {
    const token = await this.token();
    await msgraphDeleteMessage(token, draftId);
    return msgraphCreateDraftMime(token, rawBase64Url);
  }

  async deleteDraft(draftId: string): Promise<void> {
    await msgraphDeleteMessage(await this.token(), draftId);
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
    const profile = await msgraphGetProfile(await this.token());
    return { email: profile.email, name: profile.name ?? undefined };
  }
}
