import { useState, useRef, useCallback, useMemo, Fragment } from "react";
import { CSSTransition } from "react-transition-group";
import { useLabelStore } from "@/stores/labelStore";
import { useAccountStore } from "@/stores/accountStore";
import { useThreadStore } from "@/stores/threadStore";
import { useToastStore } from "@/stores/toastStore";
import {
  archiveThread,
  trashThread,
  spamThread,
  addThreadLabel,
  removeThreadLabel,
  moveThread,
} from "@/services/emailActions";
import {
  Inbox,
  Archive,
  Trash2,
  Ban,
  Search,
  Tag,
  Folder,
  FolderPlus,
  X,
  Check,
} from "lucide-react";

interface MoveToFolderDialogProps {
  isOpen: boolean;
  threadIds: string[];
  onClose: () => void;
}

interface Destination {
  id: string;
  label: string;
  icon: typeof Inbox;
  type: "system" | "label";
  /** For IMAP: the folder path to move to */
  folderPath?: string;
  colorBg?: string | null;
  colorFg?: string | null;
}

const SYSTEM_DESTINATIONS: Destination[] = [
  { id: "INBOX", label: "Inbox", icon: Inbox, type: "system" },
  { id: "__archive__", label: "Archive", icon: Archive, type: "system" },
  { id: "TRASH", label: "Trash", icon: Trash2, type: "system" },
  { id: "SPAM", label: "Spam", icon: Ban, type: "system" },
];

