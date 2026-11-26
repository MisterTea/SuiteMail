import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { Capacitor } from "@capacitor/core";
import { Sidebar } from "./Sidebar";
import { useAccountStore } from "@/stores/accountStore";
import { useUIStore } from "@/stores/uiStore";

const { navigateToLabel } = vi.hoisted(() => ({
  navigateToLabel: vi.fn(),
}));

vi.mock("@/router/navigate", () => ({
  navigateToLabel,
}));

vi.mock("@/hooks/useRouteNavigation", () => ({
  useActiveLabel: () => "inbox",
  useActiveCategory: () => "Primary",
  useActiveSettingsTab: () => undefined,
}));

vi.mock("@/hooks/useNativePhone", () => ({ useNativePhone: () => false }));

vi.mock("@/services/db/threads", () => ({
  getDraftCountForAccount: vi.fn(async () => 0),
  getSnoozedCount: vi.fn(async () => 0),
  getStarredCount: vi.fn(async () => 0),
  getUnreadInboxCountForAccount: vi.fn(async () => 0),
  getUnreadInboxCountsForLabels: vi.fn(async () => new Map([["CATEGORY_SOCIAL", 1475]])),
  getUnreadFocusedInboxCount: vi.fn(async () => 3),
  getUnreadOtherInboxCount: vi.fn(async () => 5),
}));

vi.mock("@/services/db/connection", () => ({
  getDb: vi.fn(async () => ({
    select: vi.fn(async () => []),
    execute: vi.fn(async () => {}),
  })),
}));

function renderSidebar() {
  return render(
    <DndContext>
      <Sidebar collapsed={false} onAddAccount={() => {}} />
    </DndContext>,
  );
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("Sidebar Gmail labels", () => {
  beforeEach(() => {
    navigateToLabel.mockClear();
    useUIStore.setState({ sidebarNavConfig: null, mobileSidebarOpen: false, inboxViewMode: "unified" });
    useAccountStore.setState({ accounts: [], activeAccountId: null });
  });

  it("leaves feedback to the floating Android control", async () => {
    const platform = vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");
    try {
      renderSidebar();
      await settle();
      expect(screen.queryByRole("button", { name: "Report bug or request feature" })).not.toBeInTheDocument();
    } finally {
      platform.mockRestore();
    }
  });

  it("shows Gmail's common labels for a Gmail account", async () => {
    useAccountStore.setState({
      accounts: [{ id: "g1", email: "a@gmail.com", displayName: "A", avatarUrl: null, isActive: true, provider: "gmail_api" }],
      activeAccountId: "g1",
    });
    renderSidebar();
    await settle();

    for (const name of ["Important", "Purchases", "Social", "Updates", "Forums", "Promotions"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
    const buttons = screen.getAllByRole("button").map((button) => button.textContent ?? "");
    const important = buttons.findIndex((text) => text.includes("Important"));
    const snoozed = buttons.findIndex((text) => text.includes("Snoozed"));
    const sent = buttons.findIndex((text) => text.includes("Sent"));
    const allMail = buttons.findIndex((text) => text.includes("All Mail"));
    const purchases = buttons.findIndex((text) => text.includes("Purchases"));
    const promotions = buttons.findIndex((text) => text.includes("Promotions"));
    expect(snoozed).toBeLessThan(important);
    expect(important).toBeLessThan(sent);
    expect(allMail).toBeLessThan(purchases);
    expect(purchases).toBeLessThan(promotions);
    expect(screen.getByTestId("gmail-count-social")).toHaveTextContent("1,475");

    fireEvent.click(screen.getByRole("button", { name: /^Promotions/ }));
    expect(navigateToLabel).toHaveBeenCalledWith("promotions", undefined);
  });

  it("hides those labels for a non-Gmail account", async () => {
    useAccountStore.setState({
      accounts: [{ id: "e1", email: "a@utexas.edu", displayName: "A", avatarUrl: null, isActive: true, provider: "imap" }],
      activeAccountId: "e1",
    });
    renderSidebar();
    await settle();

    expect(screen.queryByRole("button", { name: "Purchases" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Important" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Inbox/ })).toBeInTheDocument();
  });

  it("replaces Inbox with Focused and Other for an EWS account", async () => {
    useAccountStore.setState({
      accounts: [{ id: "e1", email: "a@utexas.edu", displayName: "A", avatarUrl: null, isActive: true, provider: "ews" }],
      activeAccountId: "e1",
    });
    renderSidebar();
    await settle();

    expect(screen.queryByRole("button", { name: /^Inbox/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Focused/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Other/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Focused/ }));
    expect(navigateToLabel).toHaveBeenCalledWith("focused", undefined);

    fireEvent.click(screen.getByRole("button", { name: /^Other/ }));
    expect(navigateToLabel).toHaveBeenCalledWith("other", undefined);
  });
});
