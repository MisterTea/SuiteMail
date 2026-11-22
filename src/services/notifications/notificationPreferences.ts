import { getSetting, setSetting } from "../db/settings";

export interface AccountNotificationPreferences {
  enabled: boolean;
  quiet: boolean;
  start: string;
  end: string;
  vipBypass: boolean;
  digest: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: AccountNotificationPreferences = {
  enabled: true,
  quiet: false,
  start: "18:00",
  end: "09:00",
  vipBypass: true,
  digest: true,
};

const preferenceKey = (accountId: string) => `mail_notification_schedule:${accountId}`;

export async function getAccountNotificationPreferences(accountId: string): Promise<AccountNotificationPreferences> {
  const saved = await getSetting(preferenceKey(accountId));
  return saved ? { ...DEFAULT_NOTIFICATION_PREFERENCES, ...JSON.parse(saved) } : { ...DEFAULT_NOTIFICATION_PREFERENCES };
}

export const saveAccountNotificationPreferences = (accountId: string, value: AccountNotificationPreferences) =>
  setSetting(preferenceKey(accountId), JSON.stringify(value));

export function isDuringQuietHours(value: AccountNotificationPreferences, date = new Date()): boolean {
  if (!value.quiet || value.start === value.end) return false;
  const now = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return value.start < value.end
    ? now >= value.start && now < value.end
    : now >= value.start || now < value.end;
}
