export const SETTINGS_GROUPS = {
  general: { label: "General", firstTab: "general" },
  mailbox: { label: "Mailbox", firstTab: "notifications" },
} as const;

const mailboxTabs = new Set(["notifications", "composing", "mail-rules", "people", "mailbox-ai"]);

export function getSettingsGroup(tab?: string): keyof typeof SETTINGS_GROUPS {
  return tab && mailboxTabs.has(tab) ? "mailbox" : "general";
}
