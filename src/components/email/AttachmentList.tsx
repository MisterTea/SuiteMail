import { useAndroidMobile } from "@/hooks/useAndroidMobile";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { platformSaveFile } from "@/platform";
import { getAttachmentsForMessage, type DbAttachment } from "@/services/db/attachments";
import { getEmailProvider } from "@/services/email/providerFactory";
import { Modal } from "@/components/ui/Modal";
import { Download, Eye, Paperclip } from "lucide-react";
import { formatFileSize, isImage, isPdf, isText, canPreview, getFileTypeMeta } from "@/utils/fileTypeHelpers";
import { FileTypeIcon } from "@/components/attachments/FileTypeIcon";

/** Dedup attachments by filename+size (content-based) */
function dedup(attachments: DbAttachment[]): DbAttachment[] {
  const seen = new Set<string>();
  return attachments.filter((a) => {
    const key = `${a.filename}:${a.size}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface AttachmentListProps {
  accountId: string;
  messageId: string;
  attachments: DbAttachment[];
  referencedCids?: Set<string>;
}

export function AttachmentList({ accountId, messageId, attachments, referencedCids }: AttachmentListProps) {
  const android = useAndroidMobile();
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DbAttachment | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Filter out CID images rendered in the email body and true inline parts, then dedup
  const fileAttachments = dedup(attachments.filter((a) => {
    // Skip attachments whose CID is referenced in the email body (already rendered inline)
    if (a.content_id && referencedCids?.has(a.content_id)) return false;
    // True inline: marked inline with no filename
    if (a.is_inline && !a.filename) return false;
    return true;
  }));

  const totalSize = useMemo(() => {
    return fileAttachments.reduce((sum, a) => sum + (a.size ?? 0), 0);
  }, [fileAttachments]);

  const handleDownloadAttachment = useCallback(async (att: DbAttachment, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!att.gmail_attachment_id || downloadingId === att.id) return;
    setDownloadingId(att.id);
    setDownloadError(null);
    try {
      const provider = await getEmailProvider(accountId);
      const response = await provider.fetchAttachment(messageId, att.gmail_attachment_id);
      const base64 = response.data.replace(/-/g, "+").replace(/_/g, "/");
      const binaryStr = atob(base64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      await platformSaveFile(att.filename ?? "attachment", bytes);
    } catch (err) {
      console.error("Failed to save attachment:", err);
      setDownloadError("Couldn’t download the attachment. Try Download again.");
    } finally {
      setDownloadingId(null);
    }
  }, [accountId, messageId, downloadingId]);

  const handleDownloadAll = useCallback(async () => {
    for (const att of fileAttachments) {
      if (att.gmail_attachment_id) {
        await handleDownloadAttachment(att);
      }
    }
  }, [fileAttachments, handleDownloadAttachment]);

  if (fileAttachments.length === 0) return null;

  return (
    <>
      <div className="mt-3 pt-3 border-t border-border-secondary">
        {downloadError && <p role="alert" className="text-sm text-danger">{downloadError}</p>}
        {/* Header bar */}
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
            <Paperclip size={13} className="text-text-tertiary" />
            <span className="font-medium text-text-secondary">
              {fileAttachments.length} attachment{fileAttachments.length !== 1 ? "s" : ""}
            </span>
            {totalSize > 0 && (
              <span className="text-[11px] text-text-tertiary">
                ({formatFileSize(totalSize)})
              </span>
            )}
          </div>

          {fileAttachments.length > 1 && (
            <button
              style={android ? { minHeight: 48, minWidth: 48 } : undefined}
              onClick={handleDownloadAll}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-text-tertiary hover:text-accent transition-colors py-0.5 px-1.5 rounded hover:bg-bg-hover"
              title="Download all attachments"
            >
              <Download size={12} />
              <span>Download all</span>
            </button>
          )}
        </div>

        {/* Attachment chips */}
        <div className="flex flex-wrap gap-2.5">
          {fileAttachments.map((att) => {
            const isPreviewable = canPreview(att.mime_type, att.filename);
            const meta = getFileTypeMeta(att.mime_type, att.filename);

            return (
              <div
                key={att.id}
                style={android ? { flexWrap: "wrap" } : undefined}
                onClick={() => setPreview(att)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setPreview(att);
                  }
                }}
                className={`group relative flex items-center gap-2.5 pl-2.5 pr-2 py-2 min-h-[48px] sm:min-h-0 rounded-xl sm:rounded-lg border border-border-primary/80 bg-bg-secondary/40 hover:bg-bg-secondary hover:border-border-secondary hover:shadow-xs transition-all duration-150 w-full sm:w-auto max-w-full sm:max-w-[260px] cursor-pointer text-left select-none touch-manipulation active:scale-[0.99] ${meta.cardBorderHover}`}
              >
                {/* File Icon with subtle pastel accent */}
                <FileTypeIcon mimeType={att.mime_type} filename={att.filename} size={16} />

                {/* File details */}
                <div className="flex flex-col min-w-0 flex-1">
                  <span
                    className={android ? "text-base font-medium text-text-primary break-all" : "text-xs font-medium text-text-primary truncate"}
                    title={att.filename ?? undefined}
                  >
                    {att.filename ?? "Unnamed"}
                  </span>
                  <div className="flex items-center gap-1.5 text-[10px] text-text-tertiary">
                    {att.size != null && (
                      <span className="font-mono">{formatFileSize(att.size)}</span>
                    )}
                    <span className="text-border-primary">•</span>
                    <span className={`uppercase font-semibold tracking-wider text-[9px] ${meta.badgeText}`}>
                      {meta.extension}
                    </span>
                  </div>
                </div>

                {/* Touch/hover action buttons */}
                <div className={android ? "flex flex-wrap gap-2 w-full" : "flex items-center gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity"}>
                  {isPreviewable && (
                    <button
              style={android ? { minHeight: 48, minWidth: 48 } : undefined}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPreview(att);
                      }}
                      className="min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 p-2 sm:p-1 rounded-lg sm:rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary active:scale-90 transition-all flex items-center justify-center touch-manipulation"
                      title="Preview"
                      aria-label={`Preview ${att.filename ?? "file"}`}
                    >
                      <Eye size={14} />{android && <span>Open</span>}
                    </button>
                  )}
                  <button
              style={android ? { minHeight: 48, minWidth: 48 } : undefined}
                    type="button"
                    onClick={(e) => handleDownloadAttachment(att, e)}
                    disabled={downloadingId === att.id}
                    className="min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 p-2 sm:p-1 rounded-lg sm:rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary active:scale-90 transition-all flex items-center justify-center touch-manipulation disabled:opacity-50"
                    title="Download"
                    aria-label={`Download ${att.filename ?? "file"}`}
                  >
                    <Download size={14} />{android && <span>{downloadingId === att.id ? "Downloading…" : "Download"}</span>}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {preview && (
        <AttachmentPreview
          attachment={preview}
          accountId={accountId}
          messageId={messageId}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}

export function AttachmentPreview({
  attachment,
  accountId,
  messageId,
  onClose,
}: {
  attachment: DbAttachment;
  accountId: string;
  messageId: string;
  onClose: () => void;
}) {
  const android = useAndroidMobile();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bytesRef = useRef<Uint8Array | null>(null);

  const isPreviewable = canPreview(attachment.mime_type, attachment.filename);

  const fetchData = useCallback(async (): Promise<Uint8Array> => {
    if (bytesRef.current) return bytesRef.current;

    const provider = await getEmailProvider(accountId);
    const response = await provider.fetchAttachment(messageId, attachment.gmail_attachment_id!);

    // Normalize URL-safe base64 (Gmail API) to standard base64
    const base64 = response.data.replace(/-/g, "+").replace(/_/g, "/");
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    bytesRef.current = bytes;
    return bytes;
  }, [accountId, messageId, attachment.gmail_attachment_id]);

  const handlePreviewLoad = useCallback(async () => {
    if (!attachment.gmail_attachment_id || !isPreviewable || blobUrl) return;

    setLoading(true);
    try {
      const bytes = await fetchData();
      const effectiveMime = isPdf(attachment.mime_type, attachment.filename)
        ? "application/pdf"
        : (attachment.mime_type ?? "application/octet-stream");
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: effectiveMime });
      setBlobUrl(URL.createObjectURL(blob));
    } catch (err) {
      console.error("Failed to load preview:", err);
      setError("Failed to load preview");
    } finally {
      setLoading(false);
    }
  }, [attachment, isPreviewable, blobUrl, fetchData]);

  // Trigger preview load for previewable types
  useEffect(() => {
    if (isPreviewable && !blobUrl && !loading && !error) {
      handlePreviewLoad();
    }
  }, [isPreviewable, blobUrl, loading, error, handlePreviewLoad]);

  const handleDownload = async () => {
    if (!attachment.gmail_attachment_id || saving) return;

    setSaving(true);
    try {
      const bytes = await fetchData();
      await platformSaveFile(attachment.filename ?? "attachment", bytes);
    } catch (err) {
      console.error("Failed to save attachment:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    onClose();
  };

  const meta = getFileTypeMeta(attachment.mime_type, attachment.filename);

  const header = (
    <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between shrink-0 bg-bg-secondary/40">
      <div className="flex items-center gap-3 min-w-0">
        <FileTypeIcon mimeType={attachment.mime_type} filename={attachment.filename} size={18} />
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-semibold text-text-primary truncate">
            {attachment.filename ?? "Unnamed"}
          </span>
          <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
            {attachment.size != null && (
              <span className="font-mono">{formatFileSize(attachment.size)}</span>
            )}
            <span className="text-border-primary">•</span>
            <span className={`uppercase font-semibold tracking-wider text-[10px] ${meta.badgeText}`}>
              {meta.extension}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-4">
        <button
              style={android ? { minHeight: 48, minWidth: 48 } : undefined}
          onClick={handleDownload}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors disabled:opacity-50 shadow-2xs"
        >
          <Download size={13} />
          {saving ? "Saving..." : "Download"}
        </button>
        <button
              style={android ? { minHeight: 48, minWidth: 48 } : undefined}
          onClick={handleClose}
          className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors text-lg leading-none"
          title="Close"
        >
          ×
        </button>
      </div>
    </div>
  );

  return (
    <Modal
      isOpen={true}
      onClose={handleClose}
      title={attachment.filename ?? "Attachment"}
      width="w-[800px]"
      panelClassName="max-w-[90vw] max-h-[85vh] flex flex-col"
      renderHeader={header}
    >
      {/* Allow native right-click in preview (save image, copy, etc.) */}
      <div className="flex-1 overflow-auto min-h-[200px] flex items-center justify-center p-4" data-native-context-menu>
        {loading && (
          <p className="text-sm text-text-tertiary">Loading preview...</p>
        )}
        {error && (
          <p className="text-sm text-text-tertiary">{error}</p>
        )}
        {!loading && !error && blobUrl && isImage(attachment.mime_type) && (
          <img
            src={blobUrl}
            alt={attachment.filename ?? "Attachment"}
            className="max-w-full max-h-[70vh] object-contain rounded"
          />
        )}
        {!loading && !error && blobUrl && isPdf(attachment.mime_type, attachment.filename) && (
          <iframe
            src={blobUrl}
            title={attachment.filename ?? "PDF preview"}
            className="w-full h-[70vh] border-0 rounded"
          />
        )}
        {!loading && !error && blobUrl && isText(attachment.mime_type) && (
          <TextPreview url={blobUrl} />
        )}
        {!isPreviewable && !loading && (
          <div className="flex flex-col items-center gap-3 text-text-tertiary">
            <Eye size={40} strokeWidth={1} />
            <p className="text-sm">Preview not available for this file type</p>
            <p className="text-xs">{attachment.mime_type ?? "Unknown type"}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

function TextPreview({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    fetch(url).then((r) => r.text()).then(setText).catch(() => setText("Failed to load text"));
  }, [url]);

  return (
    <pre className="text-xs text-text-secondary whitespace-pre-wrap font-mono w-full max-h-[70vh] overflow-auto bg-bg-tertiary rounded p-4">
      {text ?? "Loading..."}
    </pre>
  );
}

export { getAttachmentsForMessage };
