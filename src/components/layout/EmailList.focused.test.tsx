import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { navigateToLabel } from "@/router/navigate";
import { EmailList } from "./EmailList";
import { useAccountStore } from "@/stores/accountStore";
import { useThreadStore } from "@/stores/threadStore";
import { useActiveLabel, useSelectedThreadId, useActiveCategory } from "@/hooks/useRouteNavigation";

vi.mock("@/hooks/useRouteNavigation", () => ({
  useActiveLabel: vi.fn(),
  useSelectedThreadId: vi.fn(),
  useActiveCategory: vi.fn(),
}));

vi.mock("@/router/navigate", () => ({
  navigateToThread: vi.fn(),
  navigateToLabel: vi.fn(),
}));

vi.mock("@/services/db/threads", () => ({
  getThreadsForAccount: vi.fn().mockResolvedValue([]),
  getThreadsForCategory: vi.fn().mockResolvedValue([]),
  getThreadsForLabels: vi.fn().mockResolvedValue([]),
  getThreadsForOtherInbox: vi.fn().mockResolvedValue([]),
  getThreadLabelIds: vi.fn().mockResolvedValue([]),
  deleteThread: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/db/threadCategories", () => ({
  getCategoriesForThreads: vi.fn().mockResolvedValue(new Map()),
  getCategoryUnreadCounts: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/services/db/followUpReminders", () => ({
  getActiveFollowUpThreadIds: vi.fn().mockResolvedValue(new Set()),
}));

vi.mock("@/services/db/bundleRules", () => ({
  getBundleRules: vi.fn().mockResolvedValue([]),
  getHeldThreadIds: vi.fn().mockResolvedValue(new Set()),
  getBundleSummaries: vi.fn().mockResolvedValue(new Map()),
}));

describe("EmailList focused and other empty states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAccountStore.setState({
      accounts: [{ id: "acc1", email: "user@domain.com", displayName: "User", avatarUrl: null, isActive: true, provider: "ews" }],
      activeAccountId: "acc1",
    });
    useThreadStore.setState({
      threads: [],
      hasMore: false,
      isInitialLoading: false,
      isLoadingMore: false,
      unreadCounts: {},
      selectedThreadIds: new Set(),
    });
    vi.mocked(useSelectedThreadId).mockReturnValue(null);
    vi.mocked(useActiveCategory).mockReturnValue("All");
  });

  it("renders empty state for focused without crashing", async () => {
    vi.mocked(useActiveLabel).mockReturnValue("focused");
    render(<EmailList />);
    await waitFor(() => {
      expect(screen.getByText("You're all caught up")).toBeInTheDocument();
      expect(screen.getByText("No focused conversations — enjoy your day!")).toBeInTheDocument();
    });
  });

  it("renders empty state for other without crashing", async () => {
    vi.mocked(useActiveLabel).mockReturnValue("other");
    render(<EmailList />);
    await waitFor(() => {
      expect(screen.getByText("No other messages")).toBeInTheDocument();
      expect(screen.getByText("All caught up in Other")).toBeInTheDocument();
    });
  });

  it.each(["focused", "other"])("opens Inbox when switching from EWS %s to Gmail", async (label) => {
    vi.mocked(useActiveLabel).mockReturnValue(label);
    render(<EmailList />);
    expect(navigateToLabel).not.toHaveBeenCalled();

    act(() => {
      useAccountStore.setState({
        accounts: [{ id: "gmail", email: "user@gmail.com", displayName: "User", avatarUrl: null, isActive: true, provider: "gmail" }],
        activeAccountId: "gmail",
      });
    });

    await waitFor(() => expect(navigateToLabel).toHaveBeenCalledWith("inbox"));
  });

  it("opens Focused for an EWS account on Inbox", async () => {
    vi.mocked(useActiveLabel).mockReturnValue("inbox");
    render(<EmailList />);
    await waitFor(() => expect(navigateToLabel).toHaveBeenCalledWith("focused"));
  });
});
