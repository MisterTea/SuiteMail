import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useComposerStore } from "@/stores/composerStore";
import { startAutoSave, stopAutoSave, flushAutoSave, waitForPendingAutoSave } from "./draftAutoSave";

// Mock emailActions instead of getGmailClient
vi.mock("@/services/emailActions", () => ({
  createDraft: vi.fn().mockResolvedValue({ success: true, data: { draftId: "draft-1" } }),
  updateDraft: vi.fn().mockResolvedValue({ success: true }),
}));

import { createDraft, updateDraft } from "@/services/emailActions";
import { buildRawEmail } from "@/utils/emailBuilder";
vi.mock("@/utils/emailBuilder", () => ({ buildRawEmail: vi.fn(() => "raw") }));

import { createMockAccountStoreState } from "@/test/mocks";

vi.mock("@/stores/accountStore", () => ({
  useAccountStore: {
    getState: () => createMockAccountStoreState({
      accounts: [{ id: "account-1", email: "test@example.com" }],
    }),
  },
}));

describe("draftAutoSave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(createDraft).mockResolvedValue({ success: true, data: { draftId: "draft-1" } });
    vi.mocked(updateDraft).mockResolvedValue({ success: true });
    useComposerStore.setState({
      isOpen: true,
      mode: "new",
      to: ["recipient@example.com"],
      cc: [],
      bcc: [],
      subject: "Test",
      bodyHtml: "<p>Hello</p>",
      threadId: null,
      inReplyToMessageId: null,
      showCcBcc: false,
      draftId: null,
      undoSendTimer: null,
      undoSendVisible: false,
      attachments: [],
      lastSavedAt: null,
      isSaving: false,
      signatureHtml: "",
      signatureId: null,
      fromEmail: null,
      quotedHtml: null,
      contractText: "",
      contractActive: false,
    });
  });

  afterEach(() => {
    stopAutoSave();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts and stops without error", () => {
    startAutoSave("account-1");
    stopAutoSave();
  });

  it("triggers save after debounce when body changes", async () => {
    startAutoSave("account-1");

    // Simulate a body change
    useComposerStore.getState().setBodyHtml("<p>Updated</p>");

    // Before debounce, draft should not be saved
    expect(useComposerStore.getState().draftId).toBeNull();

    // Advance past debounce
    await vi.advanceTimersByTimeAsync(3500);

    // Draft should now be saved
    expect(useComposerStore.getState().draftId).toBe("draft-1");
    expect(useComposerStore.getState().lastSavedAt).not.toBeNull();
  });

  it("does not save when composer is closed", async () => {
    startAutoSave("account-1");

    useComposerStore.setState({ isOpen: false });
    useComposerStore.getState().setSubject("Changed");

    await vi.advanceTimersByTimeAsync(3500);

    expect(useComposerStore.getState().draftId).toBeNull();
  });
  it("flushes immediate edits without waiting for the debounce and preserves audience", async () => {
    startAutoSave("account-1");
    useComposerStore.setState({ subject: "Final sentence", cc: ["copy@example.com"], bcc: ["private@example.com"], fromEmail: "alias@example.com", inReplyToMessageId: "message-1" });
    await flushAutoSave();
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(buildRawEmail).toHaveBeenLastCalledWith(expect.objectContaining({ subject: "Final sentence", cc: ["copy@example.com"], bcc: ["private@example.com"], from: "alias@example.com", inReplyTo: "message-1" }));
    stopAutoSave();
    await vi.advanceTimersByTimeAsync(4000);
    expect(createDraft).toHaveBeenCalledTimes(1);
  });

  it("waits for an in-flight create then updates the same draft with the latest edit", async () => {
    let resolveCreate!: (value: { success: boolean; data: { draftId: string } }) => void;
    vi.mocked(createDraft).mockImplementationOnce(() => new Promise((resolve) => { resolveCreate = resolve; }));
    startAutoSave("account-1");
    useComposerStore.getState().setSubject("First version");
    await vi.advanceTimersByTimeAsync(3000);
    useComposerStore.getState().setSubject("Last version");
    const flush = flushAutoSave();
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(updateDraft).not.toHaveBeenCalled();
    resolveCreate({ success: true, data: { draftId: "saved-identity" } });
    await flush;
    expect(updateDraft).toHaveBeenCalledWith("account-1", "saved-identity", "raw", undefined);
    expect(buildRawEmail).toHaveBeenLastCalledWith(expect.objectContaining({ subject: "Last version" }));
  });

  it("rejects a failed action result so Save & close can retain the draft", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(createDraft).mockResolvedValueOnce({ success: false, error: "Offline" });
    startAutoSave("account-1");
    useComposerStore.getState().setBodyHtml("<p>Unsaved</p>");
    await expect(flushAutoSave()).rejects.toThrow("Could not create draft");
    expect(useComposerStore.getState().lastSavedAt).toBeNull();
    expect(useComposerStore.getState().bodyHtml).toBe("<p>Unsaved</p>");
    await flushAutoSave();
    expect(useComposerStore.getState().draftId).toBe("draft-1");
  });

  it("marks a saved draft dirty immediately after another edit", async () => {
    startAutoSave("account-1");
    await flushAutoSave();
    expect(useComposerStore.getState().lastSavedAt).not.toBeNull();
    useComposerStore.getState().setSubject("New edit");
    expect(useComposerStore.getState().lastSavedAt).toBeNull();
  });

  it("waits for an in-flight create before discard reads the draft identity", async () => {
    let finish!: (value: { success: boolean; data: { draftId: string } }) => void;
    vi.mocked(createDraft).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    startAutoSave("account-1");
    useComposerStore.getState().setSubject("Being saved");
    await vi.advanceTimersByTimeAsync(3000);
    const readyToDiscard = waitForPendingAutoSave();
    finish({ success: true, data: { draftId: "delete-this-draft" } });
    await readyToDiscard;
    expect(useComposerStore.getState().draftId).toBe("delete-this-draft");
    stopAutoSave();
    expect(createDraft).toHaveBeenCalledTimes(1);
  });

});
