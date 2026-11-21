import { useAndroidMobile } from "@/hooks/useAndroidMobile";
import { useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { InputDialog } from "@/components/ui/InputDialog";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  List,
  ListOrdered,
  Quote,
  Code,
  Minus,
  Link2,
  Image as ImageIcon,
  Undo2,
  Redo2,
  Sparkles,
  Calendar,
  Users,
} from "lucide-react";
import { ShareAvailabilityModal } from "./ShareAvailabilityModal";
import { MailMergeModal } from "./MailMergeModal";
import { useComposerStore } from "@/stores/composerStore";

interface EditorToolbarProps {
  editor: Editor | null;
  onToggleAiAssist?: () => void;
  aiAssistOpen?: boolean;
}

export function EditorToolbar({ editor, onToggleAiAssist, aiAssistOpen }: EditorToolbarProps) {
  const androidMobile = useAndroidMobile();
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [showAvailabilityModal, setShowAvailabilityModal] = useState(false);
  const [showMailMergeModal, setShowMailMergeModal] = useState(false);
  const subject = useComposerStore((s) => s.subject);

  if (!editor) return null;

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      editor.chain().focus().setImage({ src: dataUrl }).run();
    };
    reader.readAsDataURL(file);
    if (imageInputRef.current) imageInputRef.current.value = "";
  };

  const toolbarBtn = (
    icon: React.ReactNode,
    isActive: boolean,
    onClick: () => void,
    title: string,
    ariaLabel?: string,
  ) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel ?? title}
      aria-pressed={isActive}
      className={`${androidMobile ? "h-12 min-w-12" : "h-10 min-w-10 sm:h-7 sm:min-w-7"} px-2 sm:px-1.5 flex items-center justify-center rounded-lg sm:rounded-md text-xs shrink-0 transition-all duration-150 active:scale-90 touch-manipulation cursor-pointer select-none ${
        isActive
          ? "bg-accent/15 text-accent font-semibold shadow-2xs ring-1 ring-accent/30 dark:bg-accent/25 dark:text-accent-light"
          : "text-text-secondary hover:text-text-primary hover:bg-bg-hover/80 active:bg-bg-hover"
      }`}
    >
      {icon}
    </button>
  );

  const headingBtn = (
    level: 1 | 2 | 3,
    isActive: boolean,
    onClick: () => void,
    title: string,
  ) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={isActive}
      className={`${androidMobile ? "h-12 min-w-12" : "h-10 min-w-10 sm:h-7 sm:min-w-7"} px-2 sm:px-1.5 flex items-center justify-center rounded-lg sm:rounded-md text-[11px] font-bold tracking-tight shrink-0 transition-all duration-150 active:scale-90 touch-manipulation cursor-pointer select-none ${
        isActive
          ? "bg-accent/15 text-accent shadow-2xs ring-1 ring-accent/30 dark:bg-accent/25 dark:text-accent-light"
          : "text-text-secondary hover:text-text-primary hover:bg-bg-hover/80 active:bg-bg-hover"
      }`}
    >
      H{level}
    </button>
  );

  const divider = <div className="w-px h-5 sm:h-4 bg-border-primary/60 mx-1 shrink-0" />;

  return (
    <div className="relative border-b border-border-secondary/60 bg-bg-secondary/40 backdrop-blur-xs">
      <div role="toolbar" aria-label="Message formatting" className={androidMobile ? "flex flex-wrap items-center gap-1 px-3 py-1.5" : "flex items-center gap-1 sm:gap-0.5 px-3 py-1.5 overflow-x-auto no-scrollbar flex-nowrap sm:flex-wrap overscroll-x-contain touch-pan-x scroll-smooth"}>
      {/* Inline styles */}
      {toolbarBtn(<Bold size={14} />, editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), "Bold (Ctrl+B)")}
      {toolbarBtn(<Italic size={14} />, editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), "Italic (Ctrl+I)")}
      {toolbarBtn(<UnderlineIcon size={14} />, editor.isActive("underline"), () => editor.chain().focus().toggleUnderline().run(), "Underline (Ctrl+U)")}
      {toolbarBtn(<Strikethrough size={14} />, editor.isActive("strike"), () => editor.chain().focus().toggleStrike().run(), "Strikethrough")}

      {divider}

      {/* Headings */}
      {headingBtn(1, editor.isActive("heading", { level: 1 }), () => editor.chain().focus().toggleHeading({ level: 1 }).run(), "Heading 1")}
      {headingBtn(2, editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), "Heading 2")}
      {headingBtn(3, editor.isActive("heading", { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run(), "Heading 3")}

      {divider}

      {/* Lists & formatting */}
      {toolbarBtn(<List size={14} />, editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), "Bullet list")}
      {toolbarBtn(<ListOrdered size={14} />, editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), "Numbered list")}
      {toolbarBtn(<Quote size={14} />, editor.isActive("blockquote"), () => editor.chain().focus().toggleBlockquote().run(), "Quote")}
      {toolbarBtn(<Code size={14} />, editor.isActive("codeBlock"), () => editor.chain().focus().toggleCodeBlock().run(), "Code block")}

      {divider}

      {/* Inserts */}
      {toolbarBtn(<Minus size={14} />, false, () => editor.chain().focus().setHorizontalRule().run(), "Horizontal rule")}
      {toolbarBtn(
        <Link2 size={14} />,
        editor.isActive("link"),
        () => {
          if (editor.isActive("link")) {
            editor.chain().focus().unsetLink().run();
          } else {
            setShowLinkDialog(true);
          }
        },
        "Insert link",
      )}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageSelect}
      />
      {toolbarBtn(<ImageIcon size={14} />, false, () => imageInputRef.current?.click(), "Insert image")}

      {/* Spacer */}
      <div className="flex-1 min-w-[8px]" />

      {/* Productivity Tools */}
      <div className="flex flex-wrap items-center gap-1 min-w-0">
        <button
          type="button"
          onClick={() => setShowAvailabilityModal(true)}
          title="Share Availability (Calendar Slots)"
          className="h-10 sm:h-7 px-3 sm:px-2 text-xs font-medium rounded-lg sm:rounded-md hover:bg-bg-hover/80 active:bg-bg-hover text-text-secondary hover:text-text-primary transition-all duration-150 flex items-center gap-1.5 active:scale-90 touch-manipulation cursor-pointer shrink-0"
        >
          <Calendar size={14} className="text-text-tertiary sm:w-3.5 sm:h-3.5" />
          <span>Slots</span>
        </button>

        <button
          type="button"
          onClick={() => setShowMailMergeModal(true)}
          title="Mail Merge Campaign from CSV"
          className="h-10 sm:h-7 px-3 sm:px-2 text-xs font-medium rounded-lg sm:rounded-md hover:bg-bg-hover/80 active:bg-bg-hover text-text-secondary hover:text-text-primary transition-all duration-150 flex items-center gap-1.5 active:scale-90 touch-manipulation cursor-pointer shrink-0"
        >
          <Users size={14} className="text-text-tertiary sm:w-3.5 sm:h-3.5" />
          <span>Merge</span>
        </button>

        {onToggleAiAssist && (
          <button
            type="button"
            onClick={onToggleAiAssist}
            title="AI Assist"
            className={`h-10 sm:h-7 px-3 sm:px-2 text-xs font-medium rounded-lg sm:rounded-md transition-all duration-150 flex items-center gap-1.5 active:scale-90 touch-manipulation cursor-pointer shrink-0 ${
              aiAssistOpen
                ? "bg-accent/15 text-accent shadow-2xs ring-1 ring-accent/30 dark:bg-accent/25 dark:text-accent-light"
                : "text-text-secondary hover:text-accent hover:bg-accent/10 active:bg-accent/15"
            }`}
          >
            <Sparkles size={14} className={aiAssistOpen ? "text-accent" : "text-accent/80 sm:w-3.5 sm:h-3.5"} />
            <span>AI</span>
          </button>
        )}

        {divider}

        {toolbarBtn(<Undo2 size={15} className="sm:w-3.5 sm:h-3.5" />, false, () => editor.chain().focus().undo().run(), "Undo (Ctrl+Z)")}
        {toolbarBtn(<Redo2 size={15} className="sm:w-3.5 sm:h-3.5" />, false, () => editor.chain().focus().redo().run(), "Redo (Ctrl+Y)")}
      </div>
      {/* Scroll edge fade cue on mobile to indicate horizontal overflow */}
      <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-bg-secondary/90 to-transparent sm:hidden" />
    </div>

      <InputDialog
        isOpen={showLinkDialog}
        onClose={() => setShowLinkDialog(false)}
        onSubmit={(values) => {
          if (values.url) {
            editor.chain().focus().setLink({ href: values.url }).run();
          }
        }}
        title="Insert Link"
        fields={[{ key: "url", label: "URL", placeholder: "https://..." }]}
        submitLabel="Insert"
      />
      <ShareAvailabilityModal
        isOpen={showAvailabilityModal}
        onClose={() => setShowAvailabilityModal(false)}
        editor={editor}
      />
      <MailMergeModal
        isOpen={showMailMergeModal}
        onClose={() => setShowMailMergeModal(false)}
        subjectTemplate={subject || ""}
        bodyHtmlTemplate={editor.getHTML()}
      />
    </div>
  );
}
