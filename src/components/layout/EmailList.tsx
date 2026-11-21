import { useEffect, useCallback, useMemo, useRef, useState } from "react";
import { CSSTransition } from "react-transition-group";
import { ThreadCard } from "../email/ThreadCard";
import { CategoryTabs } from "../email/CategoryTabs";
import { SearchBar } from "../search/SearchBar";
import { EmailListSkeleton } from "../ui/Skeleton";
import { useThreadStore, type Thread } from "@/stores/threadStore";
import { useAccountStore } from "@/stores/accountStore";
import { useUIStore } from "@/stores/uiStore";
import { useActiveLabel, useSelectedThreadId, useActiveCategory } from "@/hooks/useRouteNavigation";
import { navigateToThread, navigateToLabel } from "@/router/navigate";
import { getThreadsForAccount, getThreadsForCategory, getThreadsForLabels, getThreadsForOtherInbox, getThreadLabelIds } from "@/services/db/threads";
import { gmailNavSpec, gmailViewLabelIds } from "@/constants/gmailSidebar";
import { getCategoriesForThreads, getCategoryUnreadCounts } from "@/services/db/threadCategories";
import { getActiveFollowUpThreadIds } from "@/services/db/followUpReminders";
import { getBundleRules, getHeldThreadIds, getBundleSummaries, type DbBundleRule } from "@/services/db/bundleRules";
import { getGmailClient } from "@/services/gmail/tokenManager";
import { useLabelStore } from "@/stores/labelStore";
import { useSmartFolderStore } from "@/stores/smartFolderStore";
import { useContextMenuStore } from "@/stores/contextMenuStore";
import { useComposerStore } from "@/stores/composerStore";
import { getMessagesForThread } from "@/services/db/messages";
import { peelDraftContract } from "@/services/contracts/contractMessage";
import { getSmartFolderSearchQuery, mapSmartFolderRows, type SmartFolderRow } from "@/services/search/smartFolderQuery";
import { getDb } from "@/services/db/connection";
import { archiveThread, trashThread, permanentDeleteThread, spamThread, markThreadRead, starThread } from "@/services/emailActions";
import { BatchActionBar } from "../email/BatchActionBar";
import { MoveToFolderDialog } from "../email/MoveToFolderDialog";
import { Trash2, X, Filter, ChevronRight, Package, FolderSearch, Pin, PenSquare, Menu, RotateCcw, Search, RefreshCw } from "lucide-react";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { EmptyState } from "../ui/EmptyState";
import {
  InboxClearIllustration,
  NoSearchResultsIllustration,
  NoAccountIllustration,
  GenericEmptyIllustration,
  StarredEmptyIllustration,
  DraftsEmptyIllustration,
  SnoozedEmptyIllustration,
  TrashEmptyIllustration,
} from "../ui/illustrations";

const PAGE_SIZE = 50;

// Map sidebar labels to Gmail label IDs
const LABEL_MAP: Record<string, string> = {
  inbox: "INBOX",
  starred: "STARRED",
  sent: "SENT",
  drafts: "DRAFT",
  trash: "TRASH",
  spam: "SPAM",
  snoozed: "SNOOZED",
  focused: "FOCUSED",
  other: "OTHER",
  all: "", // no filter
};

