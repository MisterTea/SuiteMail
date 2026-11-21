import { useAndroidMobile } from "@/hooks/useAndroidMobile";
import { Modal } from "@/components/ui/Modal";
import { memo, useState } from "react";
import {
  Archive,
  Trash2,
  MailOpen,
  Mail,
  Star,
  FolderInput,
  Ban,
  X,
  CheckSquare,
  MoreHorizontal,
} from "lucide-react";

export interface BatchActionBarProps {
  selectedCount: number;
  totalCount: number;
  allRead?: boolean;
  allStarred?: boolean;
  isSpamView?: boolean;
  onArchive: () => void;
  onDelete: () => void;
  onMarkRead: (read: boolean) => void;
  onStar: (starred: boolean) => void;
  onMoveToFolder: () => void;
  onSpam: () => void;
  onClear: () => void;
  onSelectAll: () => void;
}

export const BatchActionBar = memo(function BatchActionBar({
  selectedCount,
  totalCount,
  allRead = false,
  allStarred = false,
  isSpamView = false,
  onArchive,
  onDelete,
  onMarkRead,
  onStar,
  onMoveToFolder,
  onSpam,
  onClear,
  onSelectAll,
}: BatchActionBarProps) {
  const androidMobile = useAndroidMobile();
  const [showMore, setShowMore] = useState(false);
  if (androidMobile) return <>
    <div role="toolbar" aria-label="Bulk actions toolbar" className="w-[calc(100vw-2rem)] rounded-2xl border border-border-primary bg-bg-primary p-2 shadow-xl pointer-events-auto">
      <div className="flex items-center justify-between px-2">
        <strong role="status" className="text-base">{selectedCount} selected</strong>
        <button onClick={onSelectAll} className="px-2 text-sm text-accent" disabled={selectedCount === totalCount}>Select all</button>
        <button onClick={onClear} title="Clear selection" aria-label="Clear selection" className="px-2 text-sm text-text-secondary">Cancel</button>
      </div>
      <div className="grid grid-cols-3 gap-1 border-t border-border-primary pt-1">
        {[
          {label:"Archive",title:"Archive selected",icon:Archive,action:onArchive},
          {label:"Trash",title:"Delete selected",icon:Trash2,action:onDelete},
          {label:"More",title:"More selection actions",icon:MoreHorizontal,action:()=>setShowMore(true)},
        ].map(({label,title,icon:Icon,action})=><button key={title} title={title} aria-label={title} onClick={action} className="flex min-h-14 items-center justify-center gap-2 rounded-xl text-sm font-medium text-text-primary active:bg-accent/10"><Icon size={20}/>{label}</button>)}
      </div>
    </div>
    <Modal isOpen={showMore} onClose={()=>setShowMore(false)} title={`Actions for ${selectedCount} conversations`} width="w-full max-w-md">
      <div className="p-3 space-y-1">
        {[
          {label:allRead ? "Mark unread" : "Mark read",action:()=>onMarkRead(!allRead)},
          {label:allStarred ? "Remove stars" : "Star conversations",action:()=>onStar(!allStarred)},
          {label:"Move to folder",action:onMoveToFolder},
          {label:isSpamView ? "Not spam" : "Report spam",action:onSpam},
        ].map(({label,action})=><button key={label} onClick={()=>{setShowMore(false);action();}} className="block w-full rounded-xl px-4 py-3 text-left text-base active:bg-accent/10">{label}</button>)}
      </div>
    </Modal>
  </>;
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions toolbar"
      className="flex items-center gap-1 sm:gap-1.5 p-1.5 pl-2 sm:pl-2.5 rounded-full bg-bg-primary/90 dark:bg-bg-secondary/95 backdrop-blur-xl border border-border-primary/80 shadow-2xl shadow-black/20 dark:shadow-black/50 ring-1 ring-white/10 dark:ring-white/5 max-w-[calc(100vw-1rem)] select-none pointer-events-auto"
    >
      {/* Selected count pill badge */}
      <div className="flex items-center gap-1 sm:gap-1.5 pr-0.5 sm:pr-1 shrink-0">
        <span className="flex items-center gap-1 px-2 sm:px-2.5 py-0.5 rounded-full bg-accent text-white font-medium text-xs shadow-xs whitespace-nowrap shrink-0">
          <CheckSquare size={12} className="stroke-[2.5] shrink-0" />
          <span>{selectedCount} selected</span>
        </span>

        {selectedCount < totalCount && (
          <button
            onClick={onSelectAll}
            className="text-[11px] font-medium text-accent hover:text-accent-hover transition-colors px-1 py-0.5 rounded hover:underline cursor-pointer whitespace-nowrap shrink-0"
            title={`Select all ${totalCount} conversations`}
          >
            Select all
          </button>
        )}
      </div>

      <div className="w-px h-4 bg-border-primary/70 shrink-0 mx-0.5" />

      {/* Action icons */}
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-none min-w-0">
        <button
          onClick={onArchive}
          title="Archive selected"
          aria-label="Archive selected"
          className="shrink-0 min-w-[42px] min-h-[42px] sm:min-w-[36px] sm:min-h-[36px] flex items-center justify-center p-2 text-text-secondary hover:text-text-primary hover:bg-bg-hover active:scale-90 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer touch-manipulation"
        >
          <Archive size={16} />
        </button>

        <button
          onClick={onDelete}
          title="Delete selected"
          aria-label="Delete selected"
          className="shrink-0 min-w-[42px] min-h-[42px] sm:min-w-[40px] sm:min-h-[40px] flex items-center justify-center p-2 text-text-secondary hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 active:bg-red-500/25 active:text-red-600 dark:active:text-red-400 active:scale-90 active:ring-2 active:ring-red-500/30 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 cursor-pointer touch-manipulation"
        >
          <Trash2 size={16} />
        </button>

        <button
          onClick={() => onMarkRead(!allRead)}
          title={allRead ? "Mark as unread" : "Mark as read"}
          aria-label={allRead ? "Mark as unread" : "Mark as read"}
          className="shrink-0 min-w-[42px] min-h-[42px] sm:min-w-[36px] sm:min-h-[36px] flex items-center justify-center p-2 text-text-secondary hover:text-text-primary hover:bg-bg-hover active:scale-90 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer touch-manipulation"
        >
          {allRead ? <Mail size={16} /> : <MailOpen size={16} />}
        </button>

        <button
          onClick={() => onStar(!allStarred)}
          title={allStarred ? "Unstar selected" : "Star selected"}
          aria-label={allStarred ? "Unstar selected" : "Star selected"}
          className={`shrink-0 min-w-[42px] min-h-[42px] sm:min-w-[36px] sm:min-h-[36px] flex items-center justify-center p-2 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer touch-manipulation ${
            allStarred
              ? "text-amber-500 dark:text-amber-400 bg-amber-500/15 hover:bg-amber-500/25 ring-1 ring-amber-500/30 active:scale-90"
              : "text-text-secondary hover:text-amber-500 hover:bg-amber-500/10 active:scale-90"
          }`}
        >
          <Star
            size={16}
            className={
              allStarred
                ? "fill-amber-400 text-amber-500 dark:text-amber-400 star-animate drop-shadow-[0_0_6px_rgba(245,158,11,0.5)]"
                : "transition-transform hover:scale-110"
            }
          />
        </button>

        <button
          onClick={onMoveToFolder}
          title="Move to folder"
          aria-label="Move to folder"
          className="shrink-0 min-w-[42px] min-h-[42px] sm:min-w-[36px] sm:min-h-[36px] flex items-center justify-center p-2 text-text-secondary hover:text-text-primary hover:bg-bg-hover active:scale-90 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer touch-manipulation"
        >
          <FolderInput size={16} />
        </button>

        <button
          onClick={onSpam}
          title={isSpamView ? "Not spam" : "Report spam"}
          aria-label={isSpamView ? "Not spam" : "Report spam"}
          className="shrink-0 min-w-[42px] min-h-[42px] sm:min-w-[36px] sm:min-h-[36px] flex items-center justify-center p-2 text-text-secondary hover:text-text-primary hover:bg-bg-hover active:scale-90 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer touch-manipulation"
        >
          <Ban size={16} />
        </button>
      </div>

      <div className="w-px h-4 bg-border-primary/70 shrink-0 mx-0.5" />

      {/* Deselect All / Cancel */}
      <button
        onClick={onClear}
        title="Clear selection"
        aria-label="Clear selection"
        className="shrink-0 min-w-[36px] min-h-[36px] flex items-center justify-center p-1.5 text-text-tertiary hover:text-text-primary hover:bg-bg-hover active:scale-95 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
      >
        <X size={15} />
      </button>
    </div>
  );
});
