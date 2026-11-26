import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { navigateToLabel } from "@/router/navigate";
import { EmailList } from "./EmailList";
import { useAccountStore } from "@/stores/accountStore";
import { useThreadStore } from "@/stores/threadStore";
import { useUIStore } from "@/stores/uiStore";
import { useActiveLabel, useSelectedThreadId, useActiveCategory } from "@/hooks/useRouteNavigation";
import { triggerSync } from "@/services/gmail/syncManager";

vi.mock("@/services/gmail/syncManager", () => ({
  triggerSync: vi.fn(),
}));

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
    useUIStore.setState({ accountSyncProgress: {} });
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
      searchQuery: "",
      searchThreadIds: null,
    });
    vi.mocked(useSelectedThreadId).mockReturnValue(null);
    vi.mocked(useActiveCategory).mockReturnValue("All");
  });

  it.each(["focused", "other"])("keeps the empty %s inbox quiet", async (label) => {
    vi.mocked(useActiveLabel).mockReturnValue(label);
    render(<EmailList />);
    expect(await screen.findByRole("button", { name: "Check for new mail" })).toBeEnabled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.queryByText(/caught up|inbox zero/i)).not.toBeInTheDocument();
  });

  it("syncs the EWS account when checking for new mail from an empty Focused inbox", async () => {
    vi.mocked(useActiveLabel).mockReturnValue("focused");
    let finishSync!: () => void;
    vi.mocked(triggerSync).mockReturnValueOnce(new Promise<void>((resolve) => {
      finishSync = resolve;
    }));
    render(<EmailList />);

    const checkButton = await screen.findByRole("button", { name: "Check for new mail" });
    fireEvent.click(checkButton);
    expect(triggerSync).toHaveBeenCalledExactlyOnceWith(["acc1"]);
    expect(checkButton).toBeDisabled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    await act(async () => finishSync());
    expect(checkButton).toBeEnabled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it.each(["ews", "gmail_api", "imap"])("shows %s progress only after messages are synced", async (provider) => {
    vi.mocked(useActiveLabel).mockReturnValue(provider === "ews" ? "focused" : "inbox");
    useAccountStore.setState(({ accounts }) => ({ accounts: [{ ...accounts[0]!, provider }] }));
    const { setAccountSyncing } = useUIStore.getState();
    setAccountSyncing("acc1", true, { phase: "labels", current: 0, total: 0 });
    render(<EmailList />);

    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    act(() => setAccountSyncing("acc1", true, { phase: "messages", current: 0, total: 0 }));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    act(() => {
      setAccountSyncing("acc1", true, { phase: "messages", current: 40, total: 0 });
      setAccountSyncing("another-account", true, { phase: "messages", current: 80, total: 0 });
    });
    expect(screen.getByRole("status")).toHaveTextContent("40 messages synced");

    act(() => setAccountSyncing("acc1", false));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(await screen.findByRole("button", { name: "Check for new mail" })).toBeEnabled();
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

  it("does not present the unfiltered list as search results while a search is pending", async () => {
    vi.mocked(useActiveLabel).mockReturnValue("inbox");
    render(<EmailList />);
    await screen.findByText("0 conversations");
    act(() => useThreadStore.getState().setSearch("Roadmap", null));
    expect(await screen.findByTestId("search-results-badge")).toHaveTextContent("Searching…");
    expect(screen.queryByText(/matching conversations?$/)).not.toBeInTheDocument();

    act(() => useThreadStore.getState().setSearch("Roadmap", new Set()));
    expect(screen.getByTestId("search-results-badge")).toHaveTextContent("0 results");
    expect(screen.getByText("0 matching conversations")).toBeInTheDocument();
  });
});
