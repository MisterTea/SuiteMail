import { getSetting, setSetting } from "@/services/db/settings";

export type MailboxAiBooleanKey =
  | "ai_enabled"
  | "ai_auto_categorize"
  | "ai_auto_summarize"
  | "ai_auto_draft_enabled"
  | "ai_writing_style_enabled";

export type MailboxAiSettingKey = MailboxAiBooleanKey | "auto_archive_categories";

export interface MailboxAiSettings {
  aiEnabled: boolean;
  aiAutoCategorize: boolean;
  aiAutoSummarize: boolean;
  aiAutoDraftEnabled: boolean;
  aiWritingStyleEnabled: boolean;
  autoArchiveCategories: Set<string>;
}

export function mailboxAiSettingKey(key: MailboxAiSettingKey, accountId: string): string {
  return `${key}:${accountId}`;
}

export function isMailboxAiSettingChange(
  changedKey: string,
  baseKey: MailboxAiSettingKey,
  accountId?: string | null,
): boolean {
  return changedKey === baseKey || (!!accountId && changedKey === mailboxAiSettingKey(baseKey, accountId));
}

/**
 * Read a mailbox-specific AI setting. Falls back to the legacy global key
 * when the mailbox does not have an explicit override yet.
 */
export async function getMailboxAiSetting(
  key: MailboxAiSettingKey,
  accountId?: string | null,
): Promise<string | null> {
  if (accountId) {
    const scoped = await getSetting(mailboxAiSettingKey(key, accountId));
    if (scoped !== null) return scoped;
  }
  return getSetting(key);
}

export async function setMailboxAiSetting(
  accountId: string,
  key: MailboxAiSettingKey,
  value: string,
): Promise<void> {
  await setSetting(mailboxAiSettingKey(key, accountId), value);
}

export async function getMailboxAiBoolean(
  key: MailboxAiBooleanKey,
  accountId?: string | null,
): Promise<boolean> {
  const value = await getMailboxAiSetting(key, accountId);
  return value !== "false";
}

export async function setMailboxAiBoolean(
  accountId: string,
  key: MailboxAiBooleanKey,
  enabled: boolean,
): Promise<void> {
  await setMailboxAiSetting(accountId, key, enabled ? "true" : "false");
}

export async function getMailboxAutoArchiveCategories(
  accountId?: string | null,
): Promise<Set<string>> {
  const raw = await getMailboxAiSetting("auto_archive_categories", accountId);
  if (!raw) return new Set();
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

export async function setMailboxAutoArchiveCategories(
  accountId: string,
  categories: Iterable<string>,
): Promise<void> {
  await setMailboxAiSetting(accountId, "auto_archive_categories", [...categories].join(","));
}

export async function loadMailboxAiSettings(accountId: string): Promise<MailboxAiSettings> {
  const [
    aiEnabled,
    aiAutoCategorize,
    aiAutoSummarize,
    aiAutoDraftEnabled,
    aiWritingStyleEnabled,
    autoArchiveCategories,
  ] = await Promise.all([
    getMailboxAiBoolean("ai_enabled", accountId),
    getMailboxAiBoolean("ai_auto_categorize", accountId),
    getMailboxAiBoolean("ai_auto_summarize", accountId),
    getMailboxAiBoolean("ai_auto_draft_enabled", accountId),
    getMailboxAiBoolean("ai_writing_style_enabled", accountId),
    getMailboxAutoArchiveCategories(accountId),
  ]);

  return {
    aiEnabled,
    aiAutoCategorize,
    aiAutoSummarize,
    aiAutoDraftEnabled,
    aiWritingStyleEnabled,
    autoArchiveCategories,
  };
}
