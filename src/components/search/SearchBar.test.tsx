import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SearchBar } from "./SearchBar";
import { useThreadStore } from "@/stores/threadStore";

describe("SearchBar Mobile UX", () => {
  beforeEach(() => {
    useThreadStore.getState().clearSearch();
  });

  it("renders search input with prominent magnifying glass and mobile-friendly styling", () => {
    render(<SearchBar />);
    const input = screen.getByPlaceholderText(/Search/i);
    expect(input).toBeInTheDocument();
    expect(input).toHaveClass("text-base"); // Prevents mobile zoom on focus
  });

  it("shows ergonomic clear button with 44dp target when query is entered", () => {
    useThreadStore.getState().setSearch("roadmap", null);
    render(<SearchBar />);

    const clearBtn = screen.getByRole("button", { name: /Clear search/i });
    expect(clearBtn).toBeInTheDocument();
    expect(clearBtn).toHaveClass("min-w-[44px]");
    expect(clearBtn).toHaveClass("min-h-[44px]");

    fireEvent.click(clearBtn);
    expect(useThreadStore.getState().searchQuery).toBe("");
  });

  it("shows save as smart folder button with comfortable touch target for 2+ char queries", () => {
    useThreadStore.getState().setSearch("Urgent", null);
    render(<SearchBar />);

    const saveBtn = screen.getByRole("button", { name: /Save as Smart Folder/i });
    expect(saveBtn).toBeInTheDocument();
    expect(saveBtn).toHaveClass("min-w-[44px]");
    expect(saveBtn).toHaveClass("min-h-[44px]");
  });
});
