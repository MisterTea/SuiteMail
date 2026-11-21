import { useEffect, useState, useCallback, useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { FeedbackButton } from "../feedback/FeedbackButton";
import { AccountSwitcher } from "../accounts/AccountSwitcher";
import { LabelForm } from "../labels/LabelForm";
import { InputDialog } from "../ui/InputDialog";
import { useUIStore } from "@/stores/uiStore";
import { useComposerStore } from "@/stores/composerStore";
import { useAccountStore } from "@/stores/accountStore";
import { useLabelStore, type Label } from "@/stores/labelStore";
import { useContextMenuStore } from "@/stores/contextMenuStore";
import { useSmartFolderStore } from "@/stores/smartFolderStore";
import { useActiveLabel, useActiveCategory } from "@/hooks/useRouteNavigation";
import { navigateToLabel } from "@/router/navigate";
import {
  Inbox,
  Star,
  Clock,
  Send,
  FileEdit,
  Trash2,
  Ban,
  Mail,
  CheckSquare,
  Calendar,
  Settings,
  Plus,
  Tag,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  PenSquare,
  RefreshCw,
  Columns2,
  Bell,
  Users,
  Newspaper,
  Search,
  MailOpen,
  Paperclip,
  FolderSearch,
  Loader2,
  Bookmark,
  ShoppingBag,
  Info,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";
import { useTaskStore } from "@/stores/taskStore";
import { getDraftCountForAccount, getSnoozedCount, getStarredCount, getUnreadInboxCountForAccount, getUnreadInboxCountsForLabels, getUnreadFocusedInboxCount, getUnreadOtherInboxCount } from "@/services/db/threads";
import { triggerSync } from "@/services/gmail/syncManager";
import { GMAIL_NAV_SPECS, gmailNavSpec, insertGmailNavIds, isGmailProvider } from "@/constants/gmailSidebar";

interface SidebarProps {
  collapsed: boolean;
  onAddAccount: () => void;
}

export const ALL_NAV_ITEMS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "starred", label: "Starred", icon: Star },
  { id: "snoozed", label: "Snoozed", icon: Clock },
  { id: "sent", label: "Sent", icon: Send },
  { id: "drafts", label: "Drafts", icon: FileEdit },
  { id: "trash", label: "Trash", icon: Trash2 },
  { id: "spam", label: "Spam", icon: Ban },
  { id: "all", label: "All Mail", icon: Mail },
  { id: "tasks", label: "Tasks", icon: CheckSquare },
  { id: "calendar", label: "Calendar", icon: Calendar },
  { id: "attachments", label: "Attachments", icon: Paperclip },
  { id: "smart-folders", label: "Smart Folders", icon: FolderSearch },
  { id: "labels", label: "Labels", icon: Tag },
];

const GMAIL_EXTRA_NAV: Record<string, { id: string; label: string; icon: LucideIcon }> = {
  important: { id: "important", label: "Important", icon: Bookmark },
  purchases: { id: "purchases", label: "Purchases", icon: ShoppingBag },
  social: { id: "social", label: "Social", icon: Users },
  updates: { id: "updates", label: "Updates", icon: Info },
  forums: { id: "forums", label: "Forums", icon: MessagesSquare },
  promotions: { id: "promotions", label: "Promotions", icon: Tag },
};

const CATEGORY_ITEMS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "Primary", label: "Primary", icon: Inbox },
  { id: "Updates", label: "Updates", icon: Bell },
  { id: "Promotions", label: "Promotions", icon: Tag },
  { id: "Social", label: "Social", icon: Users },
  { id: "Newsletters", label: "Newsletters", icon: Newspaper },
];

