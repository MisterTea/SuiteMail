import { startAttachmentIndex, stopAttachmentIndex } from "@/services/attachments/attachmentIndex";
import { useEffect, useState, useCallback, useRef } from "react";
import { Outlet } from "@tanstack/react-router";
import { Sidebar } from "./components/layout/Sidebar";
import { AddAccount } from "./components/accounts/AddAccount";
import { Composer } from "./components/composer/Composer";
import { UndoSendToast } from "./components/composer/UndoSendToast";
import { ScheduledSendToast } from "./components/composer/ScheduledSendToast";
import { CommandPalette } from "./components/search/CommandPalette";
import { ShortcutsHelp } from "./components/search/ShortcutsHelp";
import { AskInbox } from "./components/search/AskInbox";
import { AgentConsentPopover } from "./components/ai/AgentConsentPopover";
import { AiCoreStartup } from "./components/ai/AiCoreStartup";
import { OutgoingSyncPopover } from "./components/sync/OutgoingSyncPopover";
import { StartupTelemetryPopover } from "./components/settings/StartupTelemetryPopover";
import { useUIStore } from "./stores/uiStore";
import { hasMailAccount, useAccountStore } from "./stores/accountStore";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { runMigrations } from "./services/db/migrations";
import { getAllAccounts, type DbAccount } from "./services/db/accounts";
import { getSetting } from "./services/db/settings";
import {
  startBackgroundSync,
  stopBackgroundSync,
  setAndroidSyncForeground,
  syncAccount,
  triggerSync,
  onSyncStatus,
} from "./services/gmail/syncManager";
import { App as AndroidApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { hasAndroidBackgroundSync } from "./services/gmail/androidBackgroundSync";
import { initializeClients } from "./services/gmail/tokenManager";
import {
  startSnoozeChecker,
  stopSnoozeChecker,
} from "./services/snooze/snoozeManager";
import {
  startScheduledSendChecker,
  stopScheduledSendChecker,
} from "./services/snooze/scheduledSendManager";
import {
  startFollowUpChecker,
  stopFollowUpChecker,
} from "./services/followup/followupManager";
import {
  startBundleChecker,
  stopBundleChecker,
} from "./services/bundles/bundleManager";
import { initNotifications } from "./services/notifications/notificationManager";
import {
  initGlobalShortcut,
  unregisterComposeShortcut,
} from "./services/globalShortcut";
import { initDeepLinkHandler } from "./services/deepLinkHandler";
import { updateBadgeCount } from "./services/badgeManager";
import {
  startQueueProcessor,
  stopQueueProcessor,
  triggerQueueFlush,
} from "./services/queue/queueProcessor";
import {
  startPreCacheManager,
  stopPreCacheManager,
} from "./services/attachments/preCacheManager";
import {
  startAllIdle,
  stopAllIdle,
} from "./services/imap/idleManager";
import {
  startUpdateChecker,
  stopUpdateChecker,
} from "./services/updateManager";
import { fetchSendAsAliases } from "./services/gmail/sendAs";
import { getGmailClient } from "./services/gmail/tokenManager";
import { platformInvoke as invoke } from "./platform";
import { DndProvider } from "./components/dnd/DndProvider";
import { TitleBar } from "./components/layout/TitleBar";
import { MobileNavBar } from "./components/layout/MobileNavBar";
import { useShortcutStore } from "./stores/shortcutStore";
import { getIncompleteTaskCount } from "./services/db/tasks";
import { useTaskStore } from "./stores/taskStore";
import { ContextMenuPortal } from "./components/ui/ContextMenuPortal";
import { MoveToFolderDialog } from "./components/email/MoveToFolderDialog";
import { AiFilterSuggestModal } from "./components/settings/AiFilterSuggestModal";
import { OfflineBanner } from "./components/ui/OfflineBanner";
import { UpdateToast } from "./components/ui/UpdateToast";
import { ActionFeedbackToast } from "./components/ui/ActionFeedbackToast";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { formatSyncError } from "./utils/networkErrors";
import { getThemeById, COLOR_THEMES, DEFAULT_COLOR_THEME } from "./constants/themes";
import type { ColorThemeId } from "./constants/themes";
import { router } from "./router";
import { getSelectedThreadId } from "./router/navigate";

/**
 * Sync bridge: subscribes to router state changes and writes the selected
 * thread ID to the threadStore so that range-select and other multi-select
 * logic can use it as an anchor.
 */
function useRouterSyncBridge() {
  useEffect(() => {
    return router.subscribe("onResolved", () => {
      const threadId = getSelectedThreadId();
      if (useThreadStore.getState().selectedThreadId !== threadId) {
        useThreadStore.getState().selectThread(threadId);
      }
    });
  }, []);
}

import { useThreadStore } from "./stores/threadStore";

function toStoreAccounts(dbAccounts: DbAccount[]) {
  return dbAccounts.map((a) => ({
    id: a.id,
    email: a.email,
    displayName: a.display_name,
    avatarUrl: a.avatar_url,
    isActive: a.is_active === 1,
    provider: a.provider,
  }));
}

export default function App() {
  const theme = useUIStore((s) => s.theme);
  const fontScale = useUIStore((s) => s.fontScale);
  const colorTheme = useUIStore((s) => s.colorTheme);
  const reduceMotion = useUIStore((s) => s.reduceMotion);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [showStartupTelemetryPrompt, setShowStartupTelemetryPrompt] = useState<boolean | null>(null);
  const accountCount = useAccountStore((s) => s.accounts.length);
  const [syncFailure, setSyncFailure] = useState<{ accountId: string; message: string } | null>(null);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [showAskInbox, setShowAskInbox] = useState(false);
  const [showAiSuggestFilter, setShowAiSuggestFilter] = useState(false);
  const [filterModalMode, setFilterModalMode] = useState<"ai" | "manual">("ai");
  const [moveToFolderState, setMoveToFolderState] = useState<{ open: boolean; threadIds: string[] }>({ open: false, threadIds: [] });
  const deepLinkCleanupRef = useRef<(() => void) | undefined>(undefined);

  // Sync bridge: router state → Zustand stores (temporary)
  useRouterSyncBridge();

  // Register global keyboard shortcuts
  useKeyboardShortcuts();

  // Network status detection
  useEffect(() => {
    const { setOnline } = useUIStore.getState();
    setOnline(navigator.onLine);

    const handleOnline = () => {
      setOnline(true);
      triggerQueueFlush();
      const accounts = useAccountStore.getState().accounts;
      const activeIds = accounts.filter((a) => a.isActive).map((a) => a.id);
      if (activeIds.length > 0) triggerSync(activeIds);
    };
    const handleOffline = () => setOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Suppress default browser context menu globally (Electron app should feel native)
  // Elements with data-native-context-menu opt out so the browser menu is available
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest?.("[data-native-context-menu]")) return;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  // Listen for command palette / shortcuts help toggle events
  useEffect(() => {
    const togglePalette = () => setShowCommandPalette((p) => !p);
    const toggleHelp = () => setShowShortcutsHelp((p) => !p);
    const toggleAskInbox = () => setShowAskInbox((p) => !p);
    const handleOpenFilterModal = (e: Event) => {
      const detail = (e as CustomEvent<{ mode?: "ai" | "manual" }>).detail;
      setFilterModalMode(detail?.mode ?? "ai");
      setShowAiSuggestFilter(true);
    };
    const handleMoveToFolder = (e: Event) => {
      const detail = (e as CustomEvent<{ threadIds: string[] }>).detail;
      setMoveToFolderState({ open: true, threadIds: detail.threadIds });
    };
    window.addEventListener("suitemail-toggle-command-palette", togglePalette);
    window.addEventListener("suitemail-toggle-shortcuts-help", toggleHelp);
    window.addEventListener("suitemail-toggle-ask-inbox", toggleAskInbox);
    window.addEventListener("suitemail-suggest-filter", handleOpenFilterModal);
    window.addEventListener("suitemail-create-filter", handleOpenFilterModal);
    window.addEventListener("suitemail-move-to-folder", handleMoveToFolder);
    return () => {
      window.removeEventListener("suitemail-toggle-command-palette", togglePalette);
      window.removeEventListener("suitemail-toggle-shortcuts-help", toggleHelp);
      window.removeEventListener("suitemail-toggle-ask-inbox", toggleAskInbox);
      window.removeEventListener("suitemail-suggest-filter", handleOpenFilterModal);
      window.removeEventListener("suitemail-create-filter", handleOpenFilterModal);
      window.removeEventListener("suitemail-move-to-folder", handleMoveToFolder);
    };
  }, []);

  // Listen for tray "Check for Mail" button
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    if (typeof window !== "undefined" && window.supermail?.on) {
      unlisten = window.supermail.on("tray-check-mail", () => {
        const accounts = useAccountStore.getState().accounts;
        const activeIds = accounts.filter((a) => a.isActive).map((a) => a.id);
        if (activeIds.length > 0) {
          triggerSync(activeIds);
        }
      });
    }
    return () => { unlisten?.(); };
  }, []);

  useEffect(() => {
    startUpdateChecker();
    return stopUpdateChecker;
  }, []);

  // Initialize database, load accounts, start sync
  useEffect(() => {
    async function init() {
      let hasConfiguredAccounts = false;
      let startupSucceeded = false;
      try {
        await runMigrations();

        // Initialize OpenPGP keypair on first run
        try {
          const { initAppPgpKey } = await import("./services/crypto/pgpService");
          await initAppPgpKey();
        } catch (pgpErr) {
          console.warn("[App] Failed to initialize PGP identity:", pgpErr);
        }

        // Initialize settings sidecar auto-sync for IMAP accounts
        try {
          const { initSettingsSidecarAutoSync } = await import("./services/imap/settingsSidecarSync");
          initSettingsSidecarAutoSync();
        } catch (settingsErr) {
          console.warn("[App] Failed to initialize settings sidecar auto-sync:", settingsErr);
        }

        const ui = useUIStore.getState();

        // Restore persisted theme
        const savedTheme = await getSetting("theme");
        if (savedTheme === "light" || savedTheme === "dark" || savedTheme === "system") {
          ui.setTheme(savedTheme);
        }

        // Restore persisted sidebar state
        const savedSidebar = await getSetting("sidebar_collapsed");
        if (savedSidebar === "true") {
          ui.setSidebarCollapsed(true);
        }

        // Restore contact sidebar visibility
        const savedContactSidebar = await getSetting("contact_sidebar_visible");
        if (savedContactSidebar === "false") {
          ui.setContactSidebarVisible(false);
        }

        // Restore reading pane position
        const savedPanePos = await getSetting("reading_pane_position");
        if (savedPanePos === "right" || savedPanePos === "bottom" || savedPanePos === "hidden") {
          ui.setReadingPanePosition(savedPanePos);
        }

        // Restore the last calendar view before rendering Calendar.
        const savedCalendarView = await getSetting("calendar_view");
        if (savedCalendarView === "day" || savedCalendarView === "threeDay" || savedCalendarView === "week" || savedCalendarView === "month") {
          ui.setCalendarView(savedCalendarView);
        }

        // Restore read filter
        const savedReadFilter = await getSetting("read_filter");
        if (savedReadFilter === "all" || savedReadFilter === "read" || savedReadFilter === "unread") {
          ui.setReadFilter(savedReadFilter);
        }

        // Restore email list width
        const savedListWidth = await getSetting("email_list_width");
        if (savedListWidth) {
          const w = parseInt(savedListWidth, 10);
          if (w >= 240 && w <= 800) ui.setEmailListWidth(w);
        }

        // Restore email density
        const savedDensity = await getSetting("email_density");
        if (savedDensity === "compact" || savedDensity === "default" || savedDensity === "spacious") {
          ui.setEmailDensity(savedDensity);
        }

        // Restore default reply mode
        const savedReplyMode = await getSetting("default_reply_mode");
        if (savedReplyMode === "reply" || savedReplyMode === "replyAll") {
          ui.setDefaultReplyMode(savedReplyMode);
        }

        // Restore mark-as-read behavior
        const savedMarkRead = await getSetting("mark_as_read_behavior");
        if (savedMarkRead === "instant" || savedMarkRead === "2s" || savedMarkRead === "manual") {
          ui.setMarkAsReadBehavior(savedMarkRead);
        }

        // Restore send and archive
        const savedSendArchive = await getSetting("send_and_archive");
        if (savedSendArchive === "true") {
          ui.setSendAndArchive(true);
        }

        // Restore font scale
        const savedFontScale = await getSetting("font_size");
        if (savedFontScale === "small" || savedFontScale === "default" || savedFontScale === "large" || savedFontScale === "xlarge") {
          ui.setFontScale(savedFontScale);
        }

        // Restore color theme
        const savedColorTheme = await getSetting("color_theme");
        if (savedColorTheme && COLOR_THEMES.some((t) => t.id === savedColorTheme)) {
          ui.setColorTheme(savedColorTheme as ColorThemeId);
        }

        // Restore inbox view mode
        const savedViewMode = await getSetting("inbox_view_mode");
        if (savedViewMode === "unified" || savedViewMode === "split") {
          ui.setInboxViewMode(savedViewMode);
        }

        // Restore reduce motion preference
        const savedReduceMotion = await getSetting("reduce_motion");
        if (savedReduceMotion === "true") {
          ui.setReduceMotion(true);
        }

        // Restore task sidebar visibility
        const savedTaskSidebar = await getSetting("task_sidebar_visible");
        if (savedTaskSidebar === "true") {
          ui.setTaskSidebarVisible(true);
        }

        // Restore sidebar nav config
        const savedNavConfig = await getSetting("sidebar_nav_config");
        if (savedNavConfig) {
          try {
            const parsed = JSON.parse(savedNavConfig);
            if (Array.isArray(parsed)) ui.restoreSidebarNavConfig(parsed);
          } catch { /* ignore malformed JSON */ }
        }

        // Load custom keyboard shortcuts
        await useShortcutStore.getState().loadKeyMap();

        const dbAccounts = await getAllAccounts();
        hasConfiguredAccounts = dbAccounts.some((account) => account.provider !== "sandbox");
        const mapped = toStoreAccounts(dbAccounts);
        const savedAccountId = await getSetting("active_account_id");
        useAccountStore.getState().setAccounts(mapped, savedAccountId);

        // No mail yet: open add-account instead of the empty inbox.
        // Calendar-only CalDAV accounts do not count as mail.
        if (!hasMailAccount(mapped)) {
          setShowAddAccount(true);
        }

        // Initialize Gmail clients for existing accounts
        await initializeClients();
        await initNotifications();

        // Fetch send-as aliases in background for active Gmail accounts
        const activeIds = mapped.filter((a) => a.isActive).map((a) => a.id);
        const gmailAccountIds = mapped
          .filter((a) => a.isActive && (a.provider === "gmail" || a.provider === "gmail_api"))
          .map((a) => a.id);
        for (const accountId of gmailAccountIds) {
          getGmailClient(accountId)
            .then((client) => fetchSendAsAliases(client, accountId))
            .catch((err) => {
              console.warn(`Failed to fetch send-as aliases for ${accountId}:`, err);
            });
        }

        // Start background sync for active accounts
        if (activeIds.length > 0) {
          startBackgroundSync(activeIds);
        }

        // Start IMAP IDLE push listeners
        startAllIdle(dbAccounts);

        // Start snooze, scheduled send, follow-up, bundle, and queue checkers
        startSnoozeChecker();
        startScheduledSendChecker();
        startFollowUpChecker();
        startBundleChecker();
        startQueueProcessor();
        startPreCacheManager();
        startAttachmentIndex();

        // Initialize global compose shortcut
        await initGlobalShortcut();

        // Initialize deep link handler
        deepLinkCleanupRef.current = await initDeepLinkHandler();

        // Initial badge count
        await updateBadgeCount();

        // Load initial task count
        const activeAcct = useAccountStore.getState().activeAccountId;
        if (activeAcct) {
          const count = await getIncompleteTaskCount(activeAcct);
          useTaskStore.getState().setIncompleteCount(count);
        }
        startupSucceeded = true;
      } catch (err) {
        console.error("Failed to initialize:", err);
      }
      setInitialized(true);
      invoke<boolean | undefined>("close_splashscreen", { hasConfiguredAccounts, startupSucceeded }).then(
        (showPrompt) => setShowStartupTelemetryPrompt((current) => current || showPrompt === true),
        () => setShowStartupTelemetryPrompt((current) => current ?? false),
      );
    }

    init();

    return () => {
      stopBackgroundSync();
      stopAllIdle();
      stopSnoozeChecker();
      stopScheduledSendChecker();
      stopFollowUpChecker();
      stopBundleChecker();
      stopQueueProcessor();
      stopPreCacheManager();
    stopAttachmentIndex();
      unregisterComposeShortcut();
      deepLinkCleanupRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store setters are stable references
  }, []);

  // The in-memory list can be empty while SQLite still has accounts (for example
  // after a hot reload). Reload them instead of showing the empty inbox.
  useEffect(() => {
    if (!initialized || accountCount > 0) return;
    let cancelled = false;

    (async () => {
      try {
        const dbAccounts = await getAllAccounts();
        if (cancelled || useAccountStore.getState().accounts.length > 0) return;
        if (dbAccounts.length === 0) {
          setShowAddAccount(true);
          return;
        }

        const mapped = toStoreAccounts(dbAccounts);
        const savedAccountId = await getSetting("active_account_id");
        if (cancelled || useAccountStore.getState().accounts.length > 0) return;
        useAccountStore.getState().setAccounts(mapped, savedAccountId);
        setShowAddAccount(false);

        const activeIds = mapped.filter((a) => a.isActive).map((a) => a.id);
        if (activeIds.length > 0) {
          startBackgroundSync(activeIds, true);
        }
      } catch (err) {
        console.error("Failed to reload accounts from database:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialized, accountCount]);

  useEffect(() => {
    if (!initialized || !hasAndroidBackgroundSync()) return;
    let disposed = false;
    let foreground: boolean | undefined;
    const onStateChange = ({ isActive }: { isActive: boolean }) => {
      if (disposed || foreground === isActive) return;
      foreground = isActive;
      setAndroidSyncForeground(isActive);
      if (!isActive) {
        stopBackgroundSync();
        return;
      }
      const activeIds = useAccountStore.getState().accounts.filter((account) => account.isActive).map((account) => account.id);
      if (activeIds.length) startBackgroundSync(activeIds);
    };
    const listener = AndroidApp.addListener("appStateChange", onStateChange);
    void AndroidApp.getState().then((state) => {
      if (foreground === undefined && !state.isActive) onStateChange(state);
    }).catch(() => {});
    return () => {
      disposed = true;
      setAndroidSyncForeground(undefined);
      void listener.then((handle) => handle.remove()).catch(() => {});
    };
  }, [initialized]);

  // Listen for sync status updates
  const backfillDoneRef = useRef(false);
  useEffect(() => {
    const unsub = onSyncStatus((accountId, status, _progress, error) => {
      useUIStore.getState().setAccountSyncing(accountId, status === "syncing");
      if (status === "done") {
        setSyncFailure((failure) => failure?.accountId === accountId ? null : failure);
        window.dispatchEvent(new Event("suitemail-sync-done"));
        updateBadgeCount();

        // Backfill uncategorized threads after first successful sync
        if (!backfillDoneRef.current) {
          backfillDoneRef.current = true;
          import("./services/categorization/backfillService")
            .then(({ backfillUncategorizedThreads }) => backfillUncategorizedThreads(accountId))
            .catch((err) => console.error("Backfill error:", err));
        }
      } else if (status === "error" || status === "interrupted") {
        if (status === "error") {
          setSyncFailure({ accountId, message: error ? `Sync failed: ${formatSyncError(error)}` : "Sync failed" });
        }
        // Still dispatch sync-done so the UI refreshes with any partially stored data
        window.dispatchEvent(new Event("suitemail-sync-done"));
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!syncFailure) return;
    const timeout = setTimeout(() => setSyncFailure(null), 8_000);
    return () => clearTimeout(timeout);
  }, [syncFailure]);

  // Sync theme class to <html> element
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else if (theme === "light") {
      root.classList.remove("dark");
    } else {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const apply = () => {
        if (mq.matches) {
          root.classList.add("dark");
        } else {
          root.classList.remove("dark");
        }
      };
      apply();
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme]);

  // Sync font-scale class to <html> element
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("font-scale-small", "font-scale-default", "font-scale-large", "font-scale-xlarge");
    root.classList.add(`font-scale-${fontScale}`);
  }, [fontScale]);

  // Sync reduce-motion class to <html> element
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("reduce-motion", reduceMotion);
  }, [reduceMotion]);

  // Apply color theme CSS custom properties to <html>
  useEffect(() => {
    const root = document.documentElement;
    const props = ["--color-accent", "--color-accent-hover", "--color-accent-light", "--color-bg-selected", "--color-sidebar-active"];

    const apply = () => {
      if (colorTheme === DEFAULT_COLOR_THEME) {
        // Default theme — remove inline overrides, let CSS handle it
        for (const p of props) root.style.removeProperty(p);
        return;
      }
      const themeData = getThemeById(colorTheme);
      const isDark =
        theme === "dark" ||
        (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      const colors = isDark ? themeData.dark : themeData.light;
      root.style.setProperty("--color-accent", colors.accent);
      root.style.setProperty("--color-accent-hover", colors.accentHover);
      root.style.setProperty("--color-accent-light", colors.accentLight);
      root.style.setProperty("--color-bg-selected", colors.bgSelected);
      root.style.setProperty("--color-sidebar-active", colors.sidebarActive);
    };

    apply();

    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [colorTheme, theme]);

  const handleAddAccountSuccess = useCallback(async () => {
    setShowAddAccount(false);
    const addedAccountId = useAccountStore.getState().activeAccountId;
    const dbAccounts = await getAllAccounts();
    const mapped = toStoreAccounts(dbAccounts);
    useAccountStore.getState().setAccounts(mapped, addedAccountId);

    // Re-initialize clients for the new account
    await initializeClients();

    const newest = mapped.find((account) => account.id === addedAccountId);
    if (newest) {
      // Sync the new account immediately — before restarting the background
      // timer so it doesn't queue behind delta syncs for existing accounts.
      syncAccount(newest.id);

      // Fetch send-as aliases in the background (non-blocking, skip CalDAV-only accounts)
      if (newest.provider !== "caldav") {
        getGmailClient(newest.id)
          .then((client) => fetchSendAsAliases(client, newest.id))
          .catch((err) => console.warn(`Failed to fetch send-as aliases for new account:`, err));
      }
    }

    // Restart background sync for all accounts, but skip the immediate run
    // since we already triggered the new account's sync above.
    const activeIds = mapped.filter((a) => a.isActive).map((a) => a.id);
    startBackgroundSync(activeIds, true);
  }, []);

  if (!initialized) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg-primary">
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-10 h-10">
            <div className="absolute inset-0 rounded-full border-2 border-accent/20" />
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-accent animate-spin" />
          </div>
          <span className="text-xs text-text-tertiary animate-pulse">Loading your inbox...</span>
        </div>
      </div>
    );
  }

  return (
    <div data-app-shell className="flex flex-col h-screen overflow-hidden text-text-primary">
      <OfflineBanner />
      {/* Animated gradient blobs for glassmorphism effect */}
      <div className="animated-bg" aria-hidden="true">
        <div className="blob" />
        <div className="blob" />
        <div className="blob" />
        <div className="blob" />
        <div className="blob" />
      </div>
      <TitleBar />
      <div data-app-content className="flex flex-1 min-w-0 overflow-hidden">
        <DndProvider>
          <ErrorBoundary name="Sidebar">
            <Sidebar
              collapsed={sidebarCollapsed}
              onAddAccount={() => setShowAddAccount(true)}
            />
          </ErrorBoundary>
          <Outlet />
        </DndProvider>
      </div>

      {syncFailure && (
        <div
          data-sync-failure
          role="status"
          className={`fixed bottom-0 left-0 right-0 glass-panel bg-danger/90 text-white text-xs px-4 py-1.5 text-center z-40 animate-[slideUp_200ms_ease-out,fadeIn_200ms_ease-out] ${
            sidebarCollapsed ? "md:left-16" : "md:left-60"
          }`}
        >
          {syncFailure.message}
        </div>
      )}

      <MobileNavBar />
      {Capacitor.getPlatform() === "android" && (
        <AiCoreStartup canPrompt={!showAddAccount && showStartupTelemetryPrompt === false} />
      )}
      {showStartupTelemetryPrompt && (
        <StartupTelemetryPopover onClose={() => setShowStartupTelemetryPrompt(false)} />
      )}

      {showAddAccount && (
        <AddAccount
          onClose={() => setShowAddAccount(false)}
          onSuccess={handleAddAccountSuccess}
        />
      )}

      <ErrorBoundary name="Composer">
        <Composer />
      </ErrorBoundary>
      <UndoSendToast />
      <ScheduledSendToast />
      <ActionFeedbackToast />
      <UpdateToast />
      <ErrorBoundary name="CommandPalette">
        <CommandPalette
          isOpen={showCommandPalette}
          onClose={() => setShowCommandPalette(false)}
        />
      </ErrorBoundary>
      <ShortcutsHelp
        isOpen={showShortcutsHelp}
        onClose={() => setShowShortcutsHelp(false)}
      />
      <ErrorBoundary name="AskInbox">
        <AskInbox
          isOpen={showAskInbox}
          onClose={() => setShowAskInbox(false)}
        />
      </ErrorBoundary>
      <ErrorBoundary name="AiFilterSuggestModal">
        <AiFilterSuggestModal
          isOpen={showAiSuggestFilter}
          initialMode={filterModalMode}
          onClose={() => setShowAiSuggestFilter(false)}
        />
      </ErrorBoundary>
      <ErrorBoundary name="AgentConsentPopover">
        <AgentConsentPopover />
      </ErrorBoundary>
      <ErrorBoundary name="OutgoingSyncPopover">
        <OutgoingSyncPopover />
      </ErrorBoundary>
      <ContextMenuPortal />
      <MoveToFolderDialog
        isOpen={moveToFolderState.open}
        threadIds={moveToFolderState.threadIds}
        onClose={() => setMoveToFolderState({ open: false, threadIds: [] })}
      />
    </div>
  );
}
