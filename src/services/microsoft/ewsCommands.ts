import { platformInvoke as invoke } from "@/platform";
import type { GraphFolderDto, GraphMessageDto } from "./graphModel";

export interface EwsSyncPage {
  messages: GraphMessageDto[];
  removedIds: string[];
  checkpoint: string;
  caughtUp: boolean;
}

export interface EwsMoveResult {
  id: string;
  parentFolderId?: string | null;
}

function asError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(typeof err === "string" ? err : String(err ?? "Exchange request failed"));
}

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    throw asError(err);
  }
}

export function isEwsSyncReset(err: unknown): boolean {
  return asError(err).message.includes("EWS_SYNC_RESET");
}

export function ewsPing(token: string, anchor: string): Promise<void> {
  return call("ews_ping", { token, anchor });
}

export function ewsListFolders(token: string, anchor: string): Promise<GraphFolderDto[]> {
  return call("ews_list_folders", { token, anchor });
}

export function ewsSyncPage(
  token: string,
  anchor: string,
  checkpoint: string | null,
  receivedAfter: string | null,
  limit = 40,
): Promise<EwsSyncPage> {
  return call("ews_sync_page", {
    token,
    anchor,
    checkpoint: checkpoint ?? "",
    receivedAfter,
    limit,
  });
}

export function ewsGetMessage(
  token: string,
  anchor: string,
  messageId: string,
): Promise<GraphMessageDto> {
  return call("ews_get_message", { token, anchor, messageId });
}

export function ewsGetRaw(token: string, anchor: string, messageId: string): Promise<string> {
  return call("ews_get_raw", { token, anchor, messageId });
}

export function ewsGetAttachment(
  token: string,
  anchor: string,
  attachmentId: string,
): Promise<{ data: string; size: number }> {
  return call("ews_get_attachment", { token, anchor, attachmentId });
}

export function ewsMoveMessage(
  token: string,
  anchor: string,
  messageId: string,
  destination: string,
): Promise<EwsMoveResult> {
  return call("ews_move_message", { token, anchor, messageId, destination });
}

export function ewsUpdateFlags(
  token: string,
  anchor: string,
  messageId: string,
  isRead: boolean | null,
  flagged: boolean | null,
): Promise<void> {
  return call("ews_update_flags", { token, anchor, messageId, isRead, flagged });
}

export function ewsSetFocused(
  token: string,
  anchor: string,
  messageId: string,
  focused: boolean,
): Promise<void> {
  return call("ews_set_focused", { token, anchor, messageId, focused });
}

export function ewsDeleteMessage(token: string, anchor: string, messageId: string): Promise<void> {
  return call("ews_delete_message", { token, anchor, messageId });
}

export function ewsSendMime(
  token: string,
  anchor: string,
  rawBase64Url: string,
): Promise<{ id: string }> {
  return call("ews_send_mime", { token, anchor, rawBase64Url });
}

export function ewsCreateDraftMime(
  token: string,
  anchor: string,
  rawBase64Url: string,
): Promise<{ draftId: string }> {
  return call("ews_create_draft_mime", { token, anchor, rawBase64Url });
}

export function ewsSendDraft(
  token: string,
  anchor: string,
  messageId: string,
): Promise<{ id: string }> {
  return call("ews_send_draft", { token, anchor, messageId });
}

export function ewsCreateFolder(
  token: string,
  anchor: string,
  name: string,
): Promise<GraphFolderDto> {
  return call("ews_create_folder", { token, anchor, name });
}

export function ewsRenameFolder(
  token: string,
  anchor: string,
  folderId: string,
  name: string,
): Promise<void> {
  return call("ews_rename_folder", { token, anchor, folderId, name });
}

export function ewsDeleteFolder(token: string, anchor: string, folderId: string): Promise<void> {
  return call("ews_delete_folder", { token, anchor, folderId });
}