function DroppableNavItem({
  id,
  isActive,
  collapsed,
  onClick,
  onContextMenu,
  title,
  ariaLabel,
  children,
}: {
  id: string;
  isActive: boolean;
  collapsed: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  title?: string;
  ariaLabel?: string;
  children: (isOver: boolean) => React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const isTrash = id === "trash";
  const isStarred = id === "starred";
  const isDrafts = id === "drafts";

  return (
    <button
      ref={setNodeRef}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={title}
      aria-label={ariaLabel}
      className={`flex items-center w-full py-2.5 md:py-2 min-h-[48px] md:min-h-0 text-sm rounded-xl md:rounded-lg transition-colors press-scale touch-manipulation active:scale-[0.98] ${
        collapsed ? "justify-center px-0" : "gap-3 px-3 text-left"
      } ${
        isOver
          ? isTrash
            ? "bg-red-500/20 ring-1 ring-red-500/50 text-red-500"
            : isStarred || isDrafts
              ? "bg-amber-500/20 ring-1 ring-amber-500/50 text-amber-500"
              : "bg-accent/20 ring-1 ring-accent"
          : isActive
            ? isTrash
              ? "bg-red-500/15 text-red-600 dark:text-red-400 font-semibold ring-1 ring-red-500/20 shadow-2xs"
              : isStarred || isDrafts
                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold ring-1 ring-amber-500/20"
                : "bg-accent/10 text-accent font-medium"
            : isTrash
              ? "hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 active:bg-red-500/20 active:text-red-600 dark:active:text-red-400 text-sidebar-text"
              : isStarred || isDrafts
                ? "hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400 text-sidebar-text"
                : "hover:bg-sidebar-hover text-sidebar-text"
      }`}
    >
      {children(isOver)}
    </button>
  );
}

function DroppableLabelItem({
  label,
  isActive,
  collapsed,
  onClick,
  onContextMenu,
  onEditClick,
}: {
  label: Label;
  isActive: boolean;
  collapsed: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onEditClick: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: label.id });
  const initial = (label.name[0] ?? "?").toUpperCase();

  return (
    <button
      ref={setNodeRef}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={collapsed ? label.name : undefined}
      className={`group flex items-center w-full py-2 text-sm transition-colors ${
        collapsed ? "justify-center px-0" : "gap-3 px-3 text-left"
      } ${
        isOver
          ? "bg-accent/20 ring-1 ring-accent"
          : isActive
            ? "bg-accent/10 text-accent font-medium"
            : "hover:bg-sidebar-hover text-sidebar-text"
      }`}
    >
      {collapsed ? (
        <span
          className="w-7 h-7 rounded-md flex items-center justify-center text-xs font-semibold shrink-0"
          style={label.colorBg
            ? { backgroundColor: label.colorBg, color: label.colorFg ?? "#ffffff" }
            : undefined
          }
        >
          {label.colorBg ? (
            initial
          ) : (
            <Tag size={14} />
          )}
        </span>
      ) : (
        <>
          {label.colorBg ? (
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: label.colorBg }}
            />
          ) : (
            <Tag size={14} className="shrink-0" />
          )}
          <span className="flex-1 truncate">{label.name}</span>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onEditClick(); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onEditClick(); } }}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-sidebar-text/40 hover:text-sidebar-text transition-opacity"
            title="Edit label"
          >
            <Pencil size={12} />
          </span>
        </>
      )}
    </button>
  );
}

const SMART_FOLDER_ICON_MAP: Record<string, LucideIcon> = {
  Search,
  MailOpen,
  Paperclip,
  Star,
  FolderSearch,
  Inbox,
  Clock,
  Tag,
};

function getSmartFolderIcon(iconName: string): LucideIcon {
  return SMART_FOLDER_ICON_MAP[iconName] ?? Search;
}

const LABELS_COLLAPSED_COUNT = 3;

