import type { ImapFolder } from "./electronCommands";
import { upsertLabel } from "../db/labels";

/**
 * Mapping from IMAP special-use flags to Gmail-style label IDs.
 */
const SPECIAL_USE_MAP: Record<string, { labelId: string; labelName: string; type: string }> = {
  "\\Inbox": { labelId: "INBOX", labelName: "Inbox", type: "system" },
  "\\Sent": { labelId: "SENT", labelName: "Sent", type: "system" },
  "\\Drafts": { labelId: "DRAFT", labelName: "Drafts", type: "system" },
  "\\Trash": { labelId: "TRASH", labelName: "Trash", type: "system" },
  "\\Junk": { labelId: "SPAM", labelName: "Spam", type: "system" },
  "\\Archive": { labelId: "archive", labelName: "Archive", type: "system" },
  "\\Flagged": { labelId: "STARRED", labelName: "Starred", type: "system" },
  "\\All": { labelId: "all-mail", labelName: "All Mail", type: "system" },
  "\\Important": { labelId: "IMPORTANT", labelName: "Important", type: "system" },
};

/**
 * Well-known folder names (case-insensitive) for servers that don't
 * report special-use attributes.
 */
const FOLDER_NAME_MAP: Record<string, string> = {
  inbox: "\\Inbox",
  sent: "\\Sent",
  "sent items": "\\Sent",
  "sent mail": "\\Sent",
  drafts: "\\Drafts",
  draft: "\\Drafts",
  draftbox: "\\Drafts",
  brouillons: "\\Drafts",
  trash: "\\Trash",
  "deleted items": "\\Trash",
  "deleted messages": "\\Trash",
  bin: "\\Trash",
  corbeille: "\\Trash",
  unsolbox: "\\Trash",
  junk: "\\Junk",
  "junk e-mail": "\\Junk",
  spam: "\\Junk",
  archive: "\\Archive",
  archives: "\\Archive",
  flagged: "\\Flagged",
  starred: "\\Flagged",
  "all mail": "\\All",
  "[gmail]/all mail": "\\All",
  "[gmail]/sent mail": "\\Sent",
  "[gmail]/drafts": "\\Drafts",
  "[gmail]/spam": "\\Junk",
  "[gmail]/trash": "\\Trash",
  "[gmail]/starred": "\\Flagged",
  "[gmail]/important": "\\Important",
  "[google mail]/all mail": "\\All",
  "[google mail]/sent mail": "\\Sent",
  "[google mail]/drafts": "\\Drafts",
  "[google mail]/spam": "\\Junk",
  "[google mail]/trash": "\\Trash",
  "[google mail]/starred": "\\Flagged",
  "[google mail]/important": "\\Important",
};

export interface FolderLabelMapping {
  labelId: string;
  labelName: string;
  type: string;
}

/**
 * Map an IMAP folder to a Gmail-style label.
 * Uses special-use attributes first, then falls back to folder name matching,
 * and finally uses a user-folder prefix for unrecognized folders.
 */
export function mapFolderToLabel(folder: ImapFolder): FolderLabelMapping {
  // Check special-use attribute first
  if (folder.special_use) {
    const mapping = SPECIAL_USE_MAP[folder.special_use];
    if (mapping) {
      return mapping;
    }
  }

  // Fall back to name-based detection
  const lowerPath = folder.path.toLowerCase();
  const lowerName = folder.name.toLowerCase();

  const specialUse = FOLDER_NAME_MAP[lowerPath] ?? FOLDER_NAME_MAP[lowerName];
  if (specialUse) {
    const mapping = SPECIAL_USE_MAP[specialUse];
    if (mapping) {
      return mapping;
    }
  }

  // User-defined folder
  return {
    labelId: `folder-${folder.path}`,
    labelName: folder.name,
    type: "user",
  };
}

