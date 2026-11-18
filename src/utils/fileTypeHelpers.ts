export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isImage(mimeType: string | null): boolean {
  return mimeType?.startsWith("image/") ?? false;
}

export function isPdf(mimeType: string | null, filename?: string | null): boolean {
  if (mimeType === "application/pdf") return true;
  // Gmail sometimes returns application/octet-stream for PDFs
  return filename?.toLowerCase().endsWith(".pdf") ?? false;
}

export function isText(mimeType: string | null): boolean {
  if (!mimeType) return false;
  return mimeType.startsWith("text/") || mimeType === "application/json" || mimeType === "application/xml";
}

export function canPreview(mimeType: string | null, filename: string | null): boolean {
  return isImage(mimeType) || isPdf(mimeType, filename) || isText(mimeType);
}

export function isDocument(mimeType: string | null, filename?: string | null): boolean {
  if (mimeType) {
    if (mimeType.includes("msword") || mimeType.includes("wordprocessingml") || mimeType.includes("opendocument.text") || mimeType === "application/rtf") return true;
  }
  const ext = filename?.toLowerCase();
  return ext?.endsWith(".doc") || ext?.endsWith(".docx") || ext?.endsWith(".odt") || ext?.endsWith(".rtf") || false;
}

export function isSpreadsheet(mimeType: string | null, filename?: string | null): boolean {
  if (mimeType) {
    if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType === "text/csv") return true;
  }
  const ext = filename?.toLowerCase();
  return ext?.endsWith(".xls") || ext?.endsWith(".xlsx") || ext?.endsWith(".ods") || ext?.endsWith(".csv") || false;
}

export function isArchive(mimeType: string | null): boolean {
  if (!mimeType) return false;
  return mimeType.includes("zip") || mimeType.includes("compressed") || mimeType.includes("archive") || mimeType.includes("tar") || mimeType === "application/gzip" || mimeType === "application/x-gzip";
}

export function isCode(mimeType: string | null, filename?: string | null): boolean {
  if (mimeType) {
    if (
      mimeType === "application/json" ||
      mimeType === "application/xml" ||
      mimeType === "application/javascript" ||
      mimeType === "text/javascript" ||
      mimeType === "text/html" ||
      mimeType === "text/css"
    ) return true;
  }
  const ext = filename?.toLowerCase();
  return ext?.endsWith(".json") || ext?.endsWith(".js") || ext?.endsWith(".ts") || ext?.endsWith(".tsx") || ext?.endsWith(".jsx") || ext?.endsWith(".html") || ext?.endsWith(".css") || ext?.endsWith(".py") || ext?.endsWith(".rs") || ext?.endsWith(".go") || ext?.endsWith(".sh") || false;
}

export function isMedia(mimeType: string | null, filename?: string | null): boolean {
  if (mimeType?.startsWith("audio/") || mimeType?.startsWith("video/")) return true;
  const ext = filename?.toLowerCase();
  return ext?.endsWith(".mp3") || ext?.endsWith(".wav") || ext?.endsWith(".m4a") || ext?.endsWith(".mp4") || ext?.endsWith(".mov") || ext?.endsWith(".mkv") || ext?.endsWith(".webm") || false;
}

export function getFileExtension(filename?: string | null): string {
  if (!filename) return "";
  const parts = filename.split(".");
  if (parts.length > 1) {
    const ext = parts.pop()?.trim().toUpperCase() ?? "";
    if (ext.length <= 5) return ext;
  }
  return "";
}

export interface FileTypeMeta {
  kind: "pdf" | "spreadsheet" | "document" | "image" | "archive" | "code" | "media" | "other";
  extension: string;
  label: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  iconBg: string;
  iconText: string;
  iconBorder: string;
  cardBorderHover: string;
  cardBgHover: string;
}