export function Sidebar({ collapsed, onAddAccount }: SidebarProps) {
  const activeLabel = useActiveLabel();
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const sidebarNavConfig = useUIStore((s) => s.sidebarNavConfig);
  const taskIncompleteCount = useTaskStore((s) => s.incompleteCount);
  const inboxViewMode = useUIStore((s) => s.inboxViewMode);
  const setInboxViewMode = useUIStore((s) => s.setInboxViewMode);
  const activeCategory = useActiveCategory();
  const openComposer = useComposerStore((s) => s.openComposer);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const isGmailAccount = useAccountStore((s) =>
    isGmailProvider(s.accounts.find((account) => account.id === s.activeAccountId)?.provider),
  );
  const isEwsAccount = useAccountStore((s) =>
    s.accounts.find((account) => account.id === s.activeAccountId)?.provider === "ews",
  );
  const labels = useLabelStore((s) => s.labels);
  const loadLabels = useLabelStore((s) => s.loadLabels);
  const deleteLabel = useLabelStore((s) => s.deleteLabel);
  const smartFolders = useSmartFolderStore((s) => s.folders);
  const smartFolderCounts = useSmartFolderStore((s) => s.unreadCounts);
  const loadSmartFolders = useSmartFolderStore((s) => s.loadFolders);
  const refreshSmartFolderCounts = useSmartFolderStore((s) => s.refreshUnreadCounts);
  const createSmartFolder = useSmartFolderStore((s) => s.createFolder);
  const SECTION_IDS = new Set(["smart-folders", "labels"]);
  const [draftCount, setDraftCount] = useState<number>(0);
  const [snoozedCount, setSnoozedCount] = useState<number>(0);
  const [starredCount, setStarredCount] = useState<number>(0);
  const [inboxUnreadCount, setInboxUnreadCount] = useState<number>(0);
  const [focusedUnreadCount, setFocusedUnreadCount] = useState<number>(0);
  const [otherUnreadCount, setOtherUnreadCount] = useState<number>(0);
  const [gmailUnread, setGmailUnread] = useState<Record<string, number>>({});

  const { visibleNavItems, showSmartFolders, showLabels } = useMemo(() => {
    if (!sidebarNavConfig) {
      const navOnly = ALL_NAV_ITEMS.filter((i) => !SECTION_IDS.has(i.id));
      return { visibleNavItems: navOnly, showSmartFolders: true, showLabels: true };
    }
    const itemMap = new Map(ALL_NAV_ITEMS.map((item) => [item.id, item]));
    const result: typeof ALL_NAV_ITEMS = [];
    const seen = new Set<string>();
    let smartFoldersVisible = true;
    let labelsVisible = true;
    for (const entry of sidebarNavConfig) {
      seen.add(entry.id);
      if (entry.id === "smart-folders") { smartFoldersVisible = entry.visible; continue; }
      if (entry.id === "labels") { labelsVisible = entry.visible; continue; }
      if (entry.visible && itemMap.has(entry.id)) {
        result.push(itemMap.get(entry.id)!);
      }
    }
    // Append any new items not present in the saved config
    for (const item of ALL_NAV_ITEMS) {
      if (!seen.has(item.id) && !SECTION_IDS.has(item.id)) result.push(item);
    }
    return { visibleNavItems: result, showSmartFolders: smartFoldersVisible, showLabels: labelsVisible };
  }, [sidebarNavConfig]);

  const displayedNavItems = useMemo(() => {
    let items = visibleNavItems;
    if (isEwsAccount) {
      items = items.flatMap((item) => {
        if (item.id === "inbox") {
          return [
            { id: "focused", label: "Focused", icon: Inbox },
            { id: "other", label: "Other", icon: Inbox },
          ];
        }
        return [item];
      });
    }
    if (!isGmailAccount) return items;
    const byId = new Map<string, { id: string; label: string; icon: LucideIcon }>(
      items.map((item) => [item.id, item]),
    );
    return insertGmailNavIds(items.map((item) => item.id)).flatMap((id) => {
      const item = byId.get(id) ?? GMAIL_EXTRA_NAV[id];
      return item ? [item] : [];
    });
  }, [visibleNavItems, isEwsAccount, isGmailAccount]);

  const [labelsExpanded, setLabelsExpanded] = useState(false);
  const [isManualSyncing, setIsSyncing] = useState(false);
  const isAccountSyncing = useUIStore((s) =>
    activeAccountId !== null && s.syncingAccountIds.includes(activeAccountId),
  );
  const isSyncing = isManualSyncing || isAccountSyncing;

  // Inline label editing state
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [showNewLabelForm, setShowNewLabelForm] = useState(false);

  const openMenu = useContextMenuStore((s) => s.openMenu);
  const isSyncingFolder = useUIStore((s) => s.isSyncingFolder);
  const mobileSidebarOpen = useUIStore((s) => s.mobileSidebarOpen);
  const setMobileSidebarOpen = useUIStore((s) => s.setMobileSidebarOpen);

  const handleNavigate = useCallback((labelId: string, opts?: { category?: string }) => {
    navigateToLabel(labelId, opts as any);
    setMobileSidebarOpen(false);
  }, [setMobileSidebarOpen]);

  const handleNavContextMenu = useCallback((e: React.MouseEvent, navId: string) => {
    e.preventDefault();
    openMenu("sidebarNav", { x: e.clientX, y: e.clientY }, { navId });
  }, [openMenu]);

  // Load labels when active account changes
  useEffect(() => {
    if (activeAccountId) {
      loadLabels(activeAccountId);
    }
  }, [activeAccountId, loadLabels]);

  // Load smart folders when active account changes
  useEffect(() => {
    loadSmartFolders(activeAccountId ?? undefined);
    if (activeAccountId) {
      refreshSmartFolderCounts(activeAccountId);
    }
  }, [activeAccountId, loadSmartFolders, refreshSmartFolderCounts]);

  // Load draft, snoozed, and starred counts when active account changes
  useEffect(() => {
    let cancelled = false;
    if (activeAccountId) {
      getDraftCountForAccount(activeAccountId).then((c) => {
        if (!cancelled) setDraftCount(c);
      }).catch(() => {});
      getSnoozedCount(activeAccountId).then((c) => {
        if (!cancelled) setSnoozedCount(c);
      }).catch(() => {});
      getStarredCount(activeAccountId).then((c) => {
        if (!cancelled) setStarredCount(c);
      }).catch(() => {});
      getUnreadInboxCountForAccount(activeAccountId).then((c) => {
        if (!cancelled) setInboxUnreadCount(c);
      }).catch(() => {});
      if (isEwsAccount) {
        getUnreadFocusedInboxCount(activeAccountId).then((c) => {
          if (!cancelled) setFocusedUnreadCount(c);
        }).catch(() => {});
        getUnreadOtherInboxCount(activeAccountId).then((c) => {
          if (!cancelled) setOtherUnreadCount(c);
        }).catch(() => {});
      }
    } else {
      setDraftCount(0);
      setSnoozedCount(0);
      setStarredCount(0);
      setInboxUnreadCount(0);
      setFocusedUnreadCount(0);
      setOtherUnreadCount(0);
    }
    return () => {
      cancelled = true;
    };
  }, [activeAccountId]);

  // Reload labels, counts, and smart folder counts on sync completion (debounced to avoid waterfall from multiple emitters)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handler = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (activeAccountId) {
          loadLabels(activeAccountId);
          refreshSmartFolderCounts(activeAccountId);
          getDraftCountForAccount(activeAccountId).then(setDraftCount).catch(() => {});
          getSnoozedCount(activeAccountId).then(setSnoozedCount).catch(() => {});
          getStarredCount(activeAccountId).then(setStarredCount).catch(() => {});
          getUnreadInboxCountForAccount(activeAccountId).then(setInboxUnreadCount).catch(() => {});
          if (isEwsAccount) {
            getUnreadFocusedInboxCount(activeAccountId).then(setFocusedUnreadCount).catch(() => {});
            getUnreadOtherInboxCount(activeAccountId).then(setOtherUnreadCount).catch(() => {});
          }
        }
        useUIStore.getState().setSyncingFolder(null);
      }, 500);
    };

    const draftHandler = () => {
      if (activeAccountId) {
        getDraftCountForAccount(activeAccountId).then(setDraftCount).catch(() => {});
      }
    };

    const unreadHandler = () => {
      if (activeAccountId) {
        getUnreadInboxCountForAccount(activeAccountId).then(setInboxUnreadCount).catch(() => {});
        if (isEwsAccount) {
          getUnreadFocusedInboxCount(activeAccountId).then(setFocusedUnreadCount).catch(() => {});
          getUnreadOtherInboxCount(activeAccountId).then(setOtherUnreadCount).catch(() => {});
        }
        refreshSmartFolderCounts(activeAccountId);
      }
    };

    window.addEventListener("suitemail-sync-done", handler);
    window.addEventListener("suitemail-sync-progress", handler);
    window.addEventListener("draft-count-changed", draftHandler);
    window.addEventListener("unread-count-changed", unreadHandler);
    return () => {
      window.removeEventListener("suitemail-sync-done", handler);
      window.removeEventListener("suitemail-sync-progress", handler);
      window.removeEventListener("draft-count-changed", draftHandler);
      window.removeEventListener("unread-count-changed", unreadHandler);
      if (timer) clearTimeout(timer);
    };
  }, [activeAccountId, loadLabels, refreshSmartFolderCounts]);

  // Unread counts for Gmail categories (Purchases, Social, Updates, Forums, Promotions).
  useEffect(() => {
    let cancelled = false;
    if (!activeAccountId || !isGmailAccount) {
      setGmailUnread({});
      return;
    }
    const labelIds = GMAIL_NAV_SPECS.filter((spec) => spec.showUnreadCount).map((spec) => spec.gmailLabelId);
    const load = () => {
      getUnreadInboxCountsForLabels(activeAccountId, labelIds).then((counts) => {
        if (cancelled) return;
        const next: Record<string, number> = {};
        for (const spec of GMAIL_NAV_SPECS) {
          if (!spec.showUnreadCount) continue;
          const count = counts.get(spec.gmailLabelId) ?? 0;
          if (count > 0) next[spec.id] = count;
        }
        setGmailUnread(next);
      }).catch(() => {});
    };
    load();
    window.addEventListener("suitemail-sync-done", load);
    window.addEventListener("suitemail-sync-progress", load);
    window.addEventListener("unread-count-changed", load);
    return () => {
      cancelled = true;
      window.removeEventListener("suitemail-sync-done", load);
      window.removeEventListener("suitemail-sync-progress", load);
      window.removeEventListener("unread-count-changed", load);
    };
  }, [activeAccountId, isGmailAccount]);

  const handleDeleteLabel = useCallback(async (labelId: string) => {
    if (!activeAccountId) return;
    try {
      await deleteLabel(activeAccountId, labelId);
      if (editingLabelId === labelId) setEditingLabelId(null);
    } catch {
      // Silently fail in sidebar — user can use Settings for detailed errors
    }
  }, [activeAccountId, deleteLabel, editingLabelId]);

  const handleFormDone = useCallback(() => {
    setEditingLabelId(null);
    setShowNewLabelForm(false);
  }, []);

  const handleEditLabel = useCallback((labelId: string) => {
    setShowNewLabelForm(false);
    setEditingLabelId(labelId);
  }, []);

  const handleLabelContextMenu = useCallback((e: React.MouseEvent, labelId: string) => {
    e.preventDefault();
    openMenu("sidebarLabel", { x: e.clientX, y: e.clientY }, {
      labelId,
      onEdit: () => handleEditLabel(labelId),
      onDelete: () => handleDeleteLabel(labelId),
    });
  }, [openMenu, handleEditLabel, handleDeleteLabel]);

  const handleAddLabel = useCallback(() => {
    setEditingLabelId(null);
    setShowNewLabelForm(true);
  }, []);

  const [showSmartFolderModal, setShowSmartFolderModal] = useState(false);

  const handleAddSmartFolder = useCallback(() => {
    setShowSmartFolderModal(true);
  }, []);

  const handleManualSync = useCallback(async () => {
    if (!activeAccountId || isSyncing) return;
    setIsSyncing(true);
    useUIStore.getState().setSyncingFolder(activeLabel);
    try {
      await triggerSync([activeAccountId]);
    } catch (err) {
      console.error("Manual sync failed:", err);
    } finally {
      setIsSyncing(false);
      useUIStore.getState().setSyncingFolder(null);
    }
  }, [activeAccountId, activeLabel, isSyncing]);

  const editingLabel = editingLabelId ? labels.find((l) => l.id === editingLabelId) ?? null : null;

  return (
    <>
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs md:hidden animate-[fadeIn_150ms_ease-out]"
          onClick={() => setMobileSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={`no-select flex-col bg-sidebar-bg text-sidebar-text border-r border-border-primary transition-all duration-200 glass-panel ${
          mobileSidebarOpen
            ? "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] shadow-2xl"
            : "hidden md:flex"
        } ${collapsed && !mobileSidebarOpen ? "md:w-16" : "md:w-60"}`}
      >
      {mobileSidebarOpen && <div className="flex items-center justify-between px-4 pt-3 md:hidden">
        <h2 className="text-lg font-semibold">Mail folders</h2>
        <button data-testid="close-mobile-folders" aria-label="Close folders" onClick={()=>setMobileSidebarOpen(false)} className="flex h-12 w-12 items-center justify-center rounded-full text-xl">×</button>
      </div>}
      <AccountSwitcher collapsed={collapsed && !mobileSidebarOpen} onAddAccount={onAddAccount} />

      {/* Compose and sync */}
      <div className={`px-3 py-2 flex gap-2 ${collapsed && !mobileSidebarOpen ? "flex-col items-center" : "items-center"}`}>
        <button
          type="button"
          aria-label="Compose"
          title="Compose"
          onClick={() => {
            openComposer();
            setMobileSidebarOpen(false);
          }}
          className="flex items-center justify-center h-9 w-9 shrink-0 bg-accent hover:bg-accent-hover text-white rounded-lg interactive-btn"
        >
          <PenSquare size={16} />
        </button>
        <button
          type="button"
          aria-label="Sync"
          aria-busy={isSyncing}
          title={isSyncing ? "Syncing…" : "Sync"}
          onClick={() => { void handleManualSync(); }}
          disabled={!activeAccountId || isSyncing}
          className="flex items-center justify-center h-9 w-9 shrink-0 rounded-lg text-sidebar-text hover:bg-sidebar-hover disabled:opacity-40 interactive-btn"
        >
          <RefreshCw size={16} className={isSyncing ? "animate-spin" : ""} />
        </button>
        <FeedbackButton />
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        {displayedNavItems.map((item) => {
          const Icon = item.icon;
          const isInbox = item.id === "inbox";
          const isFocused = item.id === "focused";
          const isOther = item.id === "other";
          const isEffectiveCollapsed = collapsed && !mobileSidebarOpen;
          const gmailCount = gmailNavSpec(item.id)?.showUnreadCount ? (gmailUnread[item.id] ?? 0) : 0;
          return (
            <div key={item.id}>
              <DroppableNavItem
                id={item.id}
                isActive={isInbox ? (activeLabel === "inbox" && (inboxViewMode === "unified" || activeCategory === "Primary")) : activeLabel === item.id}
                collapsed={isEffectiveCollapsed}
                onClick={() => {
                  if (isInbox && inboxViewMode === "split") {
                    handleNavigate(item.id, { category: "Primary" });
                  } else {
                    handleNavigate(item.id);
                  }
                }}
                onContextMenu={(e) => handleNavContextMenu(e, item.id)}
                title={collapsed ? item.label : undefined}
                ariaLabel={gmailCount > 0 ? `${item.label}, ${gmailCount.toLocaleString("en-US")} unread` : undefined}
              >
                {() => (
                  <>
                    {isSyncingFolder === item.id ? (
                      <Loader2 size={18} className="shrink-0 animate-spin text-accent" />
                    ) : (
                      <Icon
                        size={18}
                        className={`shrink-0 transition-all duration-150 ${
                          item.id === "starred"
                            ? activeLabel === "starred"
                              ? "fill-amber-400 text-amber-500 dark:text-amber-400 drop-shadow-[0_0_6px_rgba(245,158,11,0.5)] star-animate"
                              : "text-amber-500/80 group-hover:text-amber-500"
                            : item.id === "trash"
                              ? activeLabel === "trash"
                                ? "text-red-600 dark:text-red-400 drop-shadow-[0_0_6px_rgba(239,68,68,0.4)]"
                                : "text-red-500/70 group-hover:text-red-500"
                              : item.id === "drafts"
                                ? activeLabel === "drafts"
                                  ? "text-amber-600 dark:text-amber-400 drop-shadow-[0_0_6px_rgba(245,158,11,0.4)]"
                                  : "text-amber-600/80 group-hover:text-amber-600 dark:text-amber-400"
                                : ""
                        }`}
                      />
                    )}
                    {!isEffectiveCollapsed && (
                      <span className={`flex-1 truncate ${gmailCount > 0 ? "font-semibold" : ""}`}>{item.label}</span>
                    )}
                    {item.id === "starred" && starredCount > 0 && !isEffectiveCollapsed && (
                      <span
                        data-testid="starred-count-badge"
                        className="text-[0.625rem] bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold px-1.5 rounded-full leading-normal shadow-2xs"
                      >
                        {starredCount}
                      </span>
                    )}
                    {item.id === "tasks" && taskIncompleteCount > 0 && !isEffectiveCollapsed && (
                      <span className="text-[0.625rem] bg-accent/15 text-accent px-1.5 rounded-full leading-normal">
                        {taskIncompleteCount}
                      </span>
                    )}
                    {item.id === "snoozed" && snoozedCount > 0 && !isEffectiveCollapsed && (
                      <span className="text-[0.625rem] bg-accent/15 text-accent px-1.5 rounded-full leading-normal">
                        {snoozedCount}
                      </span>
                    )}
                    {item.id === "drafts" && draftCount > 0 && !isEffectiveCollapsed && (
                      <span
                        data-testid="drafts-count-badge"
                        className="text-[0.6875rem] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/25 px-2 py-0.5 rounded-full leading-tight shadow-2xs min-w-[1.25rem] text-center"
                      >
                        {draftCount}
                      </span>
                    )}
                    {gmailCount > 0 && !isEffectiveCollapsed && (
                      <span
                        data-testid={`gmail-count-${item.id}`}
                        className="text-xs font-semibold tabular-nums"
                      >
                        {gmailCount.toLocaleString("en-US")}
                      </span>
                    )}
                    {isInbox && inboxUnreadCount > 0 && !isEffectiveCollapsed && (
                      <span
                        data-testid="inbox-unread-badge"
                        className="text-[0.6875rem] font-bold bg-accent/15 text-accent px-1.5 rounded-full leading-normal min-w-[1.25rem] text-center"
                      >
                        {inboxUnreadCount}
                      </span>
                    )}
                    {isFocused && focusedUnreadCount > 0 && !isEffectiveCollapsed && (
                      <span
                        data-testid="focused-unread-badge"
                        className="text-[0.6875rem] font-bold bg-accent/15 text-accent px-1.5 rounded-full leading-normal min-w-[1.25rem] text-center"
                      >
                        {focusedUnreadCount}
                      </span>
                    )}
                    {isOther && otherUnreadCount > 0 && !isEffectiveCollapsed && (
                      <span
                        data-testid="other-unread-badge"
                        className="text-[0.6875rem] font-bold bg-accent/15 text-accent px-1.5 rounded-full leading-normal min-w-[1.25rem] text-center"
                      >
                        {otherUnreadCount}
                      </span>
                    )}
                    {isInbox && !isEffectiveCollapsed && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          setInboxViewMode(inboxViewMode === "split" ? "unified" : "split");
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            setInboxViewMode(inboxViewMode === "split" ? "unified" : "split");
                          }
                        }}
                        title={inboxViewMode === "split" ? "Switch to unified inbox" : "Switch to split inbox"}
                        className={`p-1 rounded transition-colors ${
                          inboxViewMode === "split"
                            ? "text-accent hover:bg-accent/10"
                            : "text-sidebar-text/40 hover:text-sidebar-text hover:bg-sidebar-hover"
                        }`}
                      >
                        <Columns2 size={14} />
                      </span>
                    )}
                  </>
                )}
              </DroppableNavItem>
              {/* Category sub-items when split mode is active */}
              {isInbox && inboxViewMode === "split" && !collapsed && (
                <div>
                  {CATEGORY_ITEMS.map((cat) => {
                    const CatIcon = cat.icon;
                    const isCatActive = activeLabel === "inbox" && activeCategory === cat.id;
                    return (
                      <button
                        key={cat.id}
                        onClick={() => {
                          handleNavigate("inbox", { category: cat.id });
                        }}
                        className={`flex items-center gap-2 w-full py-1.5 pl-7 pr-3 text-left text-[0.8125rem] transition-colors ${
                          isCatActive
                            ? "text-accent font-medium"
                            : "text-sidebar-text/70 hover:text-sidebar-text hover:bg-sidebar-hover"
                        }`}
                      >
                        <CatIcon size={14} className="shrink-0" />
                        <span className="flex-1 truncate">{cat.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Smart Folders */}
        {showSmartFolders && (smartFolders.length > 0 || !collapsed) && (
          <>
            {!collapsed && (
              <div className="flex items-center justify-between px-3 pt-4 pb-1">
                <span className="text-xs font-medium text-sidebar-text/60 uppercase tracking-wider">
                  Smart Folders
                </span>
                <button
                  onClick={handleAddSmartFolder}
                  className="p-0.5 text-sidebar-text/40 hover:text-sidebar-text transition-colors"
                  title="Add smart folder"
                >
                  <Plus size={14} />
                </button>
              </div>
            )}
            {smartFolders.map((folder) => {
              const Icon = getSmartFolderIcon(folder.icon);
              const isActive = activeLabel === `smart-folder:${folder.id}`;
              const count = smartFolderCounts[folder.id] ?? 0;
              return (
                <button
                  key={folder.id}
                  onClick={() => handleNavigate(`smart-folder:${folder.id}`)}
                  title={collapsed ? folder.name : undefined}
                  className={`flex items-center w-full py-2 text-sm transition-colors press-scale ${
                    collapsed ? "justify-center px-0" : "gap-3 px-3 text-left"
                  } ${
                    isActive
                      ? "bg-accent/10 text-accent font-medium"
                      : "hover:bg-sidebar-hover text-sidebar-text"
                  }`}
                >
                  <Icon
                    size={18}
                    className="shrink-0"
                    style={folder.color ? { color: folder.color } : undefined}
                  />
                  {!collapsed && (
                    <>
                      <span className="flex-1 truncate">{folder.name}</span>
                      {count > 0 && (
                        <span className="text-[0.625rem] bg-accent/15 text-accent px-1.5 rounded-full leading-normal">
                          {count}
                        </span>
                      )}
                    </>
                  )}
                </button>
              );
            })}
          </>
        )}

        {/* User labels */}
        {showLabels && (labels.length > 0 || !collapsed) && (
          <>
            {!collapsed && (
              <div className="flex items-center justify-between px-3 pt-4 pb-1">
                <span className="text-xs font-medium text-sidebar-text/60 uppercase tracking-wider">
                  Labels
                </span>
                <button
                  onClick={handleAddLabel}
                  className="p-0.5 text-sidebar-text/40 hover:text-sidebar-text transition-colors"
                  title="Add label"
                >
                  <Plus size={14} />
                </button>
              </div>
            )}
            {/* Always-visible labels */}
            {labels.slice(0, LABELS_COLLAPSED_COUNT).map((label) => (
              <div key={label.id}>
                <DroppableLabelItem
                  label={label}
                  isActive={activeLabel === label.id}
                  collapsed={collapsed}
                  onClick={() => handleNavigate(label.id)}
                  onContextMenu={(e) => handleLabelContextMenu(e, label.id)}
                  onEditClick={() => handleEditLabel(label.id)}
                />
                {editingLabelId === label.id && activeAccountId && !collapsed && (
                  <LabelForm
                    accountId={activeAccountId}
                    label={editingLabel}
                    onDone={handleFormDone}
                    variant="sidebar"
                  />
                )}
              </div>
            ))}
            {/* Collapsible labels with accordion animation */}
            {labels.length > LABELS_COLLAPSED_COUNT && (
              <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${labelsExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                <div className="overflow-hidden">
                  {labels.slice(LABELS_COLLAPSED_COUNT).map((label) => (
                    <div key={label.id}>
                      <DroppableLabelItem
                        label={label}
                        isActive={activeLabel === label.id}
                        collapsed={collapsed}
                        onClick={() => handleNavigate(label.id)}
                        onContextMenu={(e) => handleLabelContextMenu(e, label.id)}
                        onEditClick={() => handleEditLabel(label.id)}
                      />
                      {editingLabelId === label.id && activeAccountId && !collapsed && (
                        <LabelForm
                          accountId={activeAccountId}
                          label={editingLabel}
                          onDone={handleFormDone}
                          variant="sidebar"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!collapsed && labels.length > LABELS_COLLAPSED_COUNT && (
              <button
                onClick={() => setLabelsExpanded((v) => !v)}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-sidebar-text/60 hover:text-sidebar-text transition-colors"
              >
                {labelsExpanded ? (
                  <>
                    <ChevronUp size={12} />
                    <span>Show less</span>
                  </>
                ) : (
                  <>
                    <ChevronDown size={12} />
                    <span>{labels.length - LABELS_COLLAPSED_COUNT} more</span>
                  </>
                )}
              </button>
            )}
            {/* New label form at bottom of list */}
            {showNewLabelForm && activeAccountId && !collapsed && (
              <LabelForm
                accountId={activeAccountId}
                onDone={handleFormDone}
                variant="sidebar"
              />
            )}
          </>
        )}
      </nav>

      {/* Bottom bar: Settings + collapse toggle */}
      <div className={`py-2 border-t border-border-primary flex ${collapsed ? "flex-col items-center gap-1 px-2" : "items-center gap-1 px-3"}`}>
        <button
          onClick={() => handleNavigate("settings")}
          className={`flex items-center text-sm rounded-md transition-colors ${
            collapsed ? "p-2 justify-center" : "gap-3 flex-1 px-3 py-2 text-left"
          } ${
            activeLabel === "settings"
              ? "bg-accent/10 text-accent font-medium"
              : "text-sidebar-text hover:bg-sidebar-hover"
          }`}
          title="Settings"
        >
          <Settings size={18} className="shrink-0" />
          {!collapsed && <span>Settings</span>}
        </button>
        <button
          onClick={() => handleNavigate("help")}
          className={`flex items-center text-sm rounded-md transition-colors ${
            collapsed ? "p-2 justify-center" : "p-2"
          } ${
            activeLabel === "help"
              ? "bg-accent/10 text-accent font-medium"
              : "text-sidebar-text hover:bg-sidebar-hover"
          }`}
          title="Help"
        >
          <HelpCircle size={18} className="shrink-0" />
        </button>
        <button
          onClick={toggleSidebar}
          className="hidden md:flex p-2 text-sidebar-text/60 hover:text-sidebar-text hover:bg-sidebar-hover rounded-md transition-colors"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <InputDialog
        isOpen={showSmartFolderModal}
        onClose={() => setShowSmartFolderModal(false)}
        onSubmit={(values) => {
          createSmartFolder(
            values.name!.trim(),
            values.query!.trim(),
            activeAccountId ?? undefined,
          );
        }}
        title="New Smart Folder"
        fields={[
          { key: "name", label: "Name", placeholder: "e.g. Unread from boss" },
          { key: "query", label: "Search query", placeholder: "e.g. is:unread from:boss" },
        ]}
      />

      {/* Pending operations indicator */}
      <PendingOpsIndicator collapsed={collapsed} />
    </aside>
    </>
  );
}

function PendingOpsIndicator({ collapsed }: { collapsed: boolean }) {
  const pendingOpsCount = useUIStore((s) => s.pendingOpsCount);
  if (pendingOpsCount <= 0) return null;

  return (
    <div className="px-3 py-2 border-t border-border-primary">
      {collapsed ? (
        <div className="flex justify-center">
          <span className="bg-accent/20 text-accent text-xs font-medium px-1.5 py-0.5 rounded-full">{pendingOpsCount}</span>
        </div>
      ) : (
        <div className="text-xs text-text-secondary">
          {pendingOpsCount} pending {pendingOpsCount === 1 ? "change" : "changes"}
        </div>
      )}
    </div>
  );
}
