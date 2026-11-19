/**
 * Gmail system labels that Gmail shows in the main sidebar, beyond the
 * folders every account already has (Inbox, Starred, Sent, and so on).
 * Category rows are inbox mail that still carries that CATEGORY_* label.
 */
export interface GmailNavSpec {
  id: string;
  label: string;
  gmailLabelId: string;
  /** "after-snoozed" sits with the system folders. "after-mail" sits under them. */
  placement: "after-snoozed" | "after-mail";
  /** Gmail category views only list mail that is still in the inbox. */
  inboxOnly: boolean;
  showUnreadCount: boolean;
}

export const GMAIL_NAV_SPECS: GmailNavSpec[] = [
  { id: "important", label: "Important", gmailLabelId: "IMPORTANT", placement: "after-snoozed", inboxOnly: false, showUnreadCount: false },
  { id: "purchases", label: "Purchases", gmailLabelId: "CATEGORY_PURCHASES", placement: "after-mail", inboxOnly: true, showUnreadCount: true },
  { id: "social", label: "Social", gmailLabelId: "CATEGORY_SOCIAL", placement: "after-mail", inboxOnly: true, showUnreadCount: true },
  { id: "updates", label: "Updates", gmailLabelId: "CATEGORY_UPDATES", placement: "after-mail", inboxOnly: true, showUnreadCount: true },
  { id: "forums", label: "Forums", gmailLabelId: "CATEGORY_FORUMS", placement: "after-mail", inboxOnly: true, showUnreadCount: true },
  { id: "promotions", label: "Promotions", gmailLabelId: "CATEGORY_PROMOTIONS", placement: "after-mail", inboxOnly: true, showUnreadCount: true },
];

const GMAIL_NAV_BY_ID = new Map(GMAIL_NAV_SPECS.map((spec) => [spec.id, spec]));

/** Mail folders that the category block follows. */
const MAIL_ANCHOR_IDS = new Set([
  "inbox",
  "starred",
  "snoozed",
  "important",
  "sent",
  "drafts",
  "trash",
  "spam",
  "all",
]);

export function isGmailProvider(provider: string | null | undefined): boolean {
  return provider === "gmail_api";
}

export function gmailNavSpec(id: string): GmailNavSpec | undefined {
  return GMAIL_NAV_BY_ID.get(id);
}

/**
 * Insert Gmail's extra sidebar labels into an existing nav id list.
 * Important follows Snoozed (or Starred, or Inbox). Categories follow the
 * last system mail folder, in Gmail's order.
 */
export function insertGmailNavIds(navIds: string[]): string[] {
  const result = [...navIds];
  if (!result.includes("important")) {
    const snoozedAt = result.indexOf("snoozed");
    const starredAt = result.indexOf("starred");
    const inboxAt = result.indexOf("inbox");
    const at = snoozedAt >= 0 ? snoozedAt + 1 : starredAt >= 0 ? starredAt + 1 : inboxAt >= 0 ? inboxAt + 1 : 0;
    result.splice(at, 0, "important");
  }

  const missing = GMAIL_NAV_SPECS
    .filter((spec) => spec.placement === "after-mail" && !result.includes(spec.id))
    .map((spec) => spec.id);
  if (missing.length === 0) return result;

  let anchor = -1;
  for (let i = 0; i < result.length; i++) {
    const id = result[i];
    if (id && MAIL_ANCHOR_IDS.has(id)) anchor = i;
  }
  result.splice(anchor + 1, 0, ...missing);
  return result;
}

/** Label ids to query for a Gmail sidebar row. Category rows also require INBOX. */
export function gmailViewLabelIds(id: string): string[] | null {
  const spec = gmailNavSpec(id);
  if (!spec) return null;
  return spec.inboxOnly ? ["INBOX", spec.gmailLabelId] : [spec.gmailLabelId];
}
