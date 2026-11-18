import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BatchActionBar } from "./BatchActionBar";

describe("BatchActionBar", () => {
  const defaultProps = {
    selectedCount: 2,
    totalCount: 10,
    allRead: false,
    allStarred: false,
    isSpamView: false,
    onArchive: vi.fn(),
    onDelete: vi.fn(),
    onMarkRead: vi.fn(),
    onStar: vi.fn(),
    onMoveToFolder: vi.fn(),
    onSpam: vi.fn(),
    onClear: vi.fn(),
    onSelectAll: vi.fn(),
  };

  it("renders selected count badge with exact text", () => {
    render(<BatchActionBar {...defaultProps} />);
    expect(screen.getByText("2 selected")).toBeInTheDocument();
  });

  it("renders Select all button when selectedCount < totalCount", () => {
    render(<BatchActionBar {...defaultProps} selectedCount={2} totalCount={5} />);
    const selectAllBtn = screen.getByText("Select all");
    expect(selectAllBtn).toBeInTheDocument();
    fireEvent.click(selectAllBtn);
    expect(defaultProps.onSelectAll).toHaveBeenCalledTimes(1);
  });

  it("hides Select all button when all items are selected", () => {
    render(<BatchActionBar {...defaultProps} selectedCount={5} totalCount={5} />);
    expect(screen.queryByText("Select all")).not.toBeInTheDocument();
  });

  it("triggers Archive selected callback", () => {
    render(<BatchActionBar {...defaultProps} />);
    const archiveBtn = screen.getByTitle("Archive selected");
    expect(archiveBtn).toBeInTheDocument();
    fireEvent.click(archiveBtn);
    expect(defaultProps.onArchive).toHaveBeenCalledTimes(1);
  });

  it("triggers Delete selected callback", () => {
    render(<BatchActionBar {...defaultProps} />);
    const deleteBtn = screen.getByTitle("Delete selected");
    expect(deleteBtn).toBeInTheDocument();
    fireEvent.click(deleteBtn);
    expect(defaultProps.onDelete).toHaveBeenCalledTimes(1);
  });

  it("triggers Mark as read when some items are unread", () => {
    render(<BatchActionBar {...defaultProps} allRead={false} />);
    const markReadBtn = screen.getByTitle("Mark as read");
    expect(markReadBtn).toBeInTheDocument();
    fireEvent.click(markReadBtn);
    expect(defaultProps.onMarkRead).toHaveBeenCalledWith(true);
  });

  it("triggers Mark as unread when all items are read", () => {
    render(<BatchActionBar {...defaultProps} allRead={true} />);
    const markUnreadBtn = screen.getByTitle("Mark as unread");
    expect(markUnreadBtn).toBeInTheDocument();
    fireEvent.click(markUnreadBtn);
    expect(defaultProps.onMarkRead).toHaveBeenCalledWith(false);
  });

  it("triggers Star selected callback", () => {
    render(<BatchActionBar {...defaultProps} allStarred={false} />);
    const starBtn = screen.getByTitle("Star selected");
    expect(starBtn).toBeInTheDocument();
    fireEvent.click(starBtn);
    expect(defaultProps.onStar).toHaveBeenCalledWith(true);
  });

  it("triggers Move to folder callback", () => {
    render(<BatchActionBar {...defaultProps} />);
    const moveBtn = screen.getByTitle("Move to folder");
    expect(moveBtn).toBeInTheDocument();
    fireEvent.click(moveBtn);
    expect(defaultProps.onMoveToFolder).toHaveBeenCalledTimes(1);
  });

  it("triggers Clear selection callback", () => {
    render(<BatchActionBar {...defaultProps} />);
    const clearBtn = screen.getByTitle("Clear selection");
    expect(clearBtn).toBeInTheDocument();
    fireEvent.click(clearBtn);
    expect(defaultProps.onClear).toHaveBeenCalledTimes(1);
  });
});
