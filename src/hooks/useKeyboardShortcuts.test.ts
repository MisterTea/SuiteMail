import { describe, it, expect, vi, beforeEach } from "vitest";

const { selectAll } = vi.hoisted(() => ({ selectAll: vi.fn() }));

// Mock dependencies needed for the hook to mount and dispatch events.
// The hook reads store state and calls navigate/emailActions — only mock
// what's needed for the three event-dispatch tests below.
vi.mock("@/stores/uiStore", () => ({
  useUIStore: { getState: () => ({ inboxViewMode: "unified", toggleSidebar: vi.fn() }) },
}));
vi.mock("@/stores/threadStore", () => ({
  useThreadStore: {
    getState: () => ({
      threads: [],
      selectedThreadIds: new Set(),
      removeThread: vi.fn(),
      removeThreads: vi.fn(),
      updateThread: vi.fn(),
      clearMultiSelect: vi.fn(),
      selectAll,
      selectAllFromHere: vi.fn(),
    }),
  },
}));
vi.mock("@/stores/composerStore", () => ({
  useComposerStore: { getState: () => ({ isOpen: false, openComposer: vi.fn(), closeComposer: vi.fn() }) },
}));
vi.mock("@/stores/accountStore", () => ({
  useAccountStore: { getState: () => ({ activeAccountId: null }) },
}));
vi.mock("@/stores/shortcutStore", () => ({
  useShortcutStore: {
    getState: () => ({
      keyMap: {
        "app.askInbox": "i",
        "app.commandPalette": "/",
        "app.toggleSidebar": "Ctrl+Shift+E",
        "action.selectAll": "Ctrl+A",
        "app.help": "?",
      },
    }),
  },
}));
vi.mock("@/stores/contextMenuStore", () => ({
  useContextMenuStore: { getState: () => ({ menuType: null, closeMenu: vi.fn() }) },
}));
vi.mock("@/router/navigate", () => ({
  navigateToLabel: vi.fn(),
  navigateToThread: vi.fn(),
  navigateBack: vi.fn(),
  getActiveLabel: () => "inbox",
  getSelectedThreadId: () => null,
}));
vi.mock("@/services/emailActions", () => ({
  archiveThread: vi.fn(),
  trashThread: vi.fn(),
  permanentDeleteThread: vi.fn(),
  starThread: vi.fn(),
  spamThread: vi.fn(),
}));
vi.mock("@/services/db/threads", () => ({
  deleteThread: vi.fn(),
  pinThread: vi.fn(),
  unpinThread: vi.fn(),
  muteThread: vi.fn(),
  unmuteThread: vi.fn(),
}));
vi.mock("@/services/gmail/draftDeletion", () => ({ deleteDraftsForThread: vi.fn() }));
vi.mock("@/services/gmail/tokenManager", () => ({ getGmailClient: vi.fn() }));
vi.mock("@/services/db/messages", () => ({ getMessagesForThread: vi.fn() }));
vi.mock("@/components/email/MessageItem", () => ({ parseUnsubscribeUrl: vi.fn() }));
vi.mock("@/services/gmail/syncManager", () => ({ triggerSync: vi.fn() }));

import { renderHook } from "@testing-library/react";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

describe("useKeyboardShortcuts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets a text field handle Cmd+A and still selects threads otherwise", () => {
    renderHook(() => useKeyboardShortcuts());
    const input = document.createElement("input");
    document.body.appendChild(input);

    const inField = new KeyboardEvent("keydown", {
      key: "a",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(inField);

    expect(inField.defaultPrevented).toBe(false);
    expect(selectAll).not.toHaveBeenCalled();

    const inMailbox = new KeyboardEvent("keydown", {
      key: "a",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(inMailbox);

    expect(inMailbox.defaultPrevented).toBe(true);
    expect(selectAll).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it("dispatches suitemail-toggle-ask-inbox when 'i' is pressed", () => {
    renderHook(() => useKeyboardShortcuts());

    const listener = vi.fn();
    window.addEventListener("suitemail-toggle-ask-inbox", listener);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "i", bubbles: true }),
    );

    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener("suitemail-toggle-ask-inbox", listener);
  });

  it("dispatches suitemail-toggle-command-palette when '/' is pressed", () => {
    renderHook(() => useKeyboardShortcuts());

    const listener = vi.fn();
    window.addEventListener("suitemail-toggle-command-palette", listener);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "/", bubbles: true }),
    );

    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener("suitemail-toggle-command-palette", listener);
  });

  it("dispatches suitemail-toggle-shortcuts-help when '?' is pressed", () => {
    renderHook(() => useKeyboardShortcuts());

    const listener = vi.fn();
    window.addEventListener("suitemail-toggle-shortcuts-help", listener);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "?", shiftKey: true, bubbles: true }),
    );

    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener("suitemail-toggle-shortcuts-help", listener);
  });
});
