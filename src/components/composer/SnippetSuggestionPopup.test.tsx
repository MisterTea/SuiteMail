import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SnippetSuggestionPopup } from "./SnippetSuggestionPopup";
import type { DbTemplate } from "@/services/db/templates";

describe("SnippetSuggestionPopup", () => {
  const mockTemplates: DbTemplate[] = [
    {
      id: "t1",
      account_id: null,
      name: "Introduction",
      subject: "Connecting",
      body_html: "<p>Hi</p>",
      shortcut: "intro",
      sort_order: 1,
      created_at: 1000,
    },
    {
      id: "t2",
      account_id: null,
      name: "Pricing Details",
      subject: "Pricing",
      body_html: "<p>Prices</p>",
      shortcut: ";pricing",
      sort_order: 2,
      created_at: 2000,
    },
  ];

  it("renders suggestions with names and formatted shortcuts", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <SnippetSuggestionPopup
        suggestions={mockTemplates}
        selectedIndex={0}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );

    expect(screen.getByText("Introduction")).toBeInTheDocument();
    expect(screen.getByText(";intro")).toBeInTheDocument();
    expect(screen.getByText("Pricing Details")).toBeInTheDocument();
    expect(screen.getByText(";pricing")).toBeInTheDocument();
  });

  it("calls onSelect when a suggestion is clicked", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <SnippetSuggestionPopup
        suggestions={mockTemplates}
        selectedIndex={0}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByText("Pricing Details"));
    expect(onSelect).toHaveBeenCalledWith(mockTemplates[1]);
  });

  it("calls onClose when suggestions are empty", () => {
    const onClose = vi.fn();
    render(
      <SnippetSuggestionPopup
        suggestions={[]}
        selectedIndex={0}
        onSelect={vi.fn()}
        onClose={onClose}
      />,
    );
    expect(onClose).toHaveBeenCalled();
  });
});
