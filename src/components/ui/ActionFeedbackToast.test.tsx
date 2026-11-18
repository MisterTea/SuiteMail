import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ActionFeedbackToast } from "./ActionFeedbackToast";
import { useToastStore } from "@/stores/toastStore";

describe("ActionFeedbackToast", () => {
  beforeEach(() => {
    act(() => {
      useToastStore.getState().dismissToast();
    });
  });

  it("does not render when no toast is active", () => {
    render(<ActionFeedbackToast />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders toast message in high-contrast pill", () => {
    act(() => {
      useToastStore.getState().showToast({
        message: "Conversation archived",
      });
    });

    render(<ActionFeedbackToast />);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Conversation archived")).toBeInTheDocument();
  });

  it("renders Undo button and triggers action callback", () => {
    const handleUndo = vi.fn();
    act(() => {
      useToastStore.getState().showToast({
        message: "Conversation archived",
        action: {
          label: "Undo",
          onClick: handleUndo,
        },
      });
    });

    render(<ActionFeedbackToast />);

    const undoBtn = screen.getByRole("button", { name: "Undo" });
    expect(undoBtn).toBeInTheDocument();
    fireEvent.click(undoBtn);
    expect(handleUndo).toHaveBeenCalledTimes(1);
  });

  it("dismisses toast when dismiss button is clicked", () => {
    act(() => {
      useToastStore.getState().showToast({
        message: "Item moved",
      });
    });

    render(<ActionFeedbackToast />);

    const dismissBtn = screen.getByRole("button", { name: /dismiss/i });
    fireEvent.click(dismissBtn);

    expect(useToastStore.getState().currentToast).toBeNull();
  });
});
