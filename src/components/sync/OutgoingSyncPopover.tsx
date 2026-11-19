import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  CloudUpload,
  AlertTriangle,
  Tag,
  Archive,
  Trash2,
  FolderInput,
  Send,
  X,
  Check,
  Server,
  Info,
} from "lucide-react";
import { useOutgoingSyncStore, type OutgoingDiffItem } from "@/stores/outgoingSyncStore";
import { Button } from "@/components/ui/Button";

function getItemIcon(type: OutgoingDiffItem["type"]) {
  switch (type) {
    case "label":
      return <Tag size={14} className="text-indigo-400 shrink-0" />;
    case "archive":
      return <Archive size={14} className="text-amber-500 shrink-0" />;
    case "trash":
    case "delete":
      return <Trash2 size={14} className="text-danger shrink-0" />;
    case "spam":
      return <AlertTriangle size={14} className="text-orange-500 shrink-0" />;
    case "move":
      return <FolderInput size={14} className="text-blue-400 shrink-0" />;
    case "send":
      return <Send size={14} className="text-accent shrink-0" />;
    case "metadata":
    default:
      return <Server size={14} className="text-text-tertiary shrink-0" />;
  }
}

export function OutgoingSyncPopover() {
  const activeRequest = useOutgoingSyncStore((s) => s.activeRequest);
  const isOpen = useOutgoingSyncStore((s) => s.isOpen);
  const confirm = useOutgoingSyncStore((s) => s.confirm);
  const cancel = useOutgoingSyncStore((s) => s.cancel);

  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      } else if (e.key === "Enter" && !e.shiftKey) {
        const target = e.target as HTMLElement;
        if (target.tagName !== "TEXTAREA" && target.tagName !== "INPUT") {
          e.preventDefault();
          confirm();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    const timer = setTimeout(() => confirmBtnRef.current?.focus(), 50);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      clearTimeout(timer);
    };
  }, [isOpen, confirm, cancel]);

  if (!isOpen || !activeRequest) return null;

  const { title, description, items, summary, isFirstSync } = activeRequest;

  const content = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="outgoing-sync-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 glass-backdrop backdrop-blur-sm transition-opacity"
        onClick={cancel}
      />

      {/* Popover Card */}
      <div className="relative bg-bg-primary border border-border-primary rounded-xl glass-modal shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[85vh] animate-[scaleIn_150ms_ease-out]">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-border-primary bg-bg-secondary">
          <div className="p-1.5 rounded-md bg-amber-500/10 text-amber-500 border border-amber-500/20">
            <CloudUpload size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h2
              id="outgoing-sync-title"
              className="text-sm font-semibold text-text-primary truncate"
            >
              {title}
            </h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">
                {isFirstSync ? "First Sync Outgoing Diff" : "Large Outgoing Diff"}
              </span>
              <span className="text-xs text-text-tertiary">
                Requires user confirmation
              </span>
            </div>
          </div>
          <button
            onClick={cancel}
            aria-label="Cancel outgoing sync"
            className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Info callout */}
          <div className="p-3 rounded-lg bg-bg-secondary border border-border-primary flex items-start gap-2.5 text-xs text-text-secondary leading-relaxed">
            <Info size={16} className="text-accent shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-text-primary mb-1">
                Syncing from app to server requires your review
              </p>
              <p>{description}</p>
              <p className="mt-1.5 text-text-tertiary">
                <span className="font-medium text-text-secondary">Note:</span> Syncing from server to app is always ok and will continue normally.
              </p>
            </div>
          </div>

          {/* Summary Breakdown Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            <div className="p-2.5 rounded-lg bg-bg-secondary border border-border-primary">
              <span className="text-text-tertiary block text-[11px]">Total Outgoing</span>
              <span className="text-base font-semibold text-text-primary">{summary.total}</span>
            </div>

            {Boolean(summary.labelsCount) && (
              <div className="p-2.5 rounded-lg bg-bg-secondary border border-border-primary">
                <span className="text-text-tertiary block text-[11px] flex items-center gap-1">
                  <Tag size={10} className="text-indigo-400" /> Labels
                </span>
                <span className="text-base font-semibold text-text-primary">{summary.labelsCount}</span>
              </div>
            )}

            {Boolean(summary.archiveCount) && (
              <div className="p-2.5 rounded-lg bg-bg-secondary border border-border-primary">
                <span className="text-text-tertiary block text-[11px] flex items-center gap-1">
                  <Archive size={10} className="text-amber-500" /> Archives
                </span>
                <span className="text-base font-semibold text-text-primary">{summary.archiveCount}</span>
              </div>
            )}

            {Boolean(summary.trashCount) && (
              <div className="p-2.5 rounded-lg bg-bg-secondary border border-border-primary">
                <span className="text-text-tertiary block text-[11px] flex items-center gap-1">
                  <Trash2 size={10} className="text-danger" /> Trashed
                </span>
                <span className="text-base font-semibold text-text-primary">{summary.trashCount}</span>
              </div>
            )}

            {Boolean(summary.spamCount) && (
              <div className="p-2.5 rounded-lg bg-bg-secondary border border-border-primary">
                <span className="text-text-tertiary block text-[11px] flex items-center gap-1">
                  <AlertTriangle size={10} className="text-orange-500" /> Spam
                </span>
                <span className="text-base font-semibold text-text-primary">{summary.spamCount}</span>
              </div>
            )}

            {Boolean(summary.metadataCount) && (
              <div className="p-2.5 rounded-lg bg-bg-secondary border border-border-primary">
                <span className="text-text-tertiary block text-[11px] flex items-center gap-1">
                  <Server size={10} className="text-text-tertiary" /> Metadata
                </span>
                <span className="text-base font-semibold text-text-primary">{summary.metadataCount}</span>
              </div>
            )}
          </div>

          {/* List of Affected Items */}
          <div className="space-y-1.5">
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
              Changes Preview ({items.length})
            </h3>
            <div className="rounded-lg border border-border-primary bg-bg-secondary divide-y divide-border-primary max-h-56 overflow-y-auto">
              {items.map((item) => (
                <div key={item.id} className="p-2.5 flex items-start gap-2.5 text-xs hover:bg-bg-hover transition-colors">
                  <div className="mt-0.5">{getItemIcon(item.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-text-primary truncate">
                        {item.subject ? item.subject : item.summary}
                      </span>
                      <span className="uppercase text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-tertiary text-text-secondary shrink-0">
                        {item.type}
                      </span>
                    </div>
                    {item.subject && (
                      <p className="text-[11px] text-text-tertiary truncate mt-0.5">
                        {item.summary}
                      </p>
                    )}
                    {item.labels && item.labels.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {item.labels.map((l) => (
                          <span
                            key={l}
                            className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                          >
                            {l}
                          </span>
                        ))}
                      </div>
                    )}
                    {item.details && (
                      <p className="text-[11px] text-text-tertiary mt-0.5">
                        {item.details}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-t border-border-primary bg-bg-secondary">
          <Button
            variant="secondary"
            size="sm"
            onClick={cancel}
            aria-label="Don't sync changes to server"
          >
            Don't Sync
          </Button>
          <div className="flex items-center gap-2">
            <Button
              ref={confirmBtnRef}
              variant="primary"
              size="sm"
              icon={<Check size={14} />}
              onClick={confirm}
              aria-label="Confirm syncing changes to server"
            >
              Sync to Server
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(content, document.body) : content;
}
