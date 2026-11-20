import { memo, useMemo, useState, useRef } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { Thread } from "@/stores/threadStore";
import { useThreadStore } from "@/stores/threadStore";
import { useUIStore } from "@/stores/uiStore";
import { useActiveLabel } from "@/hooks/useRouteNavigation";
import { formatRelativeDate } from "@/utils/date";
import { Paperclip, Star, Check, Pin, BellRing, VolumeX, Archive, Trash2, FileEdit, Clock } from "lucide-react";
import type { DragData } from "@/components/dnd/DndProvider";

const CATEGORY_COLORS: Record<string, string> = {
  Updates: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  Promotions: "bg-green-500/15 text-green-600 dark:text-green-400",
  Social: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  Newsletters: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
};

interface ThreadCardProps {
  thread: Thread;
  isSelected: boolean;
  onClick: (thread: Thread) => void;
  onContextMenu?: (e: React.MouseEvent, threadId: string) => void;
  category?: string;
  showCategoryBadge?: boolean;
  hasFollowUp?: boolean;
}

function highlightMatch(text: string | null | undefined, query?: string | null) {
  if (!text) return text ?? "";
  if (!query || typeof query !== "string") return text;
  const trimmed = query.trim();
  if (trimmed.length < 2) return text;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  if (parts.length <= 1) return text;
  return parts.map((part, i) =>
    part.toLowerCase() === trimmed.toLowerCase() ? (
      <mark
        key={i}
        className="bg-accent/20 text-accent font-semibold px-0.5 rounded-xs dark:bg-accent/30 dark:text-accent-hover"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

export const ThreadCard = memo(function ThreadCard({ thread, isSelected, onClick, onContextMenu, category, showCategoryBadge, hasFollowUp }: ThreadCardProps) {
  const isMultiSelected = useThreadStore((s) => s.selectedThreadIds.has(thread.id));
  const hasMultiSelect = useThreadStore((s) => s.selectedThreadIds.size > 0);
  const toggleThreadSelection = useThreadStore((s) => s.toggleThreadSelection);
  const selectThreadRange = useThreadStore((s) => s.selectThreadRange);
  const activeLabel = useActiveLabel();
  const emailDensity = useUIStore((s) => s.emailDensity);
  const searchQuery = useThreadStore((s) => s.searchQuery);
  const isSpam = thread.labelIds.includes("SPAM");
  const isDraft = thread.labelIds.includes("DRAFT");

  // Read selectedThreadIds lazily for drag — avoids subscribing all cards to the Set reference
  const dragData: DragData = useMemo(() => ({
    threadIds: hasMultiSelect && isMultiSelected
      ? [...useThreadStore.getState().selectedThreadIds]
      : [thread.id],
    sourceLabel: activeLabel,
  }), [hasMultiSelect, isMultiSelected, thread.id, activeLabel]);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `thread-${thread.id}`,
    data: dragData,
  });

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      e.preventDefault();
      selectThreadRange(thread.id);
    } else if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      toggleThreadSelection(thread.id);
    } else if (hasMultiSelect) {
      toggleThreadSelection(thread.id);
    } else {
      onClick(thread);
    }
  };

  const handleContextMenu = onContextMenu
    ? (e: React.MouseEvent) => onContextMenu(e, thread.id)
    : undefined;

  const handleStarClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      const { starThread } = await import("@/services/emailActions");
      await starThread(thread.accountId, thread.id, [], !thread.isStarred);
    } catch (err) {
      console.error("Failed to toggle star:", err);
    }
  };

  const handleStarTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
  };

  const handleStarTouchEnd = (e: React.TouchEvent) => {
    e.stopPropagation();
  };

  const handleStarKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.stopPropagation();
      e.preventDefault();
      try {
        const { starThread } = await import("@/services/emailActions");
        await starThread(thread.accountId, thread.id, [], !thread.isStarred);
      } catch (err) {
        console.error("Failed to toggle star:", err);
      }
    }
  };

  const handlePinClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const newPinned = !thread.isPinned;
    useThreadStore.getState().updateThread?.(thread.id, { isPinned: newPinned });
    try {
      const { pinThread, unpinThread } = await import("@/services/db/threads");
      const { useToastStore } = await import("@/stores/toastStore");
      if (newPinned) {
        await pinThread(thread.accountId, thread.id);
        useToastStore.getState().showToast?.({
          message: "Thread pinned to top",
          icon: <Pin size={14} className="text-accent fill-current -rotate-45 pin-animate" />,
        });
      } else {
        await unpinThread(thread.accountId, thread.id);
        useToastStore.getState().showToast?.({
          message: "Thread unpinned",
          icon: <Pin size={14} className="text-text-tertiary" />,
        });
      }
    } catch (err) {
      console.error("Failed to toggle pin:", err);
      useThreadStore.getState().updateThread?.(thread.id, { isPinned: !newPinned });
    }
  };

  const handlePinTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
  };

  const handlePinTouchEnd = (e: React.TouchEvent) => {
    e.stopPropagation();
  };

  const handlePinKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.stopPropagation();
      e.preventDefault();
      const newPinned = !thread.isPinned;
      useThreadStore.getState().updateThread?.(thread.id, { isPinned: newPinned });
      try {
        const { pinThread, unpinThread } = await import("@/services/db/threads");
        const { useToastStore } = await import("@/stores/toastStore");
        if (newPinned) {
          await pinThread(thread.accountId, thread.id);
          useToastStore.getState().showToast?.({
            message: "Thread pinned to top",
            icon: <Pin size={14} className="text-accent fill-current -rotate-45 pin-animate" />,
          });
        } else {
          await unpinThread(thread.accountId, thread.id);
          useToastStore.getState().showToast?.({
            message: "Thread unpinned",
            icon: <Pin size={14} className="text-text-tertiary" />,
          });
        }
      } catch (err) {
        console.error("Failed to toggle pin:", err);
        useThreadStore.getState().updateThread?.(thread.id, { isPinned: !newPinned });
      }
    }
  };

  const initial = (
    thread.fromName?.[0] ??
    thread.fromAddress?.[0] ??
    "?"
  ).toUpperCase();

  const [touchOffset, setTouchOffset] = useState(0);
  const [isExiting, setIsExiting] = useState(false);
  const touchStartXRef = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0]?.clientX ?? null;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null) return;
    const currentX = e.touches[0]?.clientX ?? 0;
    const diff = currentX - touchStartXRef.current;
    if (Math.abs(diff) < 120) {
      setTouchOffset(diff);
    }
  };

  const handleTouchEnd = async () => {
    if (touchStartXRef.current === null) return;
    const finalOffset = touchOffset;
    touchStartXRef.current = null;

    const SWIPE_THRESHOLD = 75;
    if (finalOffset < -SWIPE_THRESHOLD) {
      setIsExiting(true);
      if (isDraft || activeLabel === "drafts") {
        try {
          const { deleteThread } = await import("@/services/db/threads");
          await deleteThread(thread.accountId, thread.id);
          useThreadStore.getState().removeThreads?.([thread.id]);
          const { useToastStore } = await import("@/stores/toastStore");
          useToastStore.getState().showToast({
            message: "Draft discarded",
            icon: <Trash2 size={15} className="text-red-500 shrink-0" aria-hidden="true" />,
          });
          window.dispatchEvent(new CustomEvent("suitemail-sync-done"));
          window.dispatchEvent(new CustomEvent("draft-count-changed"));
        } catch (err) {
          console.error("Failed to discard draft on swipe:", err);
          setIsExiting(false);
          setTouchOffset(0);
        }
      } else if (activeLabel === "trash") {
        try {
          const { permanentDeleteThread } = await import("@/services/emailActions");
          await permanentDeleteThread(thread.accountId, thread.id, []);
        } catch (err) {
          console.error("Failed to delete permanently on swipe:", err);
          setIsExiting(false);
          setTouchOffset(0);
        }
      } else {
        try {
          const { archiveThread } = await import("@/services/emailActions");
          await archiveThread(thread.accountId, thread.id, []);
        } catch (err) {
          console.error("Failed to archive on swipe:", err);
          setIsExiting(false);
          setTouchOffset(0);
        }
      }
    } else if (finalOffset > SWIPE_THRESHOLD) {
      setTouchOffset(0);
      try {
        const { starThread } = await import("@/services/emailActions");
        await starThread(thread.accountId, thread.id, [], !thread.isStarred);
      } catch (err) {
        console.error("Failed to star on swipe:", err);
      }
    } else {
      setTouchOffset(0);
    }
  };

  return (
    <div
      className={`relative overflow-hidden border-b border-border-secondary transition-all duration-200 ease-out ${
        isExiting ? "max-h-0 opacity-0 pointer-events-none -translate-x-full" : "max-h-48 opacity-100"
      }`}
    >
      {touchOffset !== 0 && (
        <div
          className={`absolute inset-0 flex items-center px-4 transition-all duration-150 ${
            touchOffset > 0
              ? `justify-start ${
                  touchOffset >= 75
                    ? "bg-amber-500 text-white shadow-inner font-semibold"
                    : "bg-amber-500/20 text-amber-500 font-medium"
                }`
              : (isDraft || activeLabel === "drafts" || activeLabel === "trash")
                ? `justify-end ${
                    touchOffset <= -75
                      ? "bg-red-600 text-white shadow-inner font-semibold"
                      : "bg-red-500/25 text-red-600 dark:text-red-400 font-medium"
                  }`
                : `justify-end ${
                    touchOffset <= -75
                      ? "bg-emerald-600 text-white dark:bg-emerald-500 shadow-inner font-semibold"
                      : "bg-emerald-500/20 text-emerald-500 font-medium"
                  }`
          }`}
        >
          {touchOffset > 0 ? (
            <div className="flex items-center gap-2 text-xs">
              <Star
                size={16}
                className={`transition-transform duration-150 ${
                  touchOffset >= 75 ? "scale-125" : "scale-100"
                } ${thread.isStarred ? "" : "fill-current"}`}
              />
              <span>{thread.isStarred ? "Unstar" : "Star"}</span>
            </div>
          ) : (isDraft || activeLabel === "drafts") ? (
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Trash2
                size={16}
                className={`transition-transform duration-150 ${
                  touchOffset <= -75 ? "scale-125" : "scale-100"
                }`}
              />
              <span>Discard draft</span>
            </div>
          ) : activeLabel === "trash" ? (
            <div className="flex items-center gap-2 text-xs">
              <Trash2
                size={16}
                className={`transition-transform duration-150 ${
                  touchOffset <= -75 ? "scale-125" : "scale-100"
                }`}
              />
              <span>Delete permanently</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs">
              <Archive
                size={16}
                className={`transition-transform duration-150 ${
                  touchOffset <= -75 ? "scale-125 -translate-y-0.5" : "scale-100"
                }`}
              />
              <span>Archive</span>
            </div>
          )}
        </div>
      )}

      <button
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          transform: isExiting ? "translateX(-100%)" : touchOffset ? `translateX(${touchOffset}px)` : undefined,
          transition: isExiting ? "transform 0.2s ease-out, opacity 0.2s ease-out" : touchOffset === 0 ? "transform 0.2s ease-out" : undefined,
        }}
        aria-label={`${isDraft ? "Draft: " : thread.isRead ? "" : "Unread email from "}${thread.fromName ?? thread.fromAddress ?? "Unknown"}: ${thread.subject ?? "(No subject)"}`}
        aria-selected={isSelected || isMultiSelected}
        className={`w-full text-left group hover-lift press-scale border-l-2 transition-colors ${
          isMultiSelected || !thread.isRead || thread.isPinned ? "border-l-accent" : "border-l-transparent"
        } ${
          emailDensity === "compact" ? "px-3 py-1.5" : emailDensity === "spacious" ? "px-4 py-4" : "px-3.5 sm:px-4 py-3.5 sm:py-3"
        } ${
          isDragging
            ? "opacity-50"
            : isMultiSelected
              ? "bg-accent/10 dark:bg-accent/15"
              : isSelected
                ? "bg-bg-selected"
                : thread.isPinned
                  ? "bg-accent/[0.03] hover:bg-accent/[0.06] dark:bg-accent/[0.05] dark:hover:bg-accent/[0.08]"
                  : !thread.isRead
                    ? "bg-bg-primary/95 dark:bg-bg-primary/40 bg-gradient-to-r from-accent/[0.06] via-accent/[0.02] to-transparent hover:bg-bg-hover shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]"
                    : "bg-transparent hover:bg-bg-hover/70"
        } ${isSpam ? "bg-red-500/8 dark:bg-red-500/10" : ""}`}
      >
      <div className="flex items-start gap-3">
        {/* Avatar / Select Checkbox Handle */}
        <div
          role="checkbox"
          aria-checked={isMultiSelected}
          aria-label={isMultiSelected ? "Deselect conversation" : "Select conversation"}
          title={isMultiSelected ? "Deselect conversation" : "Select conversation"}
          onClick={(e) => {
            e.stopPropagation();
            toggleThreadSelection(thread.id);
          }}
          className="relative shrink-0 cursor-pointer group/avatar"
        >
          <div
            className={`rounded-full flex items-center justify-center font-medium transition-all ${
              emailDensity === "compact" ? "w-7 h-7 text-xs" : emailDensity === "spacious" ? "w-10 h-10 text-sm" : "w-9 h-9 text-sm"
            } ${
              isMultiSelected
                ? "bg-accent text-white shadow-sm ring-2 ring-accent/30 scale-100"
                : isDraft
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/25 shadow-2xs"
                  : thread.isRead
                    ? "bg-text-tertiary/20 text-text-tertiary dark:bg-text-tertiary/30 dark:text-text-secondary group-hover/avatar:ring-2 group-hover/avatar:ring-accent/40"
                    : "bg-accent text-white shadow-sm ring-2 ring-accent/20 group-hover/avatar:ring-accent/50"
            }`}
          >
            {isMultiSelected ? (
              <Check size={emailDensity === "compact" ? 14 : 16} className="stroke-[2.5]" />
            ) : (
              <>
                <span className="group-hover/avatar:hidden">
                  {isDraft ? <FileEdit size={emailDensity === "compact" ? 12 : 14} className="stroke-[2.2]" /> : initial}
                </span>
                <span className="hidden group-hover/avatar:flex items-center justify-center text-accent dark:text-white">
                  <Check size={emailDensity === "compact" ? 12 : 14} className="stroke-[2.5]" />
                </span>
              </>
            )}
          </div>
          {!thread.isRead && !isMultiSelected && (
            <span
              className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-accent ring-2 ring-bg-primary dark:ring-slate-900 shadow-xs"
              aria-hidden="true"
            />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* First row: sender + unread dot + date */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              {isDraft ? (
                <span
                  data-testid="draft-badge"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.6875rem] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 shrink-0 shadow-2xs"
                >
                  <FileEdit size={10} className="stroke-[2.5]" />
                  Draft
                </span>
              ) : !thread.isRead ? (
                <span
                  data-testid="unread-dot"
                  className="w-2.5 h-2.5 rounded-full bg-accent shrink-0 shadow-[0_0_8px_rgba(79,70,229,0.7)] dark:shadow-[0_0_10px_rgba(129,140,248,0.8)] ring-2 ring-accent/30 dark:ring-accent/40"
                  title="Unread"
                  aria-hidden="true"
                />
              ) : null}
              <span
                className={`text-sm leading-snug truncate ${
                  isDraft
                    ? "font-medium text-text-primary"
                    : thread.isRead
                      ? "font-normal text-text-secondary"
                      : "font-bold text-text-primary tracking-tight"
                }`}
              >
                {isDraft && thread.toAddresses ? (
                  <span className="inline-flex items-center gap-1">
                    <span className="text-text-tertiary font-normal">To:</span>
                    <span>{highlightMatch(thread.toAddresses, searchQuery)}</span>
                  </span>
                ) : (
                  highlightMatch(thread.fromName ?? thread.fromAddress ?? "Draft", searchQuery)
                )}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {thread.isPinned && (
                <span
                  data-testid="thread-pinned-badge"
                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-accent bg-accent/15 dark:bg-accent/25 px-2 py-0.5 rounded-full border border-accent/25 shadow-2xs shrink-0"
                  title="Pinned"
                >
                  <Pin size={10} className="fill-current -rotate-45 pin-animate text-accent" />
                  <span>Pinned</span>
                </span>
              )}
              {(activeLabel === "snoozed" || thread.labelIds.includes("SNOOZED")) && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-medium text-accent bg-accent/10 dark:bg-accent/20 px-1.5 py-0.5 rounded-full border border-accent/20 shadow-xs"
                  title="Snoozed"
                >
                  <Clock size={9} />
                  <span>Snoozed</span>
                </span>
              )}
              <span
                className={`text-xs whitespace-nowrap transition-colors ${
                  thread.isRead
                    ? "text-text-tertiary font-normal"
                    : "font-semibold text-accent dark:text-accent-hover"
                }`}
              >
                {formatRelativeDate(thread.lastMessageAt)}
              </span>

              {/* Quick Pin toggle (44x44dp mobile touch target) */}
              <span
                role="button"
                tabIndex={0}
                aria-label={thread.isPinned ? "Unpin thread" : "Pin thread"}
                title={thread.isPinned ? "Unpin thread" : "Pin thread"}
                onClick={handlePinClick}
                onKeyDown={handlePinKeyDown}
                onTouchStart={handlePinTouchStart}
                onTouchEnd={handlePinTouchEnd}
                className={`min-w-[44px] min-h-[44px] sm:min-w-[28px] sm:min-h-[28px] -my-2.5 sm:-my-1 rounded-full transition-all duration-150 cursor-pointer flex items-center justify-center touch-manipulation active:scale-75 ${
                  thread.isPinned
                    ? "text-accent bg-accent/15 hover:bg-accent/25 active:bg-accent/30 shadow-2xs"
                    : "opacity-60 sm:opacity-0 sm:group-hover:opacity-60 hover:!opacity-100 focus:opacity-100 text-text-tertiary hover:text-accent hover:bg-bg-tertiary active:bg-accent/15 active:text-accent"
                }`}
              >
                <Pin
                  size={15}
                  className={`transition-transform duration-200 ${
                    thread.isPinned
                      ? "fill-current -rotate-45 pin-animate text-accent"
                      : "group-hover:-rotate-12"
                  }`}
                />
              </span>

              {/* Star toggle (44x44dp mobile touch target) */}
              <span
                role="button"
                tabIndex={0}
                aria-label={thread.isStarred ? "Unstar" : "Star"}
                title={thread.isStarred ? "Unstar (s)" : "Star (s)"}
                onClick={handleStarClick}
                onKeyDown={handleStarKeyDown}
                onTouchStart={handleStarTouchStart}
                onTouchEnd={handleStarTouchEnd}
                className={`min-w-[44px] min-h-[44px] sm:min-w-[28px] sm:min-h-[28px] -mr-2 sm:-mr-0.5 -my-2.5 sm:-my-1 rounded-full transition-all duration-150 cursor-pointer flex items-center justify-center touch-manipulation active:scale-75 ${
                  thread.isStarred
                    ? "text-amber-500 dark:text-amber-400 hover:text-amber-600 dark:hover:text-amber-300 hover:bg-amber-500/15 active:bg-amber-500/25"
                    : "opacity-60 sm:opacity-0 sm:group-hover:opacity-60 hover:!opacity-100 focus:opacity-100 text-text-tertiary hover:text-amber-500 hover:bg-bg-tertiary active:bg-amber-500/10 active:text-amber-500"
                }`}
              >
                <Star
                  size={16}
                  className={`transition-all duration-200 ${
                    thread.isStarred
                      ? "fill-amber-400 text-amber-500 dark:text-amber-400 star-animate drop-shadow-[0_0_8px_rgba(245,158,11,0.6)]"
                      : "hover:scale-110 active:scale-95"
                  }`}
                />
              </span>
            </div>
          </div>

          {/* Subject */}
          <div
            className={`text-sm leading-snug truncate mt-1 sm:mt-0.5 ${
              isDraft
                ? "italic text-text-primary font-medium"
                : thread.isRead
                  ? "font-normal text-text-secondary/85"
                  : "font-bold text-text-primary"
            }`}
          >
            {highlightMatch(thread.subject ?? "(No subject)", searchQuery)}
          </div>

          {/* Snippet + indicators */}
          <div className={`flex items-center gap-1.5 mt-1 sm:mt-0.5 ${emailDensity === "compact" ? "hidden" : ""}`}>
            <span
              className={`text-xs leading-relaxed truncate flex-1 ${
                thread.isRead ? "text-text-tertiary" : "text-text-secondary font-medium"
              }`}
            >
              {highlightMatch(thread.snippet, searchQuery)}
            </span>
            {showCategoryBadge && category && category !== "Primary" && CATEGORY_COLORS[category] && (
              <span className={`shrink-0 text-[0.625rem] px-1.5 rounded-full leading-normal ${CATEGORY_COLORS[category]}`}>
                {category}
              </span>
            )}
            {hasFollowUp && (
              <span className="shrink-0 text-accent" title="Follow-up reminder set">
                <BellRing size={12} />
              </span>
            )}
            {thread.isMuted && (
              <span className="shrink-0 text-warning" title="Muted">
                <VolumeX size={12} />
              </span>
            )}
            {thread.isPinned && (
              <span className="shrink-0 text-accent" title="Pinned">
                <Pin size={11} className="fill-current -rotate-45" />
              </span>
            )}
            {thread.hasAttachments && (
              <span className="shrink-0 text-text-tertiary" title="Has attachments">
                <Paperclip size={12} />
              </span>
            )}
            {thread.messageCount > 1 && (
              <span className="text-xs text-text-tertiary shrink-0 bg-bg-tertiary rounded-full px-1.5">
                {thread.messageCount}
              </span>
            )}
          </div>
        </div>
      </div>

      </button>
    </div>
  );
});
