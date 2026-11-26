import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/db/settings", () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));

import { getSetting, setSetting } from "@/services/db/settings";
import {
  getMailboxAiBoolean,
  getMailboxAiSetting,
  getMailboxAutoArchiveCategories,
  isMailboxAiSettingChange,
  loadMailboxAiSettings,
  mailboxAiSettingKey,
  setMailboxAiBoolean,
  setMailboxAiSetting,
  setMailboxAutoArchiveCategories,
} from "./mailboxAiSettings";

describe("mailboxAiSettings", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.clearAllMocks();
    vi.mocked(getSetting).mockImplementation(async (key) => store[key] ?? null);
    vi.mocked(setSetting).mockImplementation(async (key, value) => {
      store[key] = value;
    });
  });

  it("builds account-scoped keys", () => {
    expect(mailboxAiSettingKey("ai_enabled", "acc-1")).toBe("ai_enabled:acc-1");
  });

  it("reads account-specific value over legacy global value", async () => {
    store["ai_enabled"] = "true";
    store["ai_enabled:acc-1"] = "false";

    expect(await getMailboxAiBoolean("ai_enabled", "acc-1")).toBe(false);
    expect(await getMailboxAiBoolean("ai_enabled", "acc-2")).toBe(true);
  });

  it("falls back to legacy global key when account has no override", async () => {
    store["ai_auto_summarize"] = "false";

    expect(await getMailboxAiBoolean("ai_auto_summarize", "acc-1")).toBe(false);
    expect(await getMailboxAiSetting("ai_auto_summarize")).toBe("false");
  });

  it("defaults boolean settings to true when unset", async () => {
    expect(await getMailboxAiBoolean("ai_enabled", "acc-1")).toBe(true);
    expect(await getMailboxAiBoolean("ai_auto_categorize", "acc-1")).toBe(true);
    expect(await getMailboxAiBoolean("ai_auto_summarize", "acc-1")).toBe(true);
    expect(await getMailboxAiBoolean("ai_auto_draft_enabled", "acc-1")).toBe(true);
    expect(await getMailboxAiBoolean("ai_writing_style_enabled", "acc-1")).toBe(true);
  });

  it("isolates writes per mailbox account", async () => {
    await setMailboxAiBoolean("acc-1", "ai_enabled", false);
    await setMailboxAiSetting("acc-2", "auto_archive_categories", "Promotions,Social");

    expect(await getMailboxAiBoolean("ai_enabled", "acc-1")).toBe(false);
    expect(await getMailboxAiBoolean("ai_enabled", "acc-2")).toBe(true);
    expect([...(await getMailboxAutoArchiveCategories("acc-1"))]).toEqual([]);
    expect([...(await getMailboxAutoArchiveCategories("acc-2"))]).toEqual(["Promotions", "Social"]);
  });

  it("loads all mailbox AI settings together", async () => {
    await setMailboxAiBoolean("acc-1", "ai_auto_categorize", false);
    await setMailboxAutoArchiveCategories("acc-1", ["Newsletters", "Updates"]);

    const loaded = await loadMailboxAiSettings("acc-1");
    expect(loaded.aiEnabled).toBe(true);
    expect(loaded.aiAutoCategorize).toBe(false);
    expect(loaded.aiAutoSummarize).toBe(true);
    expect(loaded.aiAutoDraftEnabled).toBe(true);
    expect(loaded.aiWritingStyleEnabled).toBe(true);
    expect([...loaded.autoArchiveCategories]).toEqual(["Newsletters", "Updates"]);
  });

  it("matches global and account-scoped change keys", () => {
    expect(isMailboxAiSettingChange("ai_enabled", "ai_enabled", "acc-1")).toBe(true);
    expect(isMailboxAiSettingChange("ai_enabled:acc-1", "ai_enabled", "acc-1")).toBe(true);
    expect(isMailboxAiSettingChange("ai_enabled:acc-2", "ai_enabled", "acc-1")).toBe(false);
  });
});