/**
 * Get the label IDs that a message in a given folder should have.
 * For example, a message in INBOX that is flagged (starred) would get
 * ["INBOX", "STARRED"].
 */
export function getLabelsForMessage(
  folderMapping: FolderLabelMapping,
  isRead: boolean,
  isStarred: boolean,
  isDraft: boolean,
): string[] {
  const labels: string[] = [folderMapping.labelId];

  if (!isRead) {
    labels.push("UNREAD");
  }

  if (isStarred) {
    labels.push("STARRED");
  }

  if (isDraft) {
    labels.push("DRAFT");
  }

  return labels;
}

/**
 * Sync IMAP folders to the labels table in the DB.
 * Creates/updates label entries for each folder.
 */
export async function syncFoldersToLabels(
  accountId: string,
  folders: ImapFolder[],
): Promise<void> {
  for (const folder of folders) {
    const mapping = mapFolderToLabel(folder);
    await upsertLabel({
      id: mapping.labelId,
      accountId,
      name: mapping.labelName,
      type: mapping.type,
      imapFolderPath: folder.raw_path,
      imapSpecialUse: folder.special_use,
    });
  }

  // Also ensure the UNREAD pseudo-label exists
  await upsertLabel({
    id: "UNREAD",
    accountId,
    name: "Unread",
    type: "system",
  });
}

export const METADATA_SIDECAR_FOLDER = ".metadata";
export const SETTINGS_SIDECAR_FOLDER = ".settings";
export const SETTINGS_GENERAL_FOLDER = ".settings/general";
export const SETTINGS_FILTERS_FOLDER = ".settings/filters";

/**
 * Check whether a folder path represents the hidden metadata sidecar folder.
 */
export function isSidecarFolder(path: string): boolean {
  const lower = path.toLowerCase().trim();
  return (
    lower === METADATA_SIDECAR_FOLDER ||
    lower === "metadata" ||
    lower.endsWith("/" + METADATA_SIDECAR_FOLDER) ||
    lower.endsWith("." + METADATA_SIDECAR_FOLDER)
  );
}

/**
 * Check whether a folder path represents a settings sidecar folder (.settings, .settings/general, .settings/filters).
 */
export function isSettingsFolder(path: string): boolean {
  const lower = path.toLowerCase().trim();
  return (
    lower === SETTINGS_SIDECAR_FOLDER ||
    lower === "settings" ||
    lower === SETTINGS_GENERAL_FOLDER ||
    lower === "settings/general" ||
    lower === ".settings.general" ||
    lower === SETTINGS_FILTERS_FOLDER ||
    lower === "settings/filters" ||
    lower === ".settings.filters" ||
    lower.startsWith(".settings/") ||
    lower.startsWith("settings/") ||
    lower.startsWith(".settings.") ||
    lower.startsWith("settings.") ||
    lower.endsWith("/" + SETTINGS_SIDECAR_FOLDER) ||
    lower.endsWith(".settings") ||
    lower.includes("/.settings/") ||
    lower.includes("/settings/") ||
    lower.includes(".settings.")
  );
}

/**
 * Determine which folders should be synced during initial sync.
 * Excludes special folders like [Gmail] parent folder and the hidden metadata sidecar folder.
 */
export function getSyncableFolders(folders: ImapFolder[]): ImapFolder[] {
  return folders.filter((f) => {
    const lowerPath = f.path.toLowerCase();
    // Skip the Gmail parent container folder
    if (lowerPath === "[gmail]" || lowerPath === "[google mail]") return false;
    // Skip Nostromo-style virtual folders
    if (lowerPath.startsWith("[nostromo]")) return false;
    // Skip the metadata sidecar folder
    if (isSidecarFolder(f.path) || isSidecarFolder(f.name)) return false;
    // Skip the settings sidecar folders (.settings, .settings/general, .settings/filters)
    if (isSettingsFolder(f.path) || isSettingsFolder(f.name)) return false;
    return true;
  });
}
