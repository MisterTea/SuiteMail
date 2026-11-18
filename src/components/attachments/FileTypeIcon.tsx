import {
  FileText,
  FileSpreadsheet,
  FileImage,
  FileArchive,
  FileCode,
  FileVideo,
  File,
} from "lucide-react";
import { getFileTypeMeta, type FileTypeMeta } from "@/utils/fileTypeHelpers";

interface FileTypeIconProps {
  mimeType: string | null;
  filename?: string | null;
  size?: number;
  className?: string;
  variant?: "badge" | "plain";
}

export function getLucideFileIcon(kind: FileTypeMeta["kind"], size = 16, className?: string) {
  switch (kind) {
    case "pdf":
      return <FileText size={size} className={className} />;
    case "spreadsheet":
      return <FileSpreadsheet size={size} className={className} />;
    case "document":
      return <FileText size={size} className={className} />;
    case "image":
      return <FileImage size={size} className={className} />;
    case "archive":
      return <FileArchive size={size} className={className} />;
    case "code":
      return <FileCode size={size} className={className} />;
    case "media":
      return <FileVideo size={size} className={className} />;
    default:
      return <File size={size} className={className} />;
  }
}

export function FileTypeIcon({
  mimeType,
  filename,
  size = 16,
  className = "",
  variant = "badge",
}: FileTypeIconProps) {
  const meta = getFileTypeMeta(mimeType, filename);

  if (variant === "plain") {
    return (
      <span className={`inline-flex items-center justify-center shrink-0 ${meta.iconText} ${className}`}>
        {getLucideFileIcon(meta.kind, size)}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 rounded-md border ${meta.iconBg} ${meta.iconBorder} ${meta.iconText} ${className}`}
      style={{ width: `${size + 12}px`, height: `${size + 12}px` }}
      title={meta.label}
    >
      {getLucideFileIcon(meta.kind, size)}
    </span>
  );
}

/**
 * Visual document preview canvas for grid items
 */
interface FilePreviewCanvasProps {
  mimeType: string | null;
  filename?: string | null;
  thumbnailUrl?: string | null;
  className?: string;
}

export function FilePreviewCanvas({
  mimeType,
  filename,
  thumbnailUrl,
  className = "",
}: FilePreviewCanvasProps) {
  const meta = getFileTypeMeta(mimeType, filename);

  if (thumbnailUrl && meta.kind === "image") {
    return (
      <div className={`relative w-full h-full flex items-center justify-center bg-bg-tertiary overflow-hidden ${className}`}>
        <img
          src={thumbnailUrl}
          alt={filename ?? "Image attachment"}
          className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
        />
        <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-black/60 text-white backdrop-blur-xs">
          {meta.extension}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative w-full h-full flex items-center justify-center overflow-hidden transition-colors select-none ${meta.iconBg} ${className}`}
    >
      {/* Subtle decorative background pattern */}
      <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_top_right,currentColor_0%,transparent_70%)] pointer-events-none" />

      {/* Floating file type tag in top left */}
      <div className="absolute top-2 left-2 z-1">
        <span
          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase border shadow-2xs backdrop-blur-xs ${meta.badgeBg} ${meta.badgeText} ${meta.badgeBorder}`}
        >
          {meta.extension}
        </span>
      </div>

      {/* Central stylized document sheet card */}
      <div className="relative z-1 flex flex-col items-center justify-center w-16 h-20 rounded-md bg-bg-primary/90 dark:bg-bg-tertiary/90 border border-border-secondary shadow-sm transition-transform duration-200 group-hover:scale-105 group-hover:shadow-md">
        {/* Top-right folded corner accent */}
        <div className="absolute -top-[1px] -right-[1px] w-3 h-3 bg-bg-secondary rounded-bl-sm border-b border-l border-border-secondary" />

        {/* File icon */}
        <div className={`mb-1.5 ${meta.iconText}`}>
          {getLucideFileIcon(meta.kind, 24)}
        </div>

        {/* Mini extension pill inside card */}
        <span
          className={`px-1 py-0.2 rounded text-[9px] font-mono font-bold tracking-wider uppercase ${meta.badgeBg} ${meta.badgeText}`}
        >
          {meta.extension}
        </span>
      </div>
    </div>
  );
}