export function getFileTypeMeta(mimeType: string | null, filename?: string | null): FileTypeMeta {
  const ext = getFileExtension(filename);

  if (isPdf(mimeType, filename)) {
    return {
      kind: "pdf",
      extension: ext || "PDF",
      label: "PDF Document",
      badgeBg: "bg-rose-500/10",
      badgeText: "text-rose-600 dark:text-rose-400",
      badgeBorder: "border-rose-500/20",
      iconBg: "bg-rose-50 dark:bg-rose-950/40",
      iconText: "text-rose-600 dark:text-rose-400",
      iconBorder: "border-rose-200 dark:border-rose-900/50",
      cardBorderHover: "hover:border-rose-300 dark:hover:border-rose-800",
      cardBgHover: "hover:bg-rose-500/5",
    };
  }

  if (isSpreadsheet(mimeType, filename)) {
    return {
      kind: "spreadsheet",
      extension: ext || "XLS",
      label: "Spreadsheet",
      badgeBg: "bg-emerald-500/10",
      badgeText: "text-emerald-600 dark:text-emerald-400",
      badgeBorder: "border-emerald-500/20",
      iconBg: "bg-emerald-50 dark:bg-emerald-950/40",
      iconText: "text-emerald-600 dark:text-emerald-400",
      iconBorder: "border-emerald-200 dark:border-emerald-900/50",
      cardBorderHover: "hover:border-emerald-300 dark:hover:border-emerald-800",
      cardBgHover: "hover:bg-emerald-500/5",
    };
  }

  if (isDocument(mimeType, filename)) {
    return {
      kind: "document",
      extension: ext || "DOC",
      label: "Document",
      badgeBg: "bg-blue-500/10",
      badgeText: "text-blue-600 dark:text-blue-400",
      badgeBorder: "border-blue-500/20",
      iconBg: "bg-blue-50 dark:bg-blue-950/40",
      iconText: "text-blue-600 dark:text-blue-400",
      iconBorder: "border-blue-200 dark:border-blue-900/50",
      cardBorderHover: "hover:border-blue-300 dark:hover:border-blue-800",
      cardBgHover: "hover:bg-blue-500/5",
    };
  }

  if (isImage(mimeType)) {
    return {
      kind: "image",
      extension: ext || "IMG",
      label: "Image",
      badgeBg: "bg-amber-500/10",
      badgeText: "text-amber-600 dark:text-amber-400",
      badgeBorder: "border-amber-500/20",
      iconBg: "bg-amber-50 dark:bg-amber-950/40",
      iconText: "text-amber-600 dark:text-amber-400",
      iconBorder: "border-amber-200 dark:border-amber-900/50",
      cardBorderHover: "hover:border-amber-300 dark:hover:border-amber-800",
      cardBgHover: "hover:bg-amber-500/5",
    };
  }

  if (isArchive(mimeType)) {
    return {
      kind: "archive",
      extension: ext || "ZIP",
      label: "Archive",
      badgeBg: "bg-purple-500/10",
      badgeText: "text-purple-600 dark:text-purple-400",
      badgeBorder: "border-purple-500/20",
      iconBg: "bg-purple-50 dark:bg-purple-950/40",
      iconText: "text-purple-600 dark:text-purple-400",
      iconBorder: "border-purple-200 dark:border-purple-900/50",
      cardBorderHover: "hover:border-purple-300 dark:hover:border-purple-800",
      cardBgHover: "hover:bg-purple-500/5",
    };
  }

  if (isCode(mimeType, filename)) {
    return {
      kind: "code",
      extension: ext || "CODE",
      label: "Code",
      badgeBg: "bg-indigo-500/10",
      badgeText: "text-indigo-600 dark:text-indigo-400",
      badgeBorder: "border-indigo-500/20",
      iconBg: "bg-indigo-50 dark:bg-indigo-950/40",
      iconText: "text-indigo-600 dark:text-indigo-400",
      iconBorder: "border-indigo-200 dark:border-indigo-900/50",
      cardBorderHover: "hover:border-indigo-300 dark:hover:border-indigo-800",
      cardBgHover: "hover:bg-indigo-500/5",
    };
  }

  if (isMedia(mimeType, filename)) {
    return {
      kind: "media",
      extension: ext || "MEDIA",
      label: "Media",
      badgeBg: "bg-pink-500/10",
      badgeText: "text-pink-600 dark:text-pink-400",
      badgeBorder: "border-pink-500/20",
      iconBg: "bg-pink-50 dark:bg-pink-950/40",
      iconText: "text-pink-600 dark:text-pink-400",
      iconBorder: "border-pink-200 dark:border-pink-900/50",
      cardBorderHover: "hover:border-pink-300 dark:hover:border-pink-800",
      cardBgHover: "hover:bg-pink-500/5",
    };
  }

  return {
    kind: "other",
    extension: ext || "FILE",
    label: "File",
    badgeBg: "bg-slate-500/10",
    badgeText: "text-slate-600 dark:text-slate-400",
    badgeBorder: "border-slate-500/20",
    iconBg: "bg-slate-100 dark:bg-slate-800",
    iconText: "text-slate-600 dark:text-slate-400",
    iconBorder: "border-slate-200 dark:border-slate-700",
    cardBorderHover: "hover:border-slate-300 dark:hover:border-slate-600",
    cardBgHover: "hover:bg-slate-500/5",
  };
}

export function getFileIcon(mimeType: string | null): string {
  if (!mimeType) return "\u{1F4CE}";
  if (mimeType.startsWith("image/")) return "\u{1F5BC}";
  if (mimeType.startsWith("video/")) return "\u{1F3AC}";
  if (mimeType.startsWith("audio/")) return "\u{1F3B5}";
  if (mimeType === "application/pdf") return "\u{1F4C4}";
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return "\u{1F4CA}";
  if (mimeType.includes("zip") || mimeType.includes("compressed") || mimeType.includes("archive")) return "\u{1F4E6}";
  return "\u{1F4CE}";
}
