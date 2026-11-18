import { useRef } from "react";
import { Paperclip, X } from "lucide-react";
import { useComposerStore, type ComposerAttachment } from "@/stores/composerStore";
import { readFileAsBase64 } from "@/utils/fileUtils";
import { formatFileSize, getFileTypeMeta } from "@/utils/fileTypeHelpers";
import { FileTypeIcon } from "@/components/attachments/FileTypeIcon";

const MAX_TOTAL_SIZE = 24 * 1024 * 1024; // 24MB

export function AttachmentPicker() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const attachments = useComposerStore((s) => s.attachments);
  const addAttachment = useComposerStore((s) => s.addAttachment);
  const removeAttachment = useComposerStore((s) => s.removeAttachment);

  const totalSize = attachments.reduce((sum, a) => sum + a.size, 0);

  const handleFiles = async (files: FileList) => {
    for (const file of Array.from(files)) {
      if (totalSize + file.size > MAX_TOTAL_SIZE) {
        console.warn("Attachment size limit exceeded (24MB)");
        break;
      }
      const content = await readFileAsBase64(file);
      const attachment: ComposerAttachment = {
        id: crypto.randomUUID(),
        file,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        content,
      };
      addAttachment(attachment);
    }
    // Reset input so re-selecting the same file works
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="px-4">
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
        }}
      />

      <div className="flex items-center gap-2 flex-wrap py-1.5">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-1.5 text-xs font-medium text-text-tertiary hover:text-text-primary transition-colors py-1 px-2 rounded-md hover:bg-bg-hover/80 active:scale-95 cursor-pointer"
          title="Attach files"
        >
          <Paperclip size={14} className="text-text-tertiary" />
          <span>Attach</span>
        </button>

        {attachments.map((att) => {
          const meta = getFileTypeMeta(att.mimeType, att.filename);

          return (
            <div
              key={att.id}
              className={`flex items-center gap-2 bg-bg-secondary/90 border border-border-primary/80 rounded-lg pl-2 pr-1.5 py-1 text-xs shadow-2xs transition-colors ${meta.cardBorderHover}`}
            >
              <FileTypeIcon mimeType={att.mimeType} filename={att.filename} size={13} />
              <span className="text-text-primary font-medium truncate max-w-[150px]" title={att.filename}>
                {att.filename}
              </span>
              <span className="font-mono text-[10px] text-text-tertiary bg-bg-tertiary/70 px-1 py-0.2 rounded">
                {formatFileSize(att.size)}
              </span>
              <button
                type="button"
                onClick={() => removeAttachment(att.id)}
                className="text-text-tertiary hover:text-danger rounded p-0.5 hover:bg-danger/10 transition-colors ml-0.5"
                title="Remove attachment"
                aria-label={`Remove ${att.filename}`}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}

        {attachments.length > 0 && (
          <span className="text-xs font-mono text-text-tertiary ml-1">
            {formatFileSize(totalSize)} total
          </span>
        )}
      </div>
    </div>
  );
}
