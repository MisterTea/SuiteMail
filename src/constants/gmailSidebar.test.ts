import { describe, expect, it } from "vitest";
import { gmailViewLabelIds, insertGmailNavIds, isGmailProvider } from "./gmailSidebar";

const BASE = ["inbox", "starred", "snoozed", "sent", "drafts", "trash", "spam", "all", "tasks", "calendar"];

describe("insertGmailNavIds", () => {
  it("places Important after Snoozed and categories after the mail folders", () => {
    expect(insertGmailNavIds(BASE)).toEqual([
      "inbox",
      "starred",
      "snoozed",
      "important",
      "sent",
      "drafts",
      "trash",
      "spam",
      "all",
      "purchases",
      "social",
      "updates",
      "forums",
      "promotions",
      "tasks",
      "calendar",
    ]);
  });

  it("puts Important after Starred when Snoozed is hidden", () => {
    expect(insertGmailNavIds(["inbox", "starred", "sent", "tasks"])).toEqual([
      "inbox",
      "starred",
      "important",
      "sent",
      "purchases",
      "social",
      "updates",
      "forums",
      "promotions",
      "tasks",
    ]);
  });

  it("does not duplicate labels that are already present", () => {
    const once = insertGmailNavIds(BASE);
    expect(insertGmailNavIds(once)).toEqual(once);
  });
});

describe("gmailViewLabelIds", () => {
  it("lists every important conversation", () => {
    expect(gmailViewLabelIds("important")).toEqual(["IMPORTANT"]);
  });

  it("limits categories to mail still in the inbox", () => {
    expect(gmailViewLabelIds("promotions")).toEqual(["INBOX", "CATEGORY_PROMOTIONS"]);
    expect(gmailViewLabelIds("purchases")).toEqual(["INBOX", "CATEGORY_PURCHASES"]);
  });

  it("returns null for folders that are not Gmail extras", () => {
    expect(gmailViewLabelIds("inbox")).toBeNull();
  });
});

describe("isGmailProvider", () => {
  it("matches Gmail API accounts only", () => {
    expect(isGmailProvider("gmail_api")).toBe(true);
    expect(isGmailProvider("imap")).toBe(false);
    expect(isGmailProvider("ews")).toBe(false);
    expect(isGmailProvider(undefined)).toBe(false);
  });
});