export function EmailList({ width, listRef }: { width?: number; listRef?: React.Ref<HTMLDivElement> }) {
  const threads = useThreadStore((s) => s.threads);
  const selectedThreadId = useSelectedThreadId();
  const selectedThreadIds = useThreadStore((s) => s.selectedThreadIds);
  const isLoading = useThreadStore((s) => s.isLoading);
  const setThreads = useThreadStore((s) => s.setThreads);
  const setLoading = useThreadStore((s) => s.setLoading);
  const updateThread = useThreadStore((s) => s.updateThread);
  const clearMultiSelect = useThreadStore((s) => s.clearMultiSelect);
  const selectAll = useThreadStore((s) => s.selectAll);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const activeLabel = useActiveLabel();
  const readFilter = useUIStore((s) => s.readFilter);
  const setReadFilter = useUIStore((s) => s.setReadFilter);
  const readingPanePosition = useUIStore((s) => s.readingPanePosition);
  const userLabels = useLabelStore((s) => s.labels);
  const smartFolders = useSmartFolderStore((s) => s.folders);
  const [isMoveFolderOpen, setIsMoveFolderOpen] = useState(false);

  // Detect smart folder mode
  const isSmartFolder = activeLabel.startsWith("smart-folder:");
  const smartFolderId = isSmartFolder ? activeLabel.replace("smart-folder:", "") : null;
  const activeSmartFolder = smartFolderId ? smartFolders.find((f) => f.id === smartFolderId) ?? null : null;

  const inboxViewMode = useUIStore((s) => s.inboxViewMode);
  const routerCategory = useActiveCategory();

  // In split mode, use the router's category; in unified mode, always use "All"
  const activeCategory = inboxViewMode === "split" ? routerCategory : "All";
  const setActiveCategory = inboxViewMode === "split"
    ? (cat: string) => navigateToLabel("inbox", { category: cat })
    : () => {};

  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [categoryMap, setCategoryMap] = useState<Map<string, string>>(() => new Map());
  const [categoryUnreadCounts, setCategoryUnreadCounts] = useState<Map<string, number>>(() => new Map());
  const [followUpThreadIds, setFollowUpThreadIds] = useState<Set<string>>(() => new Set());
  const [bundleRules, setBundleRules] = useState<DbBundleRule[]>([]);
  const [heldThreadIds, setHeldThreadIds] = useState<Set<string>>(() => new Set());
  const [expandedBundles, setExpandedBundles] = useState<Set<string>>(() => new Set());
  const [bundleSummaries, setBundleSummaries] = useState<Map<string, { count: number; latestSubject: string | null; latestSender: string | null }>>(() => new Map());

  const openMenu = useContextMenuStore((s) => s.openMenu);
  const multiSelectCount = selectedThreadIds.size;

  const openComposer = useComposerStore((s) => s.openComposer);
  const multiSelectBarRef = useRef<HTMLDivElement>(null);

  const handleThreadContextMenu = useCallback((e: React.MouseEvent, threadId: string) => {
    e.preventDefault();
    openMenu("thread", { x: e.clientX, y: e.clientY }, { threadId });
  }, [openMenu]);

  const handleDraftClick = useCallback(async (thread: Thread) => {
    if (!activeAccountId) return;
    try {
      const messages = await getMessagesForThread(activeAccountId, thread.id);
      // Get the last message (the draft)
      const draftMsg = messages[messages.length - 1];
      if (!draftMsg) return;

      // Look up the Gmail draft ID so auto-save can update the existing draft
      let draftId: string | null = null;
      try {
        const client = await getGmailClient(activeAccountId);
        const drafts = await client.listDrafts();
        const match = drafts.find((d) => d.message.id === draftMsg.id);
        if (match) draftId = match.id;
      } catch {
        // If we can't get draft ID, composer will create a new draft on save
      }

      const to = draftMsg.to_addresses
        ? draftMsg.to_addresses.split(",").map((a) => a.trim()).filter(Boolean)
        : [];
      const cc = draftMsg.cc_addresses
        ? draftMsg.cc_addresses.split(",").map((a) => a.trim()).filter(Boolean)
        : [];
      const bcc = draftMsg.bcc_addresses
        ? draftMsg.bcc_addresses.split(",").map((a) => a.trim()).filter(Boolean)
        : [];

      const peeled = peelDraftContract(draftMsg.body_html ?? draftMsg.body_text ?? "");
      openComposer({
        mode: "new",
        to,
        cc,
        bcc,
        subject: draftMsg.subject ?? "",
        bodyHtml: peeled.html,
        threadId: thread.id,
        draftId,
        contractActive: peeled.contractText != null,
        contractText: peeled.contractText ?? "",
      });
      // Set initial saved timestamp so resumed draft immediately shows "Saved" status
      useComposerStore.getState().setLastSavedAt(draftMsg.date ? draftMsg.date * 1000 : Date.now());
    } catch (err) {
      console.error("Failed to open draft:", err);
    }
  }, [activeAccountId, openComposer]);

  const handleThreadClick = useCallback((thread: Thread) => {
    if (activeLabel === "drafts" || thread.labelIds.includes("DRAFT")) {
      handleDraftClick(thread);
    } else {
      navigateToThread(thread.id);
    }
  }, [activeLabel, handleDraftClick]);

  const [showEmptyTrashConfirm, setShowEmptyTrashConfirm] = useState(false);
  const [isEmptyingTrash, setIsEmptyingTrash] = useState(false);

  const handleEmptyTrash = async () => {
    if (!activeAccountId || threads.length === 0) return;
    setIsEmptyingTrash(true);
    const ids = threads.map((t) => t.id);
    try {
      await Promise.all(ids.map((id) => permanentDeleteThread(activeAccountId, id, [])));
    } catch (err) {
      console.error("Empty trash failed:", err);
    } finally {
      setIsEmptyingTrash(false);
      setShowEmptyTrashConfirm(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!activeAccountId || multiSelectCount === 0) return;
    const isTrashView = activeLabel === "trash";
    const ids = [...selectedThreadIds];
    try {
      await Promise.all(ids.map((id) => isTrashView
        ? permanentDeleteThread(activeAccountId, id, [])
        : trashThread(activeAccountId, id, [])));
    } catch (err) {
      console.error("Bulk delete failed:", err);
    }
  };

  const handleBulkArchive = async () => {
    if (!activeAccountId || multiSelectCount === 0) return;
    const ids = [...selectedThreadIds];
    try {
      await Promise.all(ids.map((id) => archiveThread(activeAccountId, id, [])));
    } catch (err) {
      console.error("Bulk archive failed:", err);
    }
  };

  const handleBulkSpam = async () => {
    if (!activeAccountId || multiSelectCount === 0) return;
    const ids = [...selectedThreadIds];
    const isSpamView = activeLabel === "spam";
    try {
      await Promise.all(ids.map((id) => spamThread(activeAccountId, id, [], !isSpamView)));
    } catch (err) {
      console.error("Bulk spam failed:", err);
    }
  };

  const selectedThreads = useMemo(() => {
    return threads.filter((t) => selectedThreadIds.has(t.id));
  }, [threads, selectedThreadIds]);

  const allRead = selectedThreads.length > 0 && selectedThreads.every((t) => t.isRead);
  const allStarred = selectedThreads.length > 0 && selectedThreads.every((t) => t.isStarred);

  const handleBulkMarkRead = useCallback(async (targetRead: boolean) => {
    if (!activeAccountId || multiSelectCount === 0) return;
    const ids = [...selectedThreadIds];
    ids.forEach((id) => updateThread(id, { isRead: targetRead }));
    try {
      await Promise.all(ids.map((id) => markThreadRead(activeAccountId, id, [], targetRead)));
    } catch (err) {
      console.error("Bulk mark read failed:", err);
    }
  }, [activeAccountId, multiSelectCount, selectedThreadIds, updateThread]);

  const handleBulkStar = useCallback(async (targetStar: boolean) => {
    if (!activeAccountId || multiSelectCount === 0) return;
    const ids = [...selectedThreadIds];
    ids.forEach((id) => updateThread(id, { isStarred: targetStar }));
    try {
      await Promise.all(ids.map((id) => starThread(activeAccountId, id, [], targetStar)));
    } catch (err) {
      console.error("Bulk star failed:", err);
    }
  }, [activeAccountId, multiSelectCount, selectedThreadIds, updateThread]);

  const searchThreadIds = useThreadStore((s) => s.searchThreadIds);
  const searchQuery = useThreadStore((s) => s.searchQuery);

  const filteredThreads = useMemo(() => {
    let filtered = threads.filter((t) => t.isFiltered !== false);
    // Apply search filter
    if (searchThreadIds !== null) {
      filtered = filtered.filter((t) => searchThreadIds.has(t.id));
    }
    // Apply read filter
    if (readFilter === "unread") filtered = filtered.filter((t) => !t.isRead);
    else if (readFilter === "read") filtered = filtered.filter((t) => t.isRead);
    // Dock pinned threads cleanly at the top of the list, preserving recency within pinned and unpinned groups
    return [...filtered].sort((a, b) => {
      const aPinned = a.isPinned ? 1 : 0;
      const bPinned = b.isPinned ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      return b.lastMessageAt - a.lastMessageAt;
    });
  }, [threads, readFilter, searchThreadIds]);

  // Pre-compute bundled category Set for O(1) lookups in filter
  const bundledCategorySet = useMemo(
    () => new Set(bundleRules.map((r) => r.category)),
    [bundleRules],
  );

  // Memoize visible threads (excludes bundled/held threads in "All" inbox view)
  const visibleThreads = useMemo(() => {
    if (activeLabel !== "inbox" || activeCategory !== "All") return filteredThreads;
    return filteredThreads.filter((t) => {
      const cat = categoryMap.get(t.id);
      if (cat && bundledCategorySet.has(cat)) return false;
      if (heldThreadIds.has(t.id)) return false;
      return true;
    });
  }, [filteredThreads, activeLabel, activeCategory, categoryMap, bundledCategorySet, heldThreadIds]);

  const pinnedCount = useMemo(
    () => visibleThreads.filter((t) => t.isPinned).length,
    [visibleThreads],
  );
  const unpinnedCount = useMemo(
    () => visibleThreads.length - pinnedCount,
    [visibleThreads, pinnedCount],
  );

  const mapDbThreads = useCallback(async (dbThreads: Awaited<ReturnType<typeof getThreadsForAccount>>): Promise<Thread[]> => {
    const filteredDbThreads = dbThreads.filter((t) => t.is_filtered === undefined || t.is_filtered === null || t.is_filtered === 1);
    return Promise.all(
      filteredDbThreads.map(async (t) => {
        const labelIds = await getThreadLabelIds(t.account_id, t.id);
        return {
          id: t.id,
          accountId: t.account_id,
          subject: t.subject,
          snippet: t.snippet,
          lastMessageAt: t.last_message_at ?? 0,
          messageCount: t.message_count,
          isRead: t.is_read === 1,
          isStarred: t.is_starred === 1,
          isPinned: t.is_pinned === 1,
          isMuted: t.is_muted === 1,
          hasAttachments: t.has_attachments === 1,
          labelIds,
          fromName: t.from_name,
          fromAddress: t.from_address,
          toAddresses: t.to_addresses ?? null,
          isFiltered: t.is_filtered !== undefined && t.is_filtered !== null ? t.is_filtered === 1 : true,
        };
      }),
    );
  }, []);

  const clearSearch = useThreadStore((s) => s.clearSearch);

  useEffect(() => {
    clearSearch();
  }, [activeAccountId, activeLabel, activeCategory, clearSearch]);

  // Keep the inbox route compatible with the selected account's provider.
  useEffect(() => {
    const account = useAccountStore.getState().accounts.find((a) => a.id === activeAccountId);
    if (account?.provider === "ews" && activeLabel === "inbox") {
      navigateToLabel("focused");
    } else if (account && account.provider !== "ews" && (activeLabel === "focused" || activeLabel === "other")) {
      navigateToLabel("inbox");
    }
  }, [activeAccountId, activeLabel]);

  const loadThreads = useCallback(async () => {
    if (!activeAccountId) {
      setThreads([]);
      return;
    }

    setLoading(true);
    setHasMore(true);
    try {
      // Smart folder query path
      if (isSmartFolder && activeSmartFolder) {
        const { sql, params } = getSmartFolderSearchQuery(
          activeSmartFolder.query,
          activeAccountId,
          PAGE_SIZE,
        );
        const db = await getDb();
        const rows = await db.select<SmartFolderRow[]>(sql, params);
        const mapped = await mapSmartFolderRows(rows);
        setThreads(mapped);
        setHasMore(false); // Smart folders load all at once
      } else {
        let dbThreads;
        const gmailLabels = gmailViewLabelIds(activeLabel);
        // Server-side category filtering for inbox
        if (gmailLabels) {
          dbThreads = await getThreadsForLabels(activeAccountId, gmailLabels, PAGE_SIZE, 0);
        } else if (activeLabel === "inbox" && activeCategory !== "All") {
          dbThreads = await getThreadsForCategory(activeAccountId, activeCategory, PAGE_SIZE, 0);
        } else if (activeLabel === "focused") {
          dbThreads = await getThreadsForLabels(activeAccountId, ["INBOX", "FOCUSED"], PAGE_SIZE, 0);
        } else if (activeLabel === "other") {
          dbThreads = await getThreadsForOtherInbox(activeAccountId, PAGE_SIZE, 0);
        } else {
          const gmailLabelId = LABEL_MAP[activeLabel] ?? activeLabel;
          dbThreads = await getThreadsForAccount(
            activeAccountId,
            gmailLabelId || undefined,
            PAGE_SIZE,
            0,
          );
        }

        const mapped = await mapDbThreads(dbThreads);
        setThreads(mapped);
        setHasMore(dbThreads.length === PAGE_SIZE);
      }
    } catch (err) {
      console.error("Failed to load threads:", err);
    } finally {
      setLoading(false);
    }
  }, [activeAccountId, activeLabel, activeCategory, isSmartFolder, activeSmartFolder, setThreads, setLoading, mapDbThreads]);

  const loadMore = useCallback(async () => {
    if (!activeAccountId || loadingMore || !hasMore) return;

    setLoadingMore(true);
    try {
      const offset = threads.length;
      let dbThreads;
      const gmailLabels = gmailViewLabelIds(activeLabel);
      if (gmailLabels) {
        dbThreads = await getThreadsForLabels(activeAccountId, gmailLabels, PAGE_SIZE, offset);
      } else if (activeLabel === "inbox" && activeCategory !== "All") {
        dbThreads = await getThreadsForCategory(activeAccountId, activeCategory, PAGE_SIZE, offset);
      } else if (activeLabel === "focused") {
        dbThreads = await getThreadsForLabels(activeAccountId, ["INBOX", "FOCUSED"], PAGE_SIZE, offset);
      } else if (activeLabel === "other") {
        dbThreads = await getThreadsForOtherInbox(activeAccountId, PAGE_SIZE, offset);
      } else {
        const gmailLabelId = LABEL_MAP[activeLabel] ?? activeLabel;
        dbThreads = await getThreadsForAccount(
          activeAccountId,
          gmailLabelId || undefined,
          PAGE_SIZE,
          offset,
        );
      }

      const mapped = await mapDbThreads(dbThreads);
      if (mapped.length > 0) {
        setThreads([...threads, ...mapped]);
      }
      setHasMore(dbThreads.length === PAGE_SIZE);
    } catch (err) {
      console.error("Failed to load more threads:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [activeAccountId, activeLabel, activeCategory, threads, loadingMore, hasMore, setThreads, mapDbThreads]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  // Stable thread ID key — only changes when the actual set of thread IDs changes, not on every array reference
  const threadIdKey = useMemo(() => threads.map((t) => t.id).join(","), [threads]);

  // Load all thread metadata (categories, unread counts, follow-ups, bundles) in one coordinated effect
  useEffect(() => {
    let cancelled = false;

    if (!activeAccountId) {
      setCategoryMap(new Map());
      setCategoryUnreadCounts(new Map());
      setFollowUpThreadIds(new Set());
      setBundleRules([]);
      setHeldThreadIds(new Set());
      setBundleSummaries(new Map());
      return;
    }

    const threadIds = threadIdKey ? threadIdKey.split(",") : [];
    const isInbox = activeLabel === "inbox";
    const isAllCategory = activeCategory === "All";

    const loadMetadata = async () => {
      try {
        // Build all promises based on current view
        const promises: Promise<void>[] = [];

        // Categories (only for inbox "All" tab with threads)
        if (isInbox && isAllCategory && threadIds.length > 0) {
          promises.push(
            getCategoriesForThreads(activeAccountId, threadIds).then((result) => {
              if (!cancelled) setCategoryMap(result);
            }),
          );
        } else {
          setCategoryMap(new Map());
        }

        // Unread counts (only for inbox)
        if (isInbox) {
          promises.push(
            getCategoryUnreadCounts(activeAccountId).then((result) => {
              if (!cancelled) setCategoryUnreadCounts(result);
            }),
          );
        } else {
          setCategoryUnreadCounts(new Map());
        }

        // Follow-up indicators
        if (threadIds.length > 0) {
          promises.push(
            getActiveFollowUpThreadIds(activeAccountId, threadIds).then((result) => {
              if (!cancelled) setFollowUpThreadIds(result);
            }).catch(() => {
              if (!cancelled) setFollowUpThreadIds(new Set());
            }),
          );
        } else {
          setFollowUpThreadIds(new Set());
        }

        // Bundle rules + held threads (only for inbox)
        if (isInbox) {
          promises.push(
            getBundleRules(activeAccountId).then(async (rules) => {
              if (cancelled) return;
              const bundled = rules.filter((r) => r.is_bundled);
              setBundleRules(bundled);
              // Batch-fetch all summaries in 2 queries instead of 2N
              if (bundled.length > 0) {
                const summaries = await getBundleSummaries(activeAccountId, bundled.map((r) => r.category)).catch(() => new Map());
                if (!cancelled) setBundleSummaries(summaries);
              } else {
                if (!cancelled) setBundleSummaries(new Map());
              }
            }).catch(() => {
              if (!cancelled) setBundleRules([]);
            }),
          );
          promises.push(
            getHeldThreadIds(activeAccountId).then((result) => {
              if (!cancelled) setHeldThreadIds(result);
            }).catch(() => {
              if (!cancelled) setHeldThreadIds(new Set());
            }),
          );
        } else {
          setBundleRules([]);
          setHeldThreadIds(new Set());
          setBundleSummaries(new Map());
        }

        await Promise.all(promises);
      } catch (err) {
        console.error("Failed to load thread metadata:", err);
      }
    };

    loadMetadata();
    return () => { cancelled = true; };
  }, [threadIdKey, activeLabel, activeCategory, activeAccountId]);

  // Auto-scroll selected thread into view (triggered by keyboard navigation)
  useEffect(() => {
    if (!selectedThreadId || !scrollContainerRef.current) return;
    const el = scrollContainerRef.current.querySelector(`[data-thread-id="${CSS.escape(selectedThreadId)}"]`);
    if (el) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedThreadId]);

  // Listen for sync completion to reload (debounced to avoid waterfall from multiple emitters)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handler = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => loadThreads(), 500);
    };
    window.addEventListener("suitemail-sync-done", handler);
    return () => {
      window.removeEventListener("suitemail-sync-done", handler);
      if (timer) clearTimeout(timer);
    };
  }, [loadThreads, activeAccountId, activeLabel]);

  // Infinite scroll: load more when near bottom
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollHeight - scrollTop - clientHeight < 200) {
        loadMore();
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [loadMore]);

  return (
    <div
      ref={listRef}
      className={`relative flex flex-col bg-bg-secondary/50 glass-panel overflow-hidden flex-1 ${
        readingPanePosition === "right"
          ? "w-full md:w-[var(--email-list-width,320px)] min-w-0 md:min-w-[240px] shrink-0"
          : readingPanePosition === "bottom"
            ? "w-full border-b border-border-primary h-[40%] min-h-[200px]"
            : "w-full flex-1"
      }`}
      style={
        readingPanePosition === "right" && width
          ? ({ "--email-list-width": `${width}px` } as React.CSSProperties)
          : undefined
      }
    >
      {/* Search + Mobile Menu Trigger */}
      <div className="px-3 py-2 border-b border-border-secondary flex items-center gap-2 bg-bg-secondary/30">
        <button
          onClick={() => useUIStore.getState().toggleMobileSidebar()}
          data-testid="mobile-menu-button"
          aria-label="Open menu"
          title="Open menu"
          className="md:hidden min-w-[44px] min-h-[44px] p-2.5 rounded-xl text-text-secondary hover:text-text-primary hover:bg-bg-hover active:scale-95 active:bg-bg-hover/80 transition-all shrink-0 flex items-center justify-center touch-manipulation cursor-pointer"
        >
          <Menu size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <SearchBar />
        </div>
      </div>

      {/* Header */}
      <div className="px-4 py-2.5 border-b border-border-primary/80 bg-bg-secondary/40 backdrop-blur-xs flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-text-primary capitalize flex items-center gap-1.5">
            {isSmartFolder && <FolderSearch size={14} className="text-accent shrink-0" />}
            {isSmartFolder
              ? activeSmartFolder?.name ?? "Smart Folder"
              : gmailNavSpec(activeLabel)?.label
                ?? (activeLabel === "inbox" && inboxViewMode === "split" && activeCategory !== "All"
                  ? `Inbox — ${activeCategory}`
                  : activeLabel === "focused"
                    ? "Focused"
                    : activeLabel === "other"
                      ? "Other"
                      : LABEL_MAP[activeLabel] !== undefined
                        ? activeLabel
                        : userLabels.find((l) => l.id === activeLabel)?.name ?? activeLabel)}
          </h2>
          <span className="text-xs text-text-tertiary flex items-center gap-1.5 mt-0.5">
            {searchQuery.trim().length > 0 ? (
              <>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                <span className="font-medium text-text-secondary">
                  {filteredThreads.length} {filteredThreads.length === 1 ? "matching conversation" : "matching conversations"}
                </span>
              </>
            ) : (
              `${filteredThreads.length} conversation${filteredThreads.length !== 1 ? "s" : ""}`
            )}
          </span>
        </div>
        <select
          value={readFilter}
          onChange={(e) => setReadFilter(e.target.value as "all" | "read" | "unread")}
          className="text-xs bg-bg-primary text-text-secondary px-2.5 py-1 rounded-md border border-border-primary/80 shadow-2xs hover:border-accent/40 focus:ring-1 focus:ring-accent/50 outline-none transition-all cursor-pointer"
        >
          <option value="all">All</option>
          <option value="unread">Unread</option>
          <option value="read">Read</option>
        </select>
      </div>

      {/* Category tabs (inbox + split mode only) */}
      {activeLabel === "inbox" && inboxViewMode === "split" && (
        <CategoryTabs
          activeCategory={activeCategory}
          onCategoryChange={setActiveCategory}
          unreadCounts={Object.fromEntries(categoryUnreadCounts)}
        />
      )}

      {/* Trash policy banner and empty action */}
      {activeLabel === "trash" && (
        <div className="px-3.5 sm:px-4 py-2 sm:py-2.5 bg-red-500/5 dark:bg-red-500/10 border-b border-red-500/20 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 text-xs animate-in fade-in duration-200">
          <div className="flex items-center gap-2.5 min-w-0 text-text-secondary">
            <span className="p-1 rounded-md bg-red-500/10 text-red-600 dark:text-red-400 shrink-0">
              <Trash2 size={15} />
            </span>
            <span className="leading-snug">
              Messages in Trash for more than 30 days are automatically deleted.
            </span>
          </div>
          {filteredThreads.length > 0 && (
            <button
              onClick={() => setShowEmptyTrashConfirm(true)}
              className="self-start sm:self-auto shrink-0 font-semibold text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 px-3 py-1.5 sm:py-1 rounded-full sm:rounded border border-red-500/25 sm:border-transparent hover:bg-red-500/10 active:bg-red-500/20 active:scale-95 transition-all text-xs touch-manipulation min-h-[38px] sm:min-h-0 flex items-center justify-center cursor-pointer"
            >
              Empty Trash now
            </button>
          )}
        </div>
      )}

      {/* Search query chip / filter summary bar */}
      {searchQuery.trim().length > 0 && (
        <div className="px-3.5 py-2 sm:py-1.5 bg-accent/[0.08] dark:bg-accent/[0.12] border-b border-accent/20 flex items-center justify-between gap-2 text-xs animate-in fade-in duration-150">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-text-tertiary shrink-0 text-xs font-medium hidden sm:inline">Search:</span>
            <span className="inline-flex items-center gap-1 font-semibold text-accent bg-accent/15 px-2.5 py-1 sm:py-0.5 rounded-full truncate max-w-[160px] sm:max-w-[200px] text-xs shadow-2xs">
              &ldquo;{searchQuery.trim()}&rdquo;
            </span>
            <span
              data-testid="search-results-badge"
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-bg-secondary text-text-secondary border border-border-secondary/80 shrink-0 shadow-2xs"
            >
              {filteredThreads.length} {filteredThreads.length === 1 ? "result" : "results"}
            </span>
          </div>
          <button
            type="button"
            onClick={clearSearch}
            className="min-h-[36px] sm:min-h-0 px-2.5 py-1 sm:py-0.5 flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-text-primary active:scale-95 rounded-lg hover:bg-bg-hover active:bg-bg-hover/80 transition-all shrink-0 touch-manipulation border border-border-secondary/40 sm:border-transparent cursor-pointer"
            title="Clear search"
            aria-label="Clear search"
          >
            <X size={14} className="sm:w-3 sm:h-3" />
            <span>Clear</span>
          </button>
        </div>
      )}

      {/* Thread list */}
      <div
        ref={scrollContainerRef}
        className={`flex-1 overflow-y-auto ${multiSelectCount > 0 ? "pb-20" : ""}`}
      >
        {isLoading && threads.length === 0 ? (
          <EmailListSkeleton />
        ) : filteredThreads.length === 0 && bundleRules.length === 0 ? (
          <EmptyStateForContext
            searchQuery={searchQuery}
            activeAccountId={activeAccountId}
            activeLabel={activeLabel}
            readFilter={readFilter}
            activeCategory={activeCategory}
            onClearSearch={clearSearch}
            onRefresh={loadThreads}
            isRefreshing={isLoading}
          />
        ) : (
          <>
            {/* Bundle rows for "All" inbox view */}
            {activeLabel === "inbox" && activeCategory === "All" && bundleRules.map((rule) => {
              const summary = bundleSummaries.get(rule.category);
              if (!summary || summary.count === 0) return null;
              const isExpanded = expandedBundles.has(rule.category);
              const bundledThreads = isExpanded
                ? filteredThreads.filter((t) => categoryMap.get(t.id) === rule.category)
                : [];
              return (
                <div key={`bundle-${rule.category}`}>
                  <button
                    onClick={() => {
                      setExpandedBundles((prev) => {
                        const next = new Set(prev);
                        if (next.has(rule.category)) next.delete(rule.category);
                        else next.add(rule.category);
                        return next;
                      });
                    }}
                    className="w-full text-left px-4 py-3 border-b border-border-secondary hover:bg-bg-hover transition-colors flex items-center gap-3"
                  >
                    <div className="w-9 h-9 rounded-full bg-accent/15 flex items-center justify-center shrink-0">
                      <Package size={16} className="text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-text-primary">
                          {rule.category}
                        </span>
                        <span className="text-xs bg-accent/15 text-accent px-1.5 rounded-full">
                          {summary.count}
                        </span>
                      </div>
                      <span className="text-xs text-text-tertiary truncate block mt-0.5">
                        {summary.latestSender && `${summary.latestSender}: `}{summary.latestSubject ?? ""}
                      </span>
                    </div>
                    <ChevronRight
                      size={14}
                      className={`text-text-tertiary transition-transform shrink-0 ${isExpanded ? "rotate-90" : ""}`}
                    />
                  </button>
                  {isExpanded && bundledThreads.map((thread) => (
                    <div key={thread.id} className="pl-4">
                      <ThreadCard
                        thread={thread}
                        isSelected={thread.id === selectedThreadId}
                        onClick={handleThreadClick}
                        onContextMenu={handleThreadContextMenu}
                        category={rule.category}
                        hasFollowUp={followUpThreadIds.has(thread.id)}
                      />
                    </div>
                  ))}
                </div>
              );
            })}
            {visibleThreads.map((thread, idx) => {
              const prevThread = idx > 0 ? visibleThreads[idx - 1] : undefined;
              const isFirstPinned = idx === 0 && thread.isPinned;
              const showDivider = prevThread?.isPinned && !thread.isPinned;
              return (
                <div
                  key={thread.id}
                  data-thread-id={thread.id}
                  className={`transition-all duration-200 ease-out ${thread.isPinned ? "bg-accent/[0.02]" : ""} ${idx < 15 ? "stagger-in" : ""}`}
                  style={idx < 15 ? { animationDelay: `${idx * 30}ms` } : undefined}
                >
                  {isFirstPinned && (
                    <div className="sticky top-0 z-10 flex items-center justify-between px-3.5 sm:px-4 py-2 text-[11px] font-bold text-accent uppercase tracking-wider bg-accent/10 dark:bg-accent/15 backdrop-blur-md border-b border-accent/20 select-none shadow-2xs">
                      <div className="flex items-center gap-1.5">
                        <div className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
                          <Pin size={11} className="fill-current -rotate-45 text-accent pin-animate" />
                        </div>
                        <span>Pinned</span>
                      </div>
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-accent/20 dark:bg-accent/30 text-accent border border-accent/25 shadow-2xs">
                        {pinnedCount}
                      </span>
                    </div>
                  )}
                  {showDivider && (
                    <div className="sticky top-0 z-10 flex items-center justify-between px-3.5 sm:px-4 py-2 text-[11px] font-bold text-text-tertiary uppercase tracking-wider bg-bg-secondary/95 dark:bg-bg-secondary/90 backdrop-blur-md border-y border-border-secondary/80 select-none shadow-2xs">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-text-tertiary/60" />
                        <span>Other emails</span>
                      </div>
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-bg-primary text-text-tertiary border border-border-secondary/60 shadow-2xs">
                        {unpinnedCount}
                      </span>
                    </div>
                  )}
                  <ThreadCard
                    thread={thread}
                    isSelected={thread.id === selectedThreadId}
                    onClick={handleThreadClick}
                    onContextMenu={handleThreadContextMenu}
                    category={categoryMap.get(thread.id)}
                    showCategoryBadge={activeLabel === "inbox" && activeCategory === "All"}
                    hasFollowUp={followUpThreadIds.has(thread.id)}
                  />
                </div>
              );
            })}
            {loadingMore && (
              <div className="px-4 py-3 text-center text-xs text-text-tertiary">
                Loading more...
              </div>
            )}
            {!hasMore && threads.length > PAGE_SIZE && (
              <div className="px-4 py-3 text-center text-xs text-text-tertiary">
                All conversations loaded
              </div>
            )}
          </>
        )}
      </div>

      {/* Floating Multi-select batch action bar */}
      <CSSTransition
        nodeRef={multiSelectBarRef}
        in={multiSelectCount > 0}
        timeout={200}
        classNames="batch-bar"
        unmountOnExit
      >
        <div
          ref={multiSelectBarRef}
          className="absolute bottom-[calc(max(5.25rem,4.25rem+env(safe-area-inset-bottom,0px)))] md:bottom-5 left-1/2 -translate-x-1/2 z-30 pointer-events-auto"
        >
          <BatchActionBar
            selectedCount={multiSelectCount}
            totalCount={filteredThreads.length}
            allRead={allRead}
            allStarred={allStarred}
            isSpamView={activeLabel === "spam"}
            onArchive={handleBulkArchive}
            onDelete={handleBulkDelete}
            onMarkRead={handleBulkMarkRead}
            onStar={handleBulkStar}
            onMoveToFolder={() => setIsMoveFolderOpen(true)}
            onSpam={handleBulkSpam}
            onClear={clearMultiSelect}
            onSelectAll={selectAll}
          />
        </div>
      </CSSTransition>

      {/* Move to folder modal */}
      {isMoveFolderOpen && (
        <MoveToFolderDialog
          isOpen={isMoveFolderOpen}
          threadIds={[...selectedThreadIds]}
          onClose={() => {
            setIsMoveFolderOpen(false);
            clearMultiSelect();
          }}
        />
      )}

      <ConfirmDialog
        isOpen={showEmptyTrashConfirm}
        onClose={() => setShowEmptyTrashConfirm(false)}
        onConfirm={handleEmptyTrash}
        title="Empty Trash"
        message={`Are you sure you want to permanently delete all ${threads.length} conversation${threads.length !== 1 ? "s" : ""} in Trash? This action cannot be undone.`}
        confirmLabel={isEmptyingTrash ? "Emptying..." : "Empty Trash"}
        variant="danger"
        loading={isEmptyingTrash}
      />
    </div>
  );
}

function EmptyStateForContext({
  searchQuery,
  activeAccountId,
  activeLabel,
  readFilter,
  activeCategory,
  onClearSearch,
  onRefresh,
  isRefreshing,
}: {
  searchQuery: string | null;
  activeAccountId: string | null;
  activeLabel: string;
  readFilter: string;
  activeCategory: string;
  onClearSearch?: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}) {
  if (searchQuery && searchQuery.trim().length > 0) {
    const query = searchQuery.trim();
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-tertiary px-6 py-12 text-center animate-in fade-in duration-200">
        <div className="relative mb-4">
          <NoSearchResultsIllustration size={130} className="opacity-85 drop-shadow-sm" />
          <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-accent/15 border-2 border-bg-primary flex items-center justify-center text-accent shadow-xs">
            <Search size={15} />
          </div>
        </div>
        <h3 className="text-base sm:text-lg font-semibold text-text-primary max-w-[320px] leading-snug">
          No emails matching &ldquo;{query}&rdquo;
        </h3>
        <p className="text-xs sm:text-sm mt-1.5 max-w-[280px] text-text-tertiary leading-relaxed">
          No conversations found. Check for typos or try searching with fewer keywords.
        </p>
        {onClearSearch && (
          <button
            type="button"
            onClick={onClearSearch}
            aria-label="Reset search"
            className="mt-5 min-h-[44px] px-5 py-2.5 text-xs sm:text-sm font-semibold text-white bg-accent hover:bg-accent-hover active:scale-95 rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 touch-manipulation cursor-pointer"
          >
            <RotateCcw size={15} />
            <span>Reset search</span>
          </button>
        )}
      </div>
    );
  }
  if (readFilter !== "all") {
    return <EmptyState icon={Filter} title={`No ${readFilter} emails`} subtitle="Try changing the filter" />;
  }
  if (!activeAccountId) {
    return <EmptyState illustration={NoAccountIllustration} title="No account connected" subtitle="Add a Gmail account to get started" />;
  }

  const refreshAction = onRefresh ? (
    <button
      type="button"
      onClick={onRefresh}
      disabled={isRefreshing}
      className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 text-xs sm:text-sm font-medium text-text-primary bg-bg-secondary hover:bg-bg-hover active:bg-bg-tertiary active:scale-95 border border-border-primary/80 rounded-full shadow-xs transition-all touch-manipulation group disabled:opacity-50 cursor-pointer"
    >
      <RefreshCw
        size={14}
        className={`text-accent transition-transform group-hover:rotate-180 ${isRefreshing ? "animate-spin" : ""}`}
      />
      <span>{isRefreshing ? "Checking for mail..." : "Check for new mail"}</span>
    </button>
  ) : undefined;

  switch (activeLabel) {
    case "inbox": {
      if (activeCategory !== "All") {
        const categoryMessages: Record<string, { title: string; subtitle: string }> = {
          Primary: { title: "Primary is clear", subtitle: "No important conversations — your inbox is clear" },
          Updates: { title: "No updates", subtitle: "Notifications and transactional emails appear here" },
          Promotions: { title: "No promotions", subtitle: "Marketing and promotional emails appear here" },
          Social: { title: "No social emails", subtitle: "Social network notifications appear here" },
          Newsletters: { title: "No newsletters", subtitle: "Newsletters and subscriptions appear here" },
        };
        const msg = categoryMessages[activeCategory];
        if (msg) {
          return (
            <EmptyState
              illustration={InboxClearIllustration}
              title={msg.title}
              subtitle={msg.subtitle}
              badge="Inbox Zero"
              action={refreshAction}
            />
          );
        }
      }
      return (
        <EmptyState
          illustration={InboxClearIllustration}
          title="You're all caught up"
          subtitle="No new conversations — enjoy your day!"
          badge="Inbox Zero"
          action={refreshAction}
        />
      );
    }
    case "focused":
      return (
        <EmptyState
          illustration={InboxClearIllustration}
          title="You're all caught up"
          subtitle="No focused conversations — enjoy your day!"
          badge="Inbox Zero"
          action={refreshAction}
        />
      );
    case "other":
      return (
        <EmptyState
          illustration={InboxClearIllustration}
          title="No other messages"
          subtitle="All caught up in Other"
          badge="Inbox Zero"
          action={refreshAction}
        />
      );
    case "starred":
      return (
        <EmptyState
          illustration={StarredEmptyIllustration}
          badge="Starred & Flagged"
          title="No starred conversations"
          subtitle="Star important emails from your inbox or press 's' to keep them easily accessible here."
        />
      );
    case "snoozed":
      return <EmptyState illustration={SnoozedEmptyIllustration} title="No snoozed emails" subtitle="Emails you snooze will take a break and return when you're ready" />;
    case "sent":
      return <EmptyState illustration={GenericEmptyIllustration} title="No sent messages" />;
    case "drafts":
      return (
        <EmptyState
          illustration={DraftsEmptyIllustration}
          title="No drafts"
          subtitle="Drafts you start composing are automatically saved here so you can pick them up anytime."
          action={
            <button
              onClick={() => useComposerStore.getState().openComposer({ mode: "new" })}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-accent hover:bg-accent-hover rounded-md shadow-xs transition-colors hover-lift press-scale"
            >
              <PenSquare size={13} />
              <span>New draft</span>
            </button>
          }
        />
      );
    case "trash":
      return (
        <EmptyState
          illustration={TrashEmptyIllustration}
          title="Trash is empty"
          subtitle="Items moved to Trash are automatically purged after 30 days"
        />
      );
    case "spam":
      return <EmptyState illustration={GenericEmptyIllustration} title="No spam" subtitle="Looking good!" />;
    case "all":
      return <EmptyState illustration={GenericEmptyIllustration} title="No emails yet" />;
    case "important":
      return <EmptyState illustration={GenericEmptyIllustration} title="No important mail" subtitle="Gmail marks priority conversations as important" />;
    case "purchases":
      return <EmptyState illustration={GenericEmptyIllustration} title="No purchases" subtitle="Order confirmations and delivery updates appear here" />;
    case "social":
      return <EmptyState illustration={GenericEmptyIllustration} title="No social mail" subtitle="Social network notifications appear here" />;
    case "updates":
      return <EmptyState illustration={GenericEmptyIllustration} title="No updates" subtitle="Receipts, bills, and notifications appear here" />;
    case "forums":
      return <EmptyState illustration={GenericEmptyIllustration} title="No forum mail" subtitle="Mailing lists and discussion groups appear here" />;
    case "promotions":
      return <EmptyState illustration={GenericEmptyIllustration} title="No promotions" subtitle="Deals and marketing emails appear here" />;
    default:
      if (activeLabel.startsWith("smart-folder:")) {
        return <EmptyState icon={FolderSearch} title="No matching emails" subtitle="Try adjusting the smart folder query" />;
      }
      return <EmptyState illustration={GenericEmptyIllustration} title="Nothing here" subtitle="No conversations with this label" />;
  }
}
