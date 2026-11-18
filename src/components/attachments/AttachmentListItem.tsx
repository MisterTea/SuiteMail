import { Download, Eye, ExternalLink } from "lucide-react";
import { formatFileSize, canPreview, getFileTypeMeta } from "@/utils/fileTypeHelpers";
import { FileTypeIcon } from "./FileTypeIcon";
import type { AttachmentWithContext } from "@/services/db/attachments";

interface AttachmentListItemProps {
  attachment: AttachmentWithContext;
  onPreview: () => void;
  onDownload: () => void;
  onJumpToEmail: () => void;
}

function formatShortDate(timestamp: number | null): string {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function AttachmentListItem({ attachment, onPreview, onDownload, onJumpToEmail }: AttachmentListItemProps) {
  const previewable = canPreview(attachment.mime_type, attachment.filename);
  const senderName = attachment.from_name || attachment.from_address || "Unknown";
  const meta = getFileTypeMeta(attachment.mime_type, attachment.filename);

  return (
    <div
      onClick={previewable ? onPreview : onDownload}
      className="group flex items-center gap-3 px-3.5 py-3 min-h-[52px] sm:min-h-0 hover:bg-bg-hover/80 rounded-xl sm:rounded-lg border border-transparent hover:border-border-secondary/60 active:scale-[0.99] transition-all cursor-pointer select-none touch-manipulation"
    >
      {/* File type icon */}
      <FileTypeIcon mimeType={attachment.mime_type} filename={attachment.filename} size={16} />

      {/* Filename & Type badge */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span
          className="text-sm font-medium text-text-primary truncate"
          title={attachment.filename ?? undefined}
        >
          {attachment.filename ?? "Unnamed"}
        </span>
        <span
          className={`shrink-0 inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold uppercase tracking-wider ${meta.badgeBg} ${meta.badgeText}`}
        >
          {meta.extension}
        </span>
      </div>

      {/* Sender */}
      <span className="text-xs text-text-tertiary truncate w-36 shrink-0 hidden md:block" title={senderName}>
        {senderName}
      </span>

      {/* Date */}
      <span className="text-xs text-text-tertiary w-24 shrink-0 text-right hidden md:block">
        {formatShortDate(attachment.date)}
      </span>

      {/* Size badge */}
      <span className="text-xs font-mono text-text-secondary w-20 shrink-0 text-right">
        {attachment.size != null ? (
          <span className="bg-bg-tertiary/70 px-1.5 py-0.5 rounded text-[11px] text-text-tertiary">
            {formatFileSize(attachment.size)}
          </span>
        ) : ""}
      </span>

      {/* Actions */}
      <div
        className="flex items-center gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        {previewable && (
          <button
            type="button"
            onClick={onPreview}
            className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
            title="Preview"
            aria-label={`Preview ${attachment.filename ?? "attachment"}`}
          >
            <Eye size={14} />
          </button>
        )}
        <button
          type="button"
          onClick={onDownload}
          className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          title="Download"
          aria-label={`Download ${attachment.filename ?? "attachment"}`}
        >
          <Download size={14} />
        </button>
        <button
          type="button"
          onClick={onJumpToEmail}
          className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          title="Jump to email"
          aria-label="Jump to email"
        >
          <ExternalLink size={14} />
        </button>
      </div>
    </div>
  );
}
