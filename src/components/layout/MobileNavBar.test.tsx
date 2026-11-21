import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MobileNavBar } from "./MobileNavBar";

const mockNavigateToLabel = vi.fn();
const mockNavigateToSettings = vi.fn();
const mockOpenComposer = vi.fn();

vi.mock("@/router/navigate", () => ({
  navigateToLabel: (...args: unknown[]) => mockNavigateToLabel(...args),
  navigateToSettings: (...args: unknown[]) => mockNavigateToSettings(...args),
}));

vi.mock("@/hooks/useRouteNavigation", () => ({
  useActiveLabel: () => "inbox",
  useSelectedThreadId: () => null,
}));

vi.mock("@/stores/composerStore", () => ({
  useComposerStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ openComposer: mockOpenComposer }),
}));

vi.mock("@/stores/taskStore", () => ({
  useTaskStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ incompleteCount: 3 }),
}));

describe("MobileNavBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nav buttons for Inbox, Starred, Calendar, Tasks, Settings and Compose", () => {
    render(<MobileNavBar />);
    expect(screen.getByText("Inbox")).toBeInTheDocument();
    expect(screen.getByText("Starred")).toBeInTheDocument();
    expect(screen.getByText("Calendar")).toBeInTheDocument();
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("navigates to Starred when clicked", () => {
    render(<MobileNavBar />);
    fireEvent.click(screen.getByText("Starred"));
    expect(mockNavigateToLabel).toHaveBeenCalledWith("starred");
  });

  it("navigates to Calendar when clicked", () => {
    render(<MobileNavBar />);
    fireEvent.click(screen.getByText("Calendar"));
    expect(mockNavigateToLabel).toHaveBeenCalledWith("calendar");
  });

  it("opens composer when Compose center button is clicked", () => {
    render(<MobileNavBar />);
    const composeBtn = screen.getByTitle("Compose Email");
    fireEvent.click(composeBtn);
    expect(mockOpenComposer).toHaveBeenCalledWith({ mode: "new" });
  });

  it("navigates to Settings when clicked", () => {
    render(<MobileNavBar />);
    fireEvent.click(screen.getByText("Settings"));
    expect(mockNavigateToSettings).toHaveBeenCalledWith("general");
  });
});
