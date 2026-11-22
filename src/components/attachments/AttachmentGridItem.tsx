import { Download, Eye, ExternalLink } from "lucide-react";
import { formatFileSize, canPreview, getFileTypeMeta } from "@/utils/fileTypeHelpers";
import { FilePreviewCanvas } from "./FileTypeIcon";
import type { AttachmentWithContext } from "@/services/db/attachments";

interface AttachmentGridItemProps {
  attachment: AttachmentWithContext;
  onPreview: () => void;
  onDownload: () => void;
  onJumpToEmail: () => void;
}

function formatRelativeDate(timestamp: number | null): string {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function AttachmentGridItem({ attachment, onPreview, onDownload, onJumpToEmail }: AttachmentGridItemProps) {
  const previewable = canPreview(attachment.mime_type, attachment.filename);
  const senderName = attachment.from_name || attachment.from_address || "Unknown";
  const meta = getFileTypeMeta(attachment.mime_type, attachment.filename);

  return (
    <div
      onClick={previewable ? onPreview : onDownload}
      className={`group relative flex flex-col border border-border-primary/80 rounded-xl bg-bg-primary hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden cursor-pointer select-none ${meta.cardBorderHover}`}
    >
      {/* Visual Canvas Area */}
      <div className="relative h-28 w-full">
        <FilePreviewCanvas
          mimeType={attachment.mime_type}
          filename={attachment.filename}
          className="h-28"
        />

        {/* Floating action buttons on hover */}
        <div
          className="absolute top-2 right-2 flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-all duration-150 backdrop-blur-md bg-bg-primary/90 border border-border-primary/80 shadow-sm rounded-lg p-0.5 z-10"
          onClick={(e) => e.stopPropagation()}
        >
          {previewable && (
            <button
              type="button"
              onClick={onPreview}
              className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
              title="Preview"
              aria-label={`Preview ${attachment.filename ?? "attachment"}`}
            >
              <Eye size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={onDownload}
            className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
            title="Download"
            aria-label={`Download ${attachment.filename ?? "attachment"}`}
          >
            <Download size={13} />
          </button>
          <button
            type="button"
            onClick={onJumpToEmail}
            className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
            title="Jump to email"
            aria-label="Jump to email"
          >
            <ExternalLink size={13} />
          </button>
        </div>
      </div>

      {/* Info Area */}
      <div className="p-3 flex flex-col gap-1 min-w-0 bg-bg-primary">
        <span
          className="text-xs font-semibold text-text-primary truncate"
          title={attachment.filename ?? undefined}
        >
          {attachment.filename ?? "Unnamed"}
        </span>

        {attachment.content_match && <p className="text-xs text-text-secondary line-clamp-3">{attachment.content_match}</p>}
        <span className="text-[11px] text-text-tertiary truncate" title={senderName}>
          {senderName}
        </span>

        <div className="flex items-center justify-between gap-1 mt-1 text-[10px] text-text-tertiary">
          {attachment.size != null && (
            <span className="font-mono bg-bg-tertiary/70 px-1.5 py-0.5 rounded text-text-secondary">
              {formatFileSize(attachment.size)}
            </span>
          )}
          {attachment.date && (
            <span className="text-text-tertiary whitespace-nowrap">
              {formatRelativeDate(attachment.date)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
