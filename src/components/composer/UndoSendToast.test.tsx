import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { useComposerStore } from "@/stores/composerStore";
import { UndoSendToast } from "./UndoSendToast";

describe("Undo send recovery", () => {
  beforeEach(() => {
    useComposerStore.getState().closeComposer();
    useComposerStore.setState({ undoSendTimer: null, undoSendVisible: false, undoSendRestore: null });
  });

  it("cancels delivery and recovers the draft once, retaining its identity and attachments", () => {
    const delivered = vi.fn();
    const timer = setTimeout(delivered, 5000);
    const restore = vi.fn(() => useComposerStore.getState().openComposer({
      to: ["person@example.com"], subject: "Retained subject", bodyHtml: "<p>Final edit</p>", draftId: "saved-draft", attachments: [{ id: "file", filename: "review.pdf", mimeType: "application/pdf", size: 4, content: "data" }],
    }));
    useComposerStore.setState({ undoSendTimer: timer, undoSendVisible: true, undoSendRestore: restore });
    const { getByRole } = render(<UndoSendToast />);
    fireEvent.click(getByRole("button", { name: "Undo sending email" }));
    expect(restore).toHaveBeenCalledTimes(1);
    expect(useComposerStore.getState()).toMatchObject({ isOpen: true, draftId: "saved-draft", subject: "Retained subject", bodyHtml: "<p>Final edit</p>", undoSendRestore: null, undoSendTimer: null });
    expect(useComposerStore.getState().attachments[0]?.filename).toBe("review.pdf");
    expect(delivered).not.toHaveBeenCalled();
  });
});
