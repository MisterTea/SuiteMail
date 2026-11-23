import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Capacitor } from "@capacitor/core";
import { MobileNavBar } from "./MobileNavBar";

const mockNavigateToLabel = vi.fn();
const mockNavigateToSettings = vi.fn();
const mockOpenComposer = vi.fn();
const mockRoute = vi.hoisted(() => ({ label: "inbox", android: false, threadId: null as string | null, composerOpen: false }));

vi.mock("@/hooks/useAndroidMobile", () => ({
  useAndroidMobile: () => mockRoute.android,
}));

vi.mock("@/router/navigate", () => ({
  navigateToLabel: (...args: unknown[]) => mockNavigateToLabel(...args),
  navigateToSettings: (...args: unknown[]) => mockNavigateToSettings(...args),
}));

vi.mock("@/hooks/useRouteNavigation", () => ({
  useActiveLabel: () => mockRoute.label,
  useSelectedThreadId: () => mockRoute.threadId,
}));

vi.mock("@/stores/composerStore", () => ({
  useComposerStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ openComposer: mockOpenComposer, isOpen: mockRoute.composerOpen }),
}));

vi.mock("@/stores/taskStore", () => ({
  useTaskStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ incompleteCount: 3 }),
}));

describe("MobileNavBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoute.label = "inbox";
    mockRoute.android = false;
    mockRoute.threadId = null;
    mockRoute.composerOpen = false;
  });

  it.each([false, true])("hides Compose on Calendar (Android: %s)", (android) => {
    mockRoute.android = android;
    mockRoute.label = "calendar";
    render(<MobileNavBar />);
    expect(screen.queryByTitle("Compose Email")).not.toBeInTheDocument();
    expect(screen.getByText("Calendar")).toBeInTheDocument();
  });

  it("keeps Compose available in the Android inbox", () => {
    mockRoute.android = true;
    render(<MobileNavBar />);
    fireEvent.click(screen.getByTitle("Compose Email"));
    expect(mockOpenComposer).toHaveBeenCalledWith({ mode: "new" });
    expect(screen.getByRole("button", { name: "Report bug or request feature" }).parentElement).toHaveClass("right-20");
  });

  it.each(["calendar", "settings", "thread", "composer"])("keeps Android feedback available when Compose is hidden on %s", (screenName) => {
    mockRoute.android = true;
    mockRoute.label = screenName === "thread" || screenName === "composer" ? "inbox" : screenName;
    mockRoute.threadId = screenName === "thread" ? "thread-1" : null;
    mockRoute.composerOpen = screenName === "composer";
    render(<MobileNavBar />);
    expect(screen.queryByRole("button", { name: "Compose email" })).not.toBeInTheDocument();
    const feedback = screen.getByRole("button", { name: "Report bug or request feature" });
    expect(feedback.parentElement).toHaveClass("right-4");
    expect(feedback.closest("[data-mobile-nav]")).toBeNull();
  });

  it("opens the existing feedback form from Android Settings", async () => {
    mockRoute.android = true;
    mockRoute.label = "settings";
    const previousBridge = window.supermail;
    const captureScreenshot = vi.fn().mockResolvedValue("data:image/png;base64,c2NyZWVuc2hvdA==");
    window.supermail = { ...previousBridge, captureScreenshot };
    try {
      render(<MobileNavBar />);
      fireEvent.click(screen.getByRole("button", { name: "Report bug or request feature" }));
      expect(await screen.findByRole("dialog", { name: "Report a Bug" })).toBeVisible();
      expect(captureScreenshot).toHaveBeenCalledOnce();
    } finally {
      window.supermail = previousBridge;
    }
  });

  it("floats feedback on wider Android screens", () => {
    const platform = vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");
    try {
      render(<MobileNavBar />);
      expect(screen.getByRole("button", { name: "Report bug or request feature" })).toBeInTheDocument();
    } finally {
      platform.mockRestore();
    }
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
