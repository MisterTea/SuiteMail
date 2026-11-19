import { platformInvoke as invoke } from "@/platform";
import type { GraphFolderDto, GraphMessageDto } from "./graphModel";

export interface GraphProfile {
  email: string;
  name?: string | null;
}

export interface GraphSyncPage {
  messages: GraphMessageDto[];
  removedIds: string[];
  nextLink?: string | null;
  deltaLink?: string | null;
}

export interface GraphMoveResult {
  id: string;
  parentFolderId?: string | null;
}

function asError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(typeof err === "string" ? err : String(err ?? "Graph request failed"));
}

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    throw asError(err);
  }
}

export function isDeltaExpired(err: unknown): boolean {
  return asError(err).message.includes("DELTA_EXPIRED");
}

export function msgraphGetProfile(token: string): Promise<GraphProfile> {
  return call("msgraph_get_profile", { token });
}

export function msgraphListFolders(token: string): Promise<GraphFolderDto[]> {
  return call("msgraph_list_folders", { token });
}

export function msgraphSyncPage(
  token: string,
  link: string | null,
  receivedAfter: string | null,
  limit = 40,
): Promise<GraphSyncPage> {
  return call("msgraph_sync_page", { token, link, receivedAfter, limit });
}

export function msgraphGetMessage(token: string, messageId: string): Promise<GraphMessageDto> {
  return call("msgraph_get_message", { token, messageId });
}

export function msgraphGetRaw(token: string, messageId: string): Promise<string> {
  return call("msgraph_get_raw", { token, messageId });
}

export function msgraphGetAttachment(
  token: string,
  messageId: string,
  attachmentId: string,
): Promise<{ data: string; size: number }> {
  return call("msgraph_get_attachment", { token, messageId, attachmentId });
}

export function msgraphMoveMessage(
  token: string,
  messageId: string,
  destination: string,
): Promise<GraphMoveResult> {
  return call("msgraph_move_message", { token, messageId, destination });
}

export function msgraphUpdateFlags(
  token: string,
  messageId: string,
  isRead: boolean | null,
  flagged: boolean | null,
): Promise<void> {
  return call("msgraph_update_flags", { token, messageId, isRead, flagged });
}

export function msgraphDeleteMessage(token: string, messageId: string): Promise<void> {
  return call("msgraph_delete_message", { token, messageId });
}

export function msgraphSendMime(token: string, rawBase64Url: string): Promise<{ id: string }> {
  return call("msgraph_send_mime", { token, rawBase64Url });
}

export function msgraphCreateDraftMime(
  token: string,
  rawBase64Url: string,
): Promise<{ draftId: string }> {
  return call("msgraph_create_draft_mime", { token, rawBase64Url });
}

export function msgraphSendDraft(token: string, messageId: string): Promise<{ id: string }> {
  return call("msgraph_send_draft", { token, messageId });
}

export function msgraphCreateFolder(token: string, name: string): Promise<GraphFolderDto> {
  return call("msgraph_create_folder", { token, name });
}

export function msgraphRenameFolder(
  token: string,
  folderId: string,
  name: string,
): Promise<void> {
  return call("msgraph_rename_folder", { token, folderId, name });
}

export function msgraphDeleteFolder(token: string, folderId: string): Promise<void> {
  return call("msgraph_delete_folder", { token, folderId });
}