export function MoveToFolderDialog({
  isOpen,
  threadIds,
  onClose,
}: MoveToFolderDialogProps) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isSubmittingNew, setIsSubmittingNew] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const labels = useLabelStore((s) => s.labels);
  const createLabel = useLabelStore(
    (s) =>
      (s as unknown as { createLabel?: (accountId: string, name: string) => Promise<unknown> })
        ?.createLabel,
  );
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const accounts = useAccountStore((s) => s.accounts);
  const threads = useThreadStore((s) => s.threads);

  const account = useMemo(
    () => accounts.find((a) => a.id === activeAccountId),
    [accounts, activeAccountId],
  );
  const isImap = account?.provider === "imap";

  // Build the full destination list: system destinations + user labels
  const destinations = useMemo(() => {
    const userLabels: Destination[] = labels.map((l) => ({
      id: l.id,
      label: l.name,
      icon: Tag,
      type: "label" as const,
      colorBg: l.colorBg,
      colorFg: l.colorFg,
    }));
    return [...SYSTEM_DESTINATIONS, ...userLabels];
  }, [labels]);

  // Filter destinations by search query
  const filtered = useMemo(() => {
    if (!query.trim()) return destinations;
    const q = query.toLowerCase();
    return destinations.filter((d) => d.label.toLowerCase().includes(q));
  }, [destinations, query]);

  const hasExactMatch = useMemo(() => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return destinations.some((d) => d.label.toLowerCase() === q);
  }, [destinations, query]);

  // Compute thread counts for each destination badge
  const getThreadCount = useCallback(
    (dest: Destination) => {
      if (!Array.isArray(threads) || threads.length === 0) return 0;
      if (dest.id === "INBOX") {
        return threads.filter((t) => t?.labelIds?.includes("INBOX")).length;
      }
      if (dest.id === "TRASH") {
        return threads.filter((t) => t?.labelIds?.includes("TRASH")).length;
      }
      if (dest.id === "SPAM") {
        return threads.filter((t) => t?.labelIds?.includes("SPAM")).length;
      }
      if (dest.type === "label") {
        return threads.filter((t) => t?.labelIds?.includes(dest.id)).length;
      }
      return 0;
    },
    [threads],
  );

  const handleSelect = useCallback(
    async (dest: Destination) => {
      if (!activeAccountId || threadIds.length === 0) return;
      onClose();

      for (const threadId of threadIds) {
        if (dest.id === "__archive__") {
          await archiveThread(activeAccountId, threadId, []);
        } else if (dest.id === "TRASH") {
          await trashThread(activeAccountId, threadId, []);
        } else if (dest.id === "SPAM") {
          await spamThread(activeAccountId, threadId, [], true);
        } else if (dest.id === "INBOX") {
          if (isImap) {
            await moveThread(activeAccountId, threadId, [], "INBOX");
          } else {
            // Gmail: add INBOX label (un-archive)
            await addThreadLabel(activeAccountId, threadId, "INBOX");
          }
        } else if (dest.type === "label") {
          if (isImap) {
            // IMAP: move to folder. The label's id is the folder path for IMAP accounts.
            await moveThread(activeAccountId, threadId, [], dest.id);
          } else {
            // Gmail: add destination label + remove from current location (archive)
            await addThreadLabel(activeAccountId, threadId, dest.id);
            // Remove INBOX to complete the "move" semantics
            const thread = useThreadStore
              .getState()
              .threads.find((t) => t.id === threadId);
            if (thread?.labelIds.includes("INBOX")) {
              await removeThreadLabel(activeAccountId, threadId, "INBOX");
            }
          }
        }
      }

      // Refresh thread list
      window.dispatchEvent(new Event("velo-sync-done"));

      // Immediate optimistic feedback toast
      useToastStore.getState().showToast({
        message: `Moved to ${dest.label}`,
        icon: <Folder size={14} className="text-accent shrink-0" />,
        duration: 3000,
      });
    },
    [activeAccountId, threadIds, isImap, onClose],
  );

  const handleCreateAndMove = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed || !activeAccountId || isSubmittingNew) return;
      setIsSubmittingNew(true);
      try {
        if (createLabel) {
          await createLabel(activeAccountId, trimmed);
          const latestLabels = useLabelStore.getState().labels;
          const created = latestLabels.find(
            (l) => l.name.toLowerCase() === trimmed.toLowerCase(),
          );
          if (created) {
            await handleSelect({
              id: created.id,
              label: created.name,
              icon: Tag,
              type: "label",
              colorBg: created.colorBg,
              colorFg: created.colorFg,
            });
            return;
          }
        }
        onClose();
      } catch (err) {
        console.error("Failed to create and move to label:", err);
        onClose();
      } finally {
        setIsSubmittingNew(false);
        setIsCreating(false);
      }
    },
    [activeAccountId, isSubmittingNew, createLabel, handleSelect, onClose],
  );

  const scrollToIndex = (index: number) => {
    const list = listRef.current;
    if (!list) return;
    const optionButtons = list.querySelectorAll<HTMLElement>('[role="option"]');
    optionButtons[index]?.scrollIntoView?.({ block: "nearest" });
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isCreating) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((prev) => {
          const next = Math.min(prev + 1, filtered.length - 1);
          scrollToIndex(next);
          return next;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((prev) => {
          const next = Math.max(prev - 1, 0);
          scrollToIndex(next);
          return next;
        });
      } else if (e.key === "Enter") {
        e.preventDefault();
        const dest = filtered[selectedIdx];
        if (dest) {
          handleSelect(dest);
        } else if (query.trim()) {
          handleCreateAndMove(query.trim());
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [filtered, selectedIdx, handleSelect, onClose, isCreating, query, handleCreateAndMove],
  );

  // Reset state when dialog opens/closes
  const handleEntered = () => {
    setQuery("");
    setSelectedIdx(0);
    setIsCreating(false);
    setNewFolderName("");
    inputRef.current?.focus();
  };

  return (
    <CSSTransition
      in={isOpen}
      timeout={150}
      classNames="modal"
      unmountOnExit
      nodeRef={overlayRef}
      onEntered={handleEntered}
    >
      <div
        ref={overlayRef}
        className="fixed inset-0 z-50 flex items-end sm:items-start justify-center p-0 sm:p-4 pt-0 sm:pt-[14vh]"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          className="glass-backdrop absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm transition-opacity"
          aria-hidden="true"
        />
        <div
          className="modal-panel relative flex flex-col bg-bg-primary/95 dark:bg-bg-primary/95 backdrop-blur-xl border-t sm:border border-border-primary/80 dark:border-white/10 rounded-t-[28px] sm:rounded-2xl glass-modal w-full sm:w-[380px] max-h-[85vh] sm:max-h-[80vh] shadow-2xl overflow-hidden transition-all duration-200 pb-safe"
          onKeyDown={handleKeyDown}
        >
          {/* Mobile Sheet Drag Handle */}
          <div
            className="sm:hidden flex flex-col items-center pt-3 pb-1 cursor-grab active:cursor-grabbing select-none shrink-0"
            onClick={onClose}
            aria-label="Dismiss bottom sheet"
          >
            <div className="w-10 h-1.5 rounded-full bg-border-primary/90 dark:bg-white/30 transition-transform active:scale-95" />
          </div>

          {/* Mobile Sheet Header: Title + Thread Count + Close Button */}
          <div className="sm:hidden flex items-center justify-between px-4 py-2 border-b border-border-secondary/60 shrink-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-base text-text-primary tracking-tight">
                Move to
              </span>
              {threadIds.length > 0 && (
                <span className="text-xs font-semibold text-accent bg-accent/15 dark:bg-accent/25 px-2.5 py-0.5 rounded-full">
                  {threadIds.length} {threadIds.length === 1 ? "thread" : "threads"}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="w-10 h-10 -mr-1 flex items-center justify-center rounded-full text-text-tertiary hover:text-text-primary active:bg-bg-hover active:scale-95 transition-all cursor-pointer touch-manipulation"
            >
              <X size={18} />
            </button>
          </div>

          {/* Search bar header */}
          <div className="relative border-b border-border-secondary/80 flex items-center gap-2.5 px-4 py-3 bg-bg-secondary/30 shrink-0">
            <div className="flex-1 flex items-center gap-2.5 bg-bg-primary/90 dark:bg-bg-secondary/70 border border-border-primary/80 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25 rounded-xl px-3.5 py-2.5 sm:py-1.5 transition-all shadow-2xs">
              <Search size={18} className="text-accent shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelectedIdx(0);
                }}
                placeholder="Move to..."
                className="flex-1 bg-transparent text-base sm:text-sm text-text-primary placeholder:text-text-tertiary outline-none font-normal"
                autoFocus
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setSelectedIdx(0);
                    inputRef.current?.focus();
                  }}
                  className="w-8 h-8 -mr-1 flex items-center justify-center text-text-tertiary hover:text-text-primary rounded-full hover:bg-bg-hover active:scale-90 transition-all cursor-pointer touch-manipulation"
                  title="Clear search"
                  aria-label="Clear search"
                >
                  <X size={16} />
                </button>
              ) : threadIds.length > 0 ? (
                <span className="hidden sm:inline-flex text-[11px] font-medium text-text-tertiary px-2 py-0.5 rounded-full bg-bg-secondary dark:bg-bg-tertiary shrink-0 select-none">
                  {threadIds.length} {threadIds.length === 1 ? "thread" : "threads"}
                </span>
              ) : null}
            </div>
          </div>

          {/* Destination list */}
          <div
            ref={listRef}
            className="flex-1 max-h-[55vh] sm:max-h-72 overflow-y-auto p-2 sm:p-1.5 space-y-1 sm:space-y-0.5"
            role="listbox"
          >
            {filtered.length === 0 && (
              <div className="px-4 py-8 text-center">
                <div className="w-12 h-12 rounded-2xl bg-bg-secondary dark:bg-bg-tertiary flex items-center justify-center mx-auto mb-3 text-text-tertiary">
                  <FolderPlus size={22} />
                </div>
                <div className="text-sm sm:text-xs text-text-tertiary mb-3 font-medium">
                  No matching folders or labels
                </div>
                {query.trim() && (
                  <button
                    type="button"
                    onClick={() => handleCreateAndMove(query.trim())}
                    disabled={isSubmittingNew}
                    className="min-h-[48px] sm:min-h-0 inline-flex items-center gap-2 px-4 py-2.5 sm:px-3 sm:py-1.5 text-sm sm:text-xs font-semibold text-white bg-accent hover:bg-accent-hover active:scale-95 rounded-xl transition-all shadow-xs cursor-pointer disabled:opacity-50 touch-manipulation"
                  >
                    <FolderPlus size={16} />
                    <span>Create and move to &ldquo;{query.trim()}&rdquo;</span>
                  </button>
                )}
              </div>
            )}

            {filtered.map((dest, idx) => {
              const isSelected = idx === selectedIdx;
              const count = getThreadCount(dest);

              const showSystemHeader = idx === 0 && dest.type === "system";
              const showLabelHeader =
                dest.type === "label" && (idx === 0 || filtered[idx - 1]?.type === "system");

              return (
                <Fragment key={dest.id}>
                  {showSystemHeader && (
                    <div className="px-3 pt-2 pb-1 text-[11px] font-semibold text-text-tertiary tracking-wider uppercase select-none">
                      System Folders
                    </div>
                  )}
                  {showLabelHeader && (
                    <div
                      className={`px-3 pb-1 text-[11px] font-semibold text-text-tertiary tracking-wider uppercase select-none flex items-center justify-between ${
                        idx > 0 ? "mt-2 pt-2 border-t border-border-secondary/60" : "pt-2"
                      }`}
                    >
                      <span>{isImap ? "Folders" : "Labels"}</span>
                      <span className="text-[10px] text-text-tertiary/60 font-normal">
                        {labels.length} {labels.length === 1 ? (isImap ? "folder" : "label") : (isImap ? "folders" : "labels")}
                      </span>
                    </div>
                  )}

                  <button
                    role="option"
                    aria-selected={isSelected}
                    className={`group flex items-center gap-3 w-full min-h-[52px] sm:min-h-0 px-3.5 py-3 sm:py-2 rounded-xl text-left cursor-pointer transition-all duration-150 touch-manipulation active:scale-[0.98] ${
                      isSelected
                        ? "bg-accent/15 dark:bg-accent/25 text-accent dark:text-accent-light font-medium ring-1 ring-accent/30 shadow-2xs"
                        : "text-text-secondary hover:text-text-primary hover:bg-bg-hover/80 active:bg-accent/10"
                    }`}
                    onClick={() => handleSelect(dest)}
                    onMouseEnter={() => setSelectedIdx(idx)}
                  >
                    {/* Destination Icon or Color Dot */}
                    {dest.type === "system" ? (
                      dest.id === "INBOX" ? (
                        <div className="w-8 h-8 sm:w-6 sm:h-6 rounded-xl sm:rounded-lg bg-blue-500/15 dark:bg-blue-500/25 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                          <Inbox size={16} />
                        </div>
                      ) : dest.id === "__archive__" ? (
                        <div className="w-8 h-8 sm:w-6 sm:h-6 rounded-xl sm:rounded-lg bg-indigo-500/15 dark:bg-indigo-500/25 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                          <Archive size={16} />
                        </div>
                      ) : dest.id === "TRASH" ? (
                        <div className="w-8 h-8 sm:w-6 sm:h-6 rounded-xl sm:rounded-lg bg-rose-500/15 dark:bg-rose-500/25 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                          <Trash2 size={16} />
                        </div>
                      ) : (
                        <div className="w-8 h-8 sm:w-6 sm:h-6 rounded-xl sm:rounded-lg bg-amber-500/15 dark:bg-amber-500/25 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                          <Ban size={16} />
                        </div>
                      )
                    ) : dest.colorBg ? (
                      <div
                        className="w-8 h-8 sm:w-6 sm:h-6 rounded-xl sm:rounded-lg flex items-center justify-center shrink-0 border border-black/5 dark:border-white/10"
                        style={{ backgroundColor: `${dest.colorBg}22` }}
                      >
                        <span
                          className="w-3 h-3 sm:w-2.5 sm:h-2.5 rounded-full shadow-2xs"
                          style={{ backgroundColor: dest.colorBg }}
                        />
                      </div>
                    ) : (
                      <div className="w-8 h-8 sm:w-6 sm:h-6 rounded-xl sm:rounded-lg bg-accent/15 dark:bg-accent/25 text-accent dark:text-accent-light flex items-center justify-center shrink-0">
                        <Folder size={16} />
                      </div>
                    )}

                    {/* Folder / Label name */}
                    <span className="truncate flex-1 font-medium text-base sm:text-sm text-text-primary group-hover:text-text-primary">
                      {dest.label}
                    </span>

                    {/* Count badge */}
                    {count > 0 && (
                      <span
                        className={`text-xs sm:text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                          isSelected
                            ? "bg-accent/20 text-accent dark:text-accent-light"
                            : "bg-bg-secondary dark:bg-bg-tertiary text-text-tertiary"
                        }`}
                      >
                        {count}
                      </span>
                    )}

                    {/* System label tag */}
                    {dest.type === "system" && (
                      <span className="text-[10px] text-text-tertiary uppercase tracking-wider px-2 py-0.5 rounded bg-bg-secondary/70 dark:bg-bg-tertiary/70 border border-border-secondary">
                        System
                      </span>
                    )}

                    {/* Enter shortcut hint on desktop selection / checkmark on mobile selection */}
                    {isSelected && (
                      <>
                        <kbd className="hidden sm:inline-block text-[10px] font-semibold text-accent/80 dark:text-accent-light px-1.5 py-0.5 rounded bg-accent/15 border border-accent/30 font-mono shadow-2xs">
                          ↵
                        </kbd>
                        <Check size={16} className="sm:hidden text-accent shrink-0" />
                      </>
                    )}
                  </button>
                </Fragment>
              );
            })}
          </div>

          {/* Quick action: Create new folder */}
          {!isCreating ? (
            <div className="px-4 py-3 sm:py-1.5 border-t border-border-secondary/60 bg-bg-secondary/25 flex items-center justify-between shrink-0">
              <button
                type="button"
                onClick={() => {
                  setIsCreating(true);
                  setTimeout(() => newFolderInputRef.current?.focus(), 50);
                }}
                className="min-h-[48px] sm:min-h-0 inline-flex items-center gap-2 px-3.5 py-2.5 sm:px-2.5 sm:py-1 text-sm sm:text-xs font-semibold text-accent hover:text-accent-hover hover:bg-accent/10 active:bg-accent/15 rounded-xl transition-all cursor-pointer touch-manipulation active:scale-95"
              >
                <FolderPlus size={16} />
                <span>Create new {isImap ? "folder" : "label"}...</span>
              </button>
              {query.trim() && !hasExactMatch && (
                <button
                  type="button"
                  onClick={() => handleCreateAndMove(query.trim())}
                  className="min-h-[48px] sm:min-h-0 px-3 py-2 text-sm sm:text-[11px] font-semibold text-accent hover:underline active:scale-95 transition-transform cursor-pointer touch-manipulation flex items-center"
                >
                  + Create &ldquo;{query.trim()}&rdquo;
                </button>
              )}
            </div>
          ) : (
            <div className="p-3 sm:p-2 border-t border-border-secondary/60 bg-bg-secondary/40 flex items-center gap-2 shrink-0">
              <input
                ref={newFolderInputRef}
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder={`New ${isImap ? "folder" : "label"} name...`}
                className="flex-1 min-h-[48px] sm:min-h-0 bg-bg-primary border border-border-primary rounded-xl px-3.5 py-2.5 sm:py-1.5 text-base sm:text-xs text-text-primary placeholder:text-text-tertiary outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    handleCreateAndMove(newFolderName);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsCreating(false);
                  }
                }}
              />
              <button
                type="button"
                disabled={!newFolderName.trim() || isSubmittingNew}
                onClick={() => handleCreateAndMove(newFolderName)}
                className="min-h-[48px] sm:min-h-0 min-w-[72px] sm:min-w-0 px-4 py-2.5 sm:py-1.5 bg-accent text-white rounded-xl text-sm sm:text-xs font-semibold hover:bg-accent-hover active:scale-95 transition-all disabled:opacity-50 cursor-pointer shadow-xs touch-manipulation"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="min-h-[48px] min-w-[48px] sm:min-h-0 sm:min-w-0 p-2.5 sm:p-1.5 flex items-center justify-center text-text-tertiary hover:text-text-primary rounded-xl hover:bg-bg-hover active:scale-90 transition-all cursor-pointer touch-manipulation"
                title="Cancel"
                aria-label="Cancel"
              >
                <X size={18} />
              </button>
            </div>
          )}

          {/* Footer hint */}
          <div className="hidden sm:flex items-center justify-between px-3.5 py-2 border-t border-border-secondary/60 bg-bg-secondary/40 text-[10px] text-text-tertiary select-none shrink-0">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-bg-primary dark:bg-bg-tertiary border border-border-primary/80 font-mono text-text-secondary text-[10px] shadow-2xs">
                  ↑↓
                </kbd>{" "}
                navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-bg-primary dark:bg-bg-tertiary border border-border-primary/80 font-mono text-text-secondary text-[10px] shadow-2xs">
                  ↵
                </kbd>{" "}
                select
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-bg-primary dark:bg-bg-tertiary border border-border-primary/80 font-mono text-text-secondary text-[10px] shadow-2xs">
                  esc
                </kbd>{" "}
                close
              </span>
            </div>
            <span className="font-medium text-text-tertiary/70">
              SuperMail
            </span>
          </div>
        </div>
      </div>
    </CSSTransition>
  );
}
