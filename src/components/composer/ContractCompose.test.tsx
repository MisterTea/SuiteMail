import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AttachmentPicker } from "./AttachmentPicker";
import { ContractEditor } from "./ContractEditor";
import { useComposerStore } from "@/stores/composerStore";

describe("Start Contract", () => {
  beforeEach(() => {
    useComposerStore.getState().openComposer({ mode: "new" });
  });

  it("places Start Contract to the right of Attach and opens the contract region", () => {
    render(
      <>
        <AttachmentPicker />
        <ContractEditor />
      </>,
    );

    const attach = screen.getByRole("button", { name: "Attach" });
    const start = screen.getByRole("button", { name: "Start Contract" });
    expect(attach.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(start);

    expect(screen.getByTestId("contract-separator")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Contract" })).toBeInTheDocument();
  });

  it("hides Start Contract on a reply", () => {
    useComposerStore.getState().openComposer({ mode: "reply" });
    render(<AttachmentPicker />);
    expect(screen.queryByRole("button", { name: "Start Contract" })).not.toBeInTheDocument();
  });
});
