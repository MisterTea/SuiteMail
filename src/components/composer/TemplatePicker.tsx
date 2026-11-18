import { useState, useEffect, useRef, useCallback } from "react";
import { FileText, ChevronDown } from "lucide-react";
import { useAccountStore } from "@/stores/accountStore";
import { useComposerStore } from "@/stores/composerStore";
import { getTemplatesForAccount, type DbTemplate } from "@/services/db/templates";
import type { Editor } from "@tiptap/react";

interface TemplatePickerProps {
  editor: Editor | null;
}

export function TemplatePicker({ editor }: TemplatePickerProps) {
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const { mode, subject, setSubject } = useComposerStore();
  const [templates, setTemplates] = useState<DbTemplate[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!activeAccountId) return;
    getTemplatesForAccount(activeAccountId).then(setTemplates);
  }, [activeAccountId]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  const handleSelect = useCallback((tmpl: DbTemplate) => {
    if (!editor) return;

    // If new message and subject is empty, use template subject
    if (mode === "new" && !subject && tmpl.subject) {
      setSubject(tmpl.subject);
    }

    // Insert template body at cursor
    editor.commands.insertContent(tmpl.body_html);
    setIsOpen(false);
  }, [editor, mode, subject, setSubject]);

  if (templates.length === 0) return null;

  return (
    <div className="relative shrink-0" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Templates"
        title="Templates"
        className="flex items-center gap-1.5 text-xs font-medium text-text-tertiary hover:text-text-secondary transition-colors px-2 py-1.5 sm:py-1 min-h-[38px] sm:min-h-0 rounded-md hover:bg-bg-hover/60 cursor-pointer"
      >
        <FileText size={13} className="shrink-0" />
        <span className="hidden sm:inline">Templates</span>
        <ChevronDown size={11} className={`shrink-0 transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className="absolute bottom-full mb-1.5 right-0 sm:right-auto sm:left-0 bg-bg-primary/95 backdrop-blur-md border border-border-primary rounded-xl shadow-xl glass-modal w-60 max-w-[calc(100vw-2rem)] max-h-52 overflow-y-auto z-10 p-1 divide-y divide-border-secondary/40 animate-in fade-in zoom-in-95 duration-150">
          {templates.map((tmpl) => (
            <button
              key={tmpl.id}
              onClick={() => handleSelect(tmpl)}
              className="w-full text-left px-3 py-2 min-h-[38px] flex flex-col justify-center hover:bg-bg-hover text-sm transition-colors rounded-lg cursor-pointer"
            >
              <div className="text-text-primary text-xs font-medium truncate">{tmpl.name}</div>
              {tmpl.subject && (
                <div className="text-text-tertiary text-[11px] truncate mt-0.5">{tmpl.subject}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
