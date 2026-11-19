import type { ParsedAttachment, ParsedMessage } from "../gmail/messageParser";

export interface GraphParty {
  name?: string | null;
  address?: string | null;
}

export interface GraphHeader {
  name: string;
  value: string;
}

export interface GraphAttachmentDto {
  id: string;
  name?: string | null;
  contentType?: string | null;
  size: number;
  isInline: boolean;
}

export interface GraphMessageDto {
  id: string;
  subject?: string | null;
  bodyPreview?: string | null;
  bodyContent?: string | null;
  bodyContentType?: string | null;
  from?: GraphParty | null;
  sender?: GraphParty | null;
  toRecipients?: GraphParty[];
  ccRecipients?: GraphParty[];
  bccRecipients?: GraphParty[];
  replyTo?: GraphParty[];
  receivedDateTime?: string | null;
  sentDateTime?: string | null;
  isRead?: boolean;
  isDraft?: boolean;
  hasAttachments?: boolean;
  internetMessageId?: string | null;
  headers?: GraphHeader[];
  importance?: string | null;
  flagStatus?: string | null;
  parentFolderId?: string | null;
  conversationId?: string | null;
  attachments?: GraphAttachmentDto[];
  inferenceClassification?: string | null;
}

export interface GraphFolderDto {
  id: string;
  displayName: string;
  parentFolderId?: string | null;
  wellKnownName?: string | null;
  unreadCount?: number;
  totalCount?: number;
}

export interface GraphStoredMessage {
  parsed: ParsedMessage;
  parentFolderId: string | null;
  messageIdHeader: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  isImportant: boolean;
  isDraft: boolean;
  isFocused: boolean;
}

const WELL_KNOWN_LABELS: Record<
  string,
  { labelId: string; name: string; specialUse: string }
> = {
  inbox: { labelId: "INBOX", name: "Inbox", specialUse: "\\Inbox" },
  sentitems: { labelId: "SENT", name: "Sent", specialUse: "\\Sent" },
  drafts: { labelId: "DRAFT", name: "Drafts", specialUse: "\\Drafts" },
  deleteditems: { labelId: "TRASH", name: "Trash", specialUse: "\\Trash" },
  junkemail: { labelId: "SPAM", name: "Spam", specialUse: "\\Junk" },
  archive: { labelId: "archive", name: "Archive", specialUse: "\\Archive" },
};

const MOVE_DESTINATIONS: Record<string, string> = {
  INBOX: "inbox",
  SENT: "sentitems",
  DRAFT: "drafts",
  TRASH: "deleteditems",
  SPAM: "junkemail",
  archive: "archive",
};

export function formatGraphAddress(party: GraphParty | null | undefined): string | null {
  const address = party?.address?.trim();
  const name = party?.name?.trim();
  if (address && name) return `${name} <${address}>`;
  return address || name || null;
}

export function formatGraphAddresses(
  parties: GraphParty[] | null | undefined,
): string | null {
  if (!parties || parties.length === 0) return null;
  const formatted = parties
    .map((party) => formatGraphAddress(party))
    .filter((value): value is string => !!value);
  return formatted.length > 0 ? formatted.join(", ") : null;
}

export function graphDateToUnixMs(iso: string | null | undefined): number {
  if (!iso) return Date.now();
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : Date.now();
}

/** UTC instant `daysBack` days ago, suitable for a Graph receivedDateTime filter. */
export function receivedAfterIso(daysBack: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - Math.max(0, daysBack));
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function headerValue(headers: GraphHeader[] | undefined, name: string): string | null {
  const found = headers?.find((header) => header.name.toLowerCase() === name.toLowerCase());
  return found?.value ?? null;
}

export function mapGraphFolder(folder: GraphFolderDto): {
  labelId: string;
  name: string;
  type: "system" | "user";
  specialUse: string | null;
} {
  const known = folder.wellKnownName
    ? WELL_KNOWN_LABELS[folder.wellKnownName.toLowerCase()]
    : undefined;
  if (known) {
    return {
      labelId: known.labelId,
      name: known.name,
      type: "system",
      specialUse: known.specialUse,
    };
  }
  return {
    labelId: folder.id,
    name: folder.displayName || "Folder",
    type: "user",
    specialUse: null,
  };
}

/** Well-known label ids become Graph folder names. Anything else is a folder id. */
export function graphMoveDestination(folderPath: string): string {
  return MOVE_DESTINATIONS[folderPath] ?? folderPath;
}

export function graphMessageToStored(message: GraphMessageDto): GraphStoredMessage {
  const from = message.from ?? message.sender ?? null;
  const contentType = (message.bodyContentType ?? "").toLowerCase();
  const content = message.bodyContent ?? null;
  const bodyHtml = contentType === "html" ? content : null;
  const bodyText = contentType === "html" ? null : content;
  const attachments: ParsedAttachment[] = (message.attachments ?? []).map((attachment) => ({
    filename: attachment.name || "attachment",
    mimeType: attachment.contentType || "application/octet-stream",
    size: attachment.size ?? 0,
    gmailAttachmentId: attachment.id,
    contentId: null,
    isInline: attachment.isInline,
  }));
  const date = graphDateToUnixMs(message.receivedDateTime ?? message.sentDateTime);
  const parsed: ParsedMessage = {
    id: message.id,
    threadId: message.conversationId || message.id,
    fromAddress: from?.address?.trim() || null,
    fromName: from?.name?.trim() || null,
    toAddresses: formatGraphAddresses(message.toRecipients),
    ccAddresses: formatGraphAddresses(message.ccRecipients),
    bccAddresses: formatGraphAddresses(message.bccRecipients),
    replyTo: formatGraphAddresses(message.replyTo),
    subject: message.subject ?? null,
    snippet: message.bodyPreview ?? "",
    date,
    isRead: message.isRead ?? false,
    isStarred: message.flagStatus === "flagged",
    bodyHtml,
    bodyText,
    rawSize: content?.length ?? 0,
    internalDate: date,
    labelIds: [],
    hasAttachments: message.hasAttachments ?? attachments.length > 0,
    attachments,
    listUnsubscribe: headerValue(message.headers, "List-Unsubscribe"),
    listUnsubscribePost: headerValue(message.headers, "List-Unsubscribe-Post"),
    authResults: null,
  };
  const isFocused = (message.inferenceClassification ?? "").toLowerCase() === "focused";
  return {
    parsed,
    parentFolderId: message.parentFolderId ?? null,
    messageIdHeader: message.internetMessageId ?? null,
    inReplyTo: headerValue(message.headers, "In-Reply-To"),
    referencesHeader: headerValue(message.headers, "References"),
    isImportant: message.importance === "high",
    isDraft: message.isDraft ?? false,
    isFocused,
  };
}

export function labelIdForFolder(
  parentFolderId: string | null,
  folderLabelByGraphId: Map<string, string>,
): string | null {
  if (!parentFolderId) return null;
  return folderLabelByGraphId.get(parentFolderId) ?? parentFolderId;
}
