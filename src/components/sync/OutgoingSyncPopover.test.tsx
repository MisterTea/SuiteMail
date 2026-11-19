import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { OutgoingSyncPopover } from "./OutgoingSyncPopover";
import { useOutgoingSyncStore, type OutgoingSyncRequest } from "@/stores/outgoingSyncStore";

describe("OutgoingSyncPopover", () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useOutgoingSyncStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders nothing when isOpen is false", () => {
    const { container } = render(<OutgoingSyncPopover />);
    expect(container.firstChild).toBeNull();
  });

  it("renders popover with title, description, summary breakdown, and items", () => {
    const req: OutgoingSyncRequest = {
      accountId: "acc-1",
      title: "Confirm Outgoing Sync (3 Changes)",
      description: "Large outgoing diff detected before syncing to server.",
      isFirstSync: true,
      items: [
        {
          id: "t1",
          type: "label",
          summary: "Set labels to [INBOX, Work]",
          subject: "Project Roadmap",
          labels: ["INBOX", "Work"],
        },
        {
          id: "t2",
          type: "archive",
          summary: "Archive conversation",
          subject: "Old Newsletter",
        },
        {
          id: "t3",
          type: "trash",
          summary: "Delete conversation",
          subject: "Spam Alert",
        },
      ],
      summary: {
        total: 3,
        labelsCount: 1,
        archiveCount: 1,
        trashCount: 1,
      },
    };

    useOutgoingSyncStore.setState({ isOpen: true, activeRequest: req });
    render(<OutgoingSyncPopover />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Confirm Outgoing Sync (3 Changes)")).toBeInTheDocument();
    expect(screen.getByText(/Large outgoing diff detected/)).toBeInTheDocument();
    expect(screen.getByText(/Syncing from server to app is always ok/)).toBeInTheDocument();
    expect(screen.getByText("First Sync Outgoing Diff")).toBeInTheDocument();

    // Summary breakdown
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Project Roadmap")).toBeInTheDocument();
    expect(screen.getByText("Old Newsletter")).toBeInTheDocument();
    expect(screen.getByText("Spam Alert")).toBeInTheDocument();

    // Buttons
    expect(screen.getByRole("button", { name: /Confirm syncing changes to server/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Don't sync changes to server/i })).toBeInTheDocument();
  });

  it("calls confirm when 'Sync to Server' is clicked", () => {
    const confirmSpy = vi.fn();
    useOutgoingSyncStore.setState({
      isOpen: true,
      activeRequest: {
        accountId: "acc-1",
        title: "Test Sync",
        description: "Test description",
        items: [{ id: "1", type: "label", summary: "Summary" }],
        summary: { total: 1 },
      },
      confirm: confirmSpy,
    });

    render(<OutgoingSyncPopover />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm syncing changes to server/i }));
    expect(confirmSpy).toHaveBeenCalled();
  });

  it("calls cancel when 'Don't Sync' is clicked", () => {
    const cancelSpy = vi.fn();
    useOutgoingSyncStore.setState({
      isOpen: true,
      activeRequest: {
        accountId: "acc-1",
        title: "Test Sync",
        description: "Test description",
        items: [{ id: "1", type: "label", summary: "Summary" }],
        summary: { total: 1 },
      },
      cancel: cancelSpy,
    });

    render(<OutgoingSyncPopover />);
    fireEvent.click(screen.getByRole("button", { name: /Don't sync changes to server/i }));
    expect(cancelSpy).toHaveBeenCalled();
  });

  it("handles Escape key to cancel", () => {
    const cancelSpy = vi.fn();
    useOutgoingSyncStore.setState({
      isOpen: true,
      activeRequest: {
        accountId: "acc-1",
        title: "Test Sync",
        description: "Test description",
        items: [{ id: "1", type: "label", summary: "Summary" }],
        summary: { total: 1 },
      },
      cancel: cancelSpy,
    });

    render(<OutgoingSyncPopover />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(cancelSpy).toHaveBeenCalled();
  });

  it("handles Enter key to confirm", () => {
    const confirmSpy = vi.fn();
    useOutgoingSyncStore.setState({
      isOpen: true,
      activeRequest: {
        accountId: "acc-1",
        title: "Test Sync",
        description: "Test description",
        items: [{ id: "1", type: "label", summary: "Summary" }],
        summary: { total: 1 },
      },
      confirm: confirmSpy,
    });

    render(<OutgoingSyncPopover />);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(confirmSpy).toHaveBeenCalled();
  });
});
