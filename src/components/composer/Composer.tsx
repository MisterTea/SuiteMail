import { useCallback, useEffect, useRef, useState } from "react";
import { CSSTransition } from "react-transition-group";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import { Maximize2, Minimize2, ExternalLink, Reply, ReplyAll, Forward, Users, Send, X, Paperclip, ChevronDown, ChevronUp, Check, Loader2, FileEdit, Trash2 } from "lucide-react";
import { formatScheduledTime } from "@/utils/date";

import { Button } from "@/components/ui/Button";
import { AddressInput } from "./AddressInput";
import { EditorToolbar } from "./EditorToolbar";
import { AiAssistPanel } from "./AiAssistPanel";
import { AttachmentPicker } from "./AttachmentPicker";
import { ContractEditor } from "./ContractEditor";
import { ScheduleSendDialog } from "./ScheduleSendDialog";
import { SignatureSelector } from "./SignatureSelector";
import { TemplatePicker } from "./TemplatePicker";
import { SnippetSuggestionPopup } from "./SnippetSuggestionPopup";
import { FromSelector } from "./FromSelector";
import { useComposerStore } from "@/stores/composerStore";
import { useAccountStore } from "@/stores/accountStore";
import { useThreadStore } from "@/stores/threadStore";
import { useToastStore } from "@/stores/toastStore";
import { useUIStore } from "@/stores/uiStore";
import { sendEmail, archiveThread, deleteDraft as deleteDraftAction } from "@/services/emailActions";
import { buildRawEmail } from "@/utils/emailBuilder";
import { upsertContact } from "@/services/db/contacts";
import { getSetting } from "@/services/db/settings";
import { insertScheduledEmail } from "@/services/db/scheduledEmails";
import { getDefaultSignature } from "@/services/db/signatures";
import { getAliasesForAccount, mapDbAlias, type SendAsAlias } from "@/services/db/sendAsAliases";
import { resolveFromAddress } from "@/utils/resolveFromAddress";
import { startAutoSave, stopAutoSave } from "@/services/composer/draftAutoSave";
import { getTemplatesForAccount, type DbTemplate } from "@/services/db/templates";
import { readFileAsBase64 } from "@/utils/fileUtils";
import { interpolateVariables } from "@/utils/templateVariables";
import { sanitizeHtml } from "@/utils/sanitize";
import { appendSealedContract } from "@/services/contracts/contractCrypto";

export function Composer() {
  // Individual selectors — only re-render when each specific value changes
  const isOpen = useComposerStore((s) => s.isOpen);
  const mode = useComposerStore((s) => s.mode);
  const to = useComposerStore((s) => s.to);
  const cc = useComposerStore((s) => s.cc);
  const bcc = useComposerStore((s) => s.bcc);
  const subject = useComposerStore((s) => s.subject);
  const showCcBcc = useComposerStore((s) => s.showCcBcc);
  const fromEmail = useComposerStore((s) => s.fromEmail);
  const viewMode = useComposerStore((s) => s.viewMode);
  const signatureHtml = useComposerStore((s) => s.signatureHtml);
  const quotedHtml = useComposerStore((s) => s.quotedHtml);
  const setQuotedHtml = useComposerStore((s) => s.setQuotedHtml);
  const isSaving = useComposerStore((s) => s.isSaving);
  const lastSavedAt = useComposerStore((s) => s.lastSavedAt);
  const draftId = useComposerStore((s) => s.draftId);
  const [showQuote, setShowQuote] = useState(false);
  // Note: bodyHtml intentionally NOT subscribed — TipTap manages its own editor state.
  // Subscribing would cause full re-renders on every keystroke.
  const closeComposer = useComposerStore((s) => s.closeComposer);
  const setTo = useComposerStore((s) => s.setTo);
  const setCc = useComposerStore((s) => s.setCc);
  const setBcc = useComposerStore((s) => s.setBcc);
  const setSubject = useComposerStore((s) => s.setSubject);
  const setShowCcBcc = useComposerStore((s) => s.setShowCcBcc);
  const setFromEmail = useComposerStore((s) => s.setFromEmail);
  const setViewMode = useComposerStore((s) => s.setViewMode);
  const addAttachment = useComposerStore((s) => s.addAttachment);
  const attachments = useComposerStore((s) => s.attachments);

  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const accounts = useAccountStore((s) => s.accounts);
  const activeAccount = accounts.find((a) => a.id === activeAccountId);
  const sendingRef = useRef(false);

  // Cache display values during exit animation to prevent 1-frame visual flash on close
  const cachedDisplayRef = useRef({
    mode,
    to,
    cc,
    bcc,
    subject,
  });

  if (isOpen) {
    cachedDisplayRef.current = { mode, to, cc, bcc, subject };
  }

  const displayMode = isOpen ? mode : cachedDisplayRef.current.mode;
  const displayTo = isOpen ? to : cachedDisplayRef.current.to;
  const displayCc = isOpen ? cc : cachedDisplayRef.current.cc;
  const displayBcc = isOpen ? bcc : cachedDisplayRef.current.bcc;
  const [showSchedule, setShowSchedule] = useState(false);
  const [showAiAssist, setShowAiAssist] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isRecipientsExpanded, setIsRecipientsExpanded] = useState(true);
  const [aliases, setAliases] = useState<SendAsAlias[]>([]);
  const templateShortcutsRef = useRef<DbTemplate[]>([]);
  const [snippetSuggestions, setSnippetSuggestions] = useState<DbTemplate[]>([]);
  const [snippetIndex, setSnippetIndex] = useState(0);
  const snippetTriggerRangeRef = useRef<{ from: number; to: number } | null>(null);
  const snippetSuggestionsRef = useRef(snippetSuggestions);
  snippetSuggestionsRef.current = snippetSuggestions;
  const snippetIndexRef = useRef(snippetIndex);
  snippetIndexRef.current = snippetIndex;
  const dragCounterRef = useRef(0);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const applySnippet = useCallback(
    async (tmpl: DbTemplate, range?: { from: number; to: number }) => {
      if (!editor) return;
      const state = useComposerStore.getState();
      const account = accounts.find((a) => a.id === activeAccountId);
      const resolved = await interpolateVariables(tmpl.body_html, {
        recipientEmail: state.to[0],
        senderEmail: account?.email,
        senderName: account?.displayName ?? undefined,
        subject: state.subject || undefined,
      });

      const targetRange = range ?? snippetTriggerRangeRef.current;
      if (targetRange && targetRange.from >= 0 && targetRange.to >= targetRange.from) {
        editor
          .chain()
          .focus()
          .deleteRange(targetRange)
          .insertContent(resolved)
          .run();
      } else {
        editor.chain().focus().insertContent(resolved).run();
      }

      if (tmpl.subject && !state.subject) {
        setSubject(tmpl.subject);
      }
      setSnippetSuggestions([]);
      snippetTriggerRangeRef.current = null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- editor reference is stable
    [accounts, activeAccountId, setSubject],
  );
  const applySnippetRef = useRef(applySnippet);
  applySnippetRef.current = applySnippet;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false },
      }),
      Placeholder.configure({
        placeholder: "Write your message... (type ;shortcut to expand snippets)",
      }),
      Image.configure({
        inline: true,
        allowBase64: true,
      }),
    ],
    content: useComposerStore.getState().bodyHtml,
    onUpdate: ({ editor: ed }) => {
      useComposerStore.getState().setBodyHtml(ed.getHTML());

      // Check for snippet shortcut triggers
      const templates = templateShortcutsRef.current;
      if (templates.length === 0) return;

      const { from } = ed.state.selection;
      const textBefore = ed.state.doc.textBetween(Math.max(0, from - 30), from, "\n");
      const match = textBefore.match(/(?:^|\s)([;/])([a-zA-Z0-9_-]*)$/);
      if (match && match[1] !== undefined && match[2] !== undefined) {
        const triggerChar = match[1];
        const query = match[2].toLowerCase();
        const triggerLen = triggerChar.length + match[2].length;
        snippetTriggerRangeRef.current = { from: from - triggerLen, to: from };

        const matched = templates.filter((t) => {
          if (!t.shortcut) return false;
          const clean = t.shortcut.replace(/^[;/]/, "").toLowerCase();
          return clean.startsWith(query);
        });

        if (matched.length > 0) {
          setSnippetSuggestions(matched);
          setSnippetIndex(0);
          return;
        }
      }
      setSnippetSuggestions([]);
      snippetTriggerRangeRef.current = null;
    },
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none px-4 py-3 min-h-[220px] pb-32 sm:pb-8 focus:outline-none text-text-primary text-base sm:text-sm leading-relaxed",
      },
      handleKeyDown: (_view, event) => {
        const suggestions = snippetSuggestionsRef.current;
        if (suggestions.length > 0) {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setSnippetIndex((i) => (i + 1) % suggestions.length);
            return true;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setSnippetIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
            return true;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            const tmpl = suggestions[snippetIndexRef.current];
            if (tmpl) {
              applySnippetRef.current(tmpl);
            }
            return true;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setSnippetSuggestions([]);
            snippetTriggerRangeRef.current = null;
            return true;
          }
        }
        return false;
      },
      handleDrop: (_view, event) => {
        // Prevent TipTap from handling file drops as inline content.
        // Returning true stops TipTap's Image extension from intercepting the drop,
        // allowing the event to bubble up to the composer's onDrop for attachment handling.
        if (event.dataTransfer?.files?.length) {
          return true;
        }
        return false;
      },
    },
  });

  // Load signature, aliases, and templates in parallel when composer opens
  useEffect(() => {
    if (!isOpen || !activeAccountId) return;
    let cancelled = false;

    Promise.all([
      getDefaultSignature(activeAccountId),
      getAliasesForAccount(activeAccountId),
      getTemplatesForAccount(activeAccountId),
    ]).then(([sig, dbAliases, templates]) => {
      if (cancelled) return;
      const store = useComposerStore.getState();

      // Signature
      if (sig) {
        store.setSignatureHtml(sig.body_html);
        store.setSignatureId(sig.id);
      }

      // Aliases + fromEmail resolution
      const mapped = dbAliases.map(mapDbAlias);
      setAliases(mapped);
      if (!store.fromEmail && mapped.length > 0) {
        if (store.mode === "reply" || store.mode === "replyAll" || store.mode === "forward") {
          const resolved = resolveFromAddress(mapped, store.to.join(", "), store.cc.join(", "));
          if (resolved) store.setFromEmail(resolved.email);
        } else {
          const defaultAlias = mapped.find((a) => a.isDefault) ?? mapped.find((a) => a.isPrimary) ?? mapped[0];
          if (defaultAlias) store.setFromEmail(defaultAlias.email);
        }
      }

      // Templates
      templateShortcutsRef.current = templates.filter((t) => t.shortcut);
    });

    return () => { cancelled = true; };
  }, [isOpen, activeAccountId]);

  // Start/stop draft auto-save
  useEffect(() => {
    if (!isOpen || !activeAccountId) return;
    startAutoSave(activeAccountId);
    return () => { stopAutoSave(); };
  }, [isOpen, activeAccountId]);

  // For forwards, expand the quoted email header card by default so user can review what is being forwarded
  useEffect(() => {
    if (mode === "forward" && isOpen) {
      setShowQuote(true);
    }
  }, [mode, isOpen]);

  // Synchronize editor content when composer opens with prefilled content
  useEffect(() => {
    if (isOpen && editor) {
      const initialBody = useComposerStore.getState().bodyHtml || "";
      if (editor.getHTML() !== initialBody) {
        editor.commands.setContent(initialBody);
      }
    }
  }, [isOpen, editor]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      const content = await readFileAsBase64(file);
      addAttachment({
        id: crypto.randomUUID(),
        file,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        content,
      });
    }
  }, [addAttachment]);

  const getFullHtml = useCallback(() => {
    const editorHtml = editor?.getHTML() ?? "";
    let finalHtml = editorHtml;
    if (quotedHtml) {
      finalHtml += `<br><br>${quotedHtml}`;
    }
    if (signatureHtml) {
      finalHtml += `<div style="margin-top:16px;border-top:1px solid #e5e5e5;padding-top:12px">${sanitizeHtml(signatureHtml)}</div>`;
    }
    return finalHtml;
  }, [editor, quotedHtml, signatureHtml]);

  const getOutgoingHtml = useCallback(async () => {
    const state = useComposerStore.getState();
    const from = state.fromEmail ?? activeAccount?.email ?? "";
    const editorHtml = editor?.getHTML() ?? "";
    let finalHtml = await appendSealedContract(
      editorHtml,
      state.contractActive ? state.contractText : "",
      from,
    );
    if (quotedHtml) {
      finalHtml += `<br><br>${quotedHtml}`;
    }
    if (signatureHtml) {
      finalHtml += `<div style="margin-top:16px;border-top:1px solid #e5e5e5;padding-top:12px">${sanitizeHtml(signatureHtml)}</div>`;
    }
    return finalHtml;
  }, [activeAccount?.email, editor, quotedHtml, signatureHtml]);

  const handleSend = useCallback(async () => {
    if (!activeAccountId || !activeAccount || sendingRef.current) return;
    const state = useComposerStore.getState();
    if (state.to.length === 0) return;

    sendingRef.current = true;
    stopAutoSave();

    const html = await getOutgoingHtml();
    const senderEmail = state.fromEmail ?? activeAccount.email;
    const raw = buildRawEmail({
      from: senderEmail,
      to: state.to,
      cc: state.cc.length > 0 ? state.cc : undefined,
      bcc: state.bcc.length > 0 ? state.bcc : undefined,
      subject: state.subject,
      htmlBody: html,
      inReplyTo: state.inReplyToMessageId ?? undefined,
      threadId: state.threadId ?? undefined,
      attachments: state.attachments.length > 0
        ? state.attachments.map((a) => ({
            filename: a.filename,
            mimeType: a.mimeType,
            content: a.content,
          }))
        : undefined,
    });

    // Get undo send delay
    const delaySetting = await getSetting("undo_send_delay_seconds");
    const delay = parseInt(delaySetting ?? "5", 10) * 1000;
    const currentDraftId = state.draftId;

    // Show undo send UI
    state.setUndoSendVisible(true);

    const timer = setTimeout(async () => {
      try {
        await sendEmail(activeAccountId, raw, state.threadId ?? undefined);

        // Delete draft if it was saved
        if (currentDraftId) {
          try { await deleteDraftAction(activeAccountId, currentDraftId); } catch { /* ignore */ }
        }

        // Send & archive: remove from inbox if replying to a thread
        if (useUIStore.getState().sendAndArchive && state.threadId) {
          try { await archiveThread(activeAccountId, state.threadId, []); } catch { /* ignore */ }
        }

        // Update contacts frequency
        for (const addr of [...state.to, ...state.cc, ...state.bcc]) {
          await upsertContact(addr, null);
        }
      } catch (err) {
        console.error("Failed to send email:", err);
      } finally {
        useComposerStore.getState().setUndoSendVisible(false);
        sendingRef.current = false;
      }
    }, delay);

    state.setUndoSendTimer(timer);
    closeComposer();
  }, [activeAccountId, activeAccount, closeComposer, getOutgoingHtml]);

  const handleSchedule = useCallback(async (scheduledAt: number, recurrenceRule?: string | null) => {
    if (!activeAccountId || !activeAccount) return;
    const state = useComposerStore.getState();
    if (state.to.length === 0) return;

    const html = await getOutgoingHtml();
    const editableHtml = getFullHtml();

    const attachmentData = state.attachments.length > 0
      ? JSON.stringify(state.attachments.map((a) => ({
          filename: a.filename,
          mimeType: a.mimeType,
          content: a.content,
        })))
      : null;

    const scheduledId = await insertScheduledEmail({
      accountId: activeAccountId,
      toAddresses: state.to.join(", "),
      ccAddresses: state.cc.length > 0 ? state.cc.join(", ") : null,
      bccAddresses: state.bcc.length > 0 ? state.bcc.join(", ") : null,
      subject: state.subject,
      bodyHtml: html,
      replyToMessageId: state.inReplyToMessageId,
      threadId: state.threadId,
      scheduledAt,
      signatureId: null,
      attachmentPaths: attachmentData,
      recurrenceRule: recurrenceRule ?? null,
    });

    stopAutoSave();
    // Delete the draft if exists
    if (state.draftId) {
      try {
        await deleteDraftAction(activeAccountId, state.draftId);
      } catch { /* ignore */ }
    }

    // Set rewarding scheduled toast with undo affordance
    const formatted = formatScheduledTime(scheduledAt);
    state.setScheduledToast({
      id: scheduledId,
      timestamp: scheduledAt,
      formattedTime: formatted,
      recipient: state.to.join(", "),
      subject: state.subject || "(No subject)",
      recurrenceRule: recurrenceRule ?? null,
      savedDraft: {
        to: [...state.to],
        cc: [...state.cc],
        bcc: [...state.bcc],
        subject: state.subject,
        bodyHtml: editableHtml,
        threadId: state.threadId,
        inReplyToMessageId: state.inReplyToMessageId,
        contractActive: state.contractActive,
        contractText: state.contractText,
      },
    });

    setShowSchedule(false);
    closeComposer();
  }, [activeAccountId, activeAccount, closeComposer, getFullHtml, getOutgoingHtml]);

  const handleDiscard = useCallback(async () => {
    stopAutoSave();
    const state = useComposerStore.getState();
    const currentDraftId = state.draftId;
    const currentThreadId = state.threadId;

    if (currentDraftId && activeAccountId) {
      try {
        await deleteDraftAction(activeAccountId, currentDraftId);
      } catch { /* ignore */ }
    }

    if (currentThreadId) {
      useThreadStore.getState().removeThreads?.([currentThreadId]);
      if (activeAccountId) {
        try {
          const { deleteThread } = await import("@/services/db/threads");
          await deleteThread(activeAccountId, currentThreadId);
        } catch { /* ignore */ }
      }
    }

    closeComposer();

    useToastStore.getState().showToast({
      message: "Draft discarded",
      icon: <Trash2 size={15} className="text-red-500 shrink-0" aria-hidden="true" />,
    });

    window.dispatchEvent(new CustomEvent("velo-sync-done"));
    window.dispatchEvent(new CustomEvent("draft-count-changed"));
  }, [activeAccountId, closeComposer]);

  const handlePopOutComposer = useCallback(async () => {
    try {
      const state = useComposerStore.getState();
      const params = new URLSearchParams();
      params.set("compose", "true");
      params.set("mode", state.mode);
      if (state.to.length > 0) params.set("to", state.to.join(","));
      if (state.cc.length > 0) params.set("cc", state.cc.join(","));
      if (state.bcc.length > 0) params.set("bcc", state.bcc.join(","));
      if (state.subject) params.set("subject", state.subject);
      if (state.threadId) params.set("threadId", state.threadId);
      if (state.inReplyToMessageId) params.set("inReplyToMessageId", state.inReplyToMessageId);
      if (state.draftId) params.set("draftId", state.draftId);
      if (state.fromEmail) params.set("fromEmail", state.fromEmail);
      // Encode body as base64 to safely pass HTML
      const bodyHtml = editor?.getHTML() ?? "";
      if (bodyHtml) params.set("body", btoa(unescape(encodeURIComponent(bodyHtml))));

      const windowLabel = `compose-${Date.now()}`;
      window.open(`index.html?${params.toString()}`, windowLabel, "width=700,height=650");

      stopAutoSave();
      closeComposer();
    } catch (err) {
      console.error("Failed to pop out composer:", err);
    }
  }, [editor, closeComposer]);

  const isFullpage = viewMode === "fullpage";

  return (
    <CSSTransition nodeRef={overlayRef} in={isOpen} timeout={200} classNames="slide-up" unmountOnExit>
    <div ref={overlayRef} className={`fixed inset-0 z-[60] flex ${isFullpage ? "items-stretch justify-center p-0 sm:p-4" : "items-end justify-center pb-0 sm:pb-4"} pointer-events-none`}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 pointer-events-auto backdrop-animate"
        onClick={closeComposer}
      />

      {/* Composer window */}
      <div
        className={`relative bg-bg-primary border rounded-t-2xl sm:rounded-2xl pb-0 glass-modal pointer-events-auto flex flex-col slide-up-panel shadow-2xl shadow-black/15 dark:shadow-black/45 overflow-hidden ${
          isFullpage ? "w-full h-full max-w-5xl" : "w-full max-w-2xl h-[100dvh] max-h-[100dvh] sm:h-auto sm:max-h-[82vh]"
        } ${isDragging ? "border-accent ring-2 ring-accent/30" : "border-border-primary/80 dark:border-white/10 ring-1 ring-black/[0.04] dark:ring-white/[0.06]"}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Mobile Drag Indicator Handle */}
        <div className="w-10 h-1 bg-border-primary/70 dark:bg-white/20 rounded-full mx-auto mt-2 -mb-1 sm:hidden shrink-0" aria-hidden="true" />
        {isDragging && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-bg-primary/90 dark:bg-bg-primary/95 backdrop-blur-md rounded-2xl pointer-events-none p-6 animate-in fade-in zoom-in-95 duration-150 border-2 border-dashed border-accent m-2">
            <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center text-accent mb-3 shadow-inner">
              <Paperclip size={28} className="animate-bounce" />
            </div>
            <span className="text-base font-semibold text-text-primary">Drop files to attach</span>
            <span className="text-xs text-text-tertiary mt-1">Files up to 24MB will be attached directly</span>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-primary/60 bg-bg-secondary/70 dark:bg-bg-secondary/80 backdrop-blur-md">
          <div className="flex items-center gap-2">
            {displayMode === "replyAll" ? (
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-text-primary">
                  <ReplyAll size={16} className="text-accent shrink-0" />
                  Reply All
                </span>
                <button
                  type="button"
                  onClick={() => setIsRecipientsExpanded((prev) => !prev)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-accent/10 hover:bg-accent/20 active:scale-95 text-accent border border-accent/20 transition-all cursor-pointer touch-manipulation"
                  title={isRecipientsExpanded ? "Collapse recipient details" : "Expand all recipients"}
                  aria-expanded={isRecipientsExpanded}
                >
                  <Users size={12} className="shrink-0" />
                  <span>{displayTo.length + displayCc.length + displayBcc.length} {displayTo.length + displayCc.length + displayBcc.length === 1 ? "recipient" : "recipients"}</span>
                  <ChevronDown size={12} className={`transition-transform duration-200 ${isRecipientsExpanded ? "rotate-180" : ""}`} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (to.length > 0 && to[0]) setTo([to[0]]);
                    setCc([]);
                    useComposerStore.setState({ mode: "reply" });
                  }}
                  className="text-[11px] text-text-tertiary hover:text-accent font-normal underline-offset-2 hover:underline transition-colors ml-1 hidden sm:inline"
                  title="Switch to single reply"
                >
                  (Switch to single reply)
                </button>
              </div>
            ) : displayMode === "reply" ? (
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-text-primary">
                  <Reply size={16} className="text-accent shrink-0" />
                  Reply
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-accent/10 text-accent border border-accent/20">
                  to sender
                </span>
              </div>
            ) : displayMode === "forward" ? (
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-text-primary">
                  <Forward size={16} className="text-accent shrink-0" />
                  Forward Email
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full bg-accent/15 text-accent border border-accent/25">
                  Original message
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-text-primary tracking-tight">
                  New Message
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wider rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 shadow-2xs">
                  <FileEdit size={10} className="shrink-0 stroke-[2.2]" />
                  Draft
                </span>
              </div>
            )}
            {draftId && mode !== "new" && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wider rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 shadow-2xs">
                <FileEdit size={10} className="shrink-0 stroke-[2.2]" />
                Draft
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setViewMode(isFullpage ? "modal" : "fullpage")}
              className="hidden sm:flex text-text-tertiary hover:text-text-primary p-1.5 items-center justify-center rounded-md hover:bg-bg-hover/80 transition-all duration-150 active:scale-95 cursor-pointer"
              title={isFullpage ? "Collapse" : "Expand"}
            >
              {isFullpage ? <Minimize2 size={16} className="sm:w-3.5 sm:h-3.5" /> : <Maximize2 size={16} className="sm:w-3.5 sm:h-3.5" />}
            </button>
            <button
              onClick={handlePopOutComposer}
              className="hidden sm:flex text-text-tertiary hover:text-text-primary p-1.5 items-center justify-center rounded-md hover:bg-bg-hover/80 transition-all duration-150 active:scale-95 cursor-pointer"
              title="Open in new window"
            >
              <ExternalLink size={14} />
            </button>
            <button
              onClick={closeComposer}
              className="text-text-tertiary hover:text-danger hover:bg-danger/10 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-2 sm:p-1.5 flex items-center justify-center rounded-full sm:rounded-md transition-all duration-150 active:scale-90 touch-manipulation cursor-pointer"
              title="Close"
              aria-label="Close"
            >
              <X size={18} className="sm:w-[15px] sm:h-[15px]" />
            </button>
          </div>
        </div>

        {/* Address fields */}
        <div className="px-4 py-2 border-b border-border-secondary/60 bg-bg-primary/50 transition-all">
          <FromSelector
            aliases={aliases}
            selectedEmail={fromEmail ?? activeAccount?.email ?? ""}
            onChange={(alias) => setFromEmail(alias.email)}
          />

          {/* Compact recipient summary row when collapsed on mobile */}
          {!isRecipientsExpanded && (to.length + cc.length > 1) ? (
            <div className="flex items-center justify-between gap-2 py-1 min-h-[40px]">
              <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-x-auto scrollbar-none py-0.5">
                <span className="text-xs font-semibold text-text-tertiary w-8 shrink-0 select-none">To</span>
                {to[0] && (
                  <span className="inline-flex items-center gap-1.5 bg-bg-secondary text-text-primary text-xs pl-1.5 pr-2.5 py-1 rounded-full border border-border-primary shrink-0 max-w-[200px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                    <span className="truncate">{to[0]}</span>
                  </span>
                )}
                {to.length > 1 && (
                  <span className="text-[11px] font-medium text-text-secondary px-2 py-1 rounded-full bg-bg-secondary border border-border-secondary shrink-0">
                    +{to.length - 1} more
                  </span>
                )}
                {cc.length > 0 && (
                  <span className="text-[11px] font-medium text-accent px-2 py-1 rounded-full bg-accent/10 border border-accent/20 shrink-0 flex items-center gap-1">
                    <span>Cc:</span>
                    <span className="truncate max-w-[120px]">{cc[0]}</span>
                    {cc.length > 1 ? ` (+${cc.length - 1})` : ""}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setIsRecipientsExpanded(true)}
                className="text-xs text-accent font-semibold px-2.5 py-1 rounded-lg bg-accent/10 hover:bg-accent/20 active:scale-95 shrink-0 transition-all cursor-pointer min-h-[36px] flex items-center gap-1 touch-manipulation"
                title="Expand full recipient list"
              >
                <span>Edit</span>
                <ChevronDown size={12} />
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <AddressInput
                    label="To"
                    addresses={to}
                    onChange={setTo}
                    autoFocus={mode === "forward" || (mode === "new" && to.length === 0)}
                    placeholder={mode === "forward" ? "Enter recipient to forward to..." : "Add recipients..."}
                    isForwardMode={mode === "forward"}
                  />
                </div>
                <div className="flex items-center gap-1 shrink-0 mt-0.5">
                  {!showCcBcc && (
                    <button
                      type="button"
                      onClick={() => setShowCcBcc(true)}
                      className="text-xs text-accent hover:text-accent-hover font-medium px-2 py-1.5 rounded-md hover:bg-accent/10 transition-colors cursor-pointer min-h-[36px] sm:min-h-0 flex items-center touch-manipulation"
                    >
                      Cc / Bcc
                    </button>
                  )}
                  {(to.length + cc.length > 1) && (
                    <button
                      type="button"
                      onClick={() => setIsRecipientsExpanded(false)}
                      className="text-xs text-text-tertiary hover:text-text-primary px-2 py-1.5 rounded-md hover:bg-bg-hover transition-colors cursor-pointer min-h-[36px] sm:min-h-0 flex items-center gap-0.5 touch-manipulation"
                      title="Collapse to compact view"
                      aria-label="Collapse recipient list"
                    >
                      <ChevronUp size={13} />
                      <span className="hidden sm:inline">Compact</span>
                    </button>
                  )}
                </div>
              </div>
              {showCcBcc && (
                <div className="pt-2 border-t border-border-secondary/60 bg-bg-secondary/35 -mx-4 px-4 py-2 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <AddressInput label="Cc" addresses={cc} onChange={setCc} />
                    </div>
                    {cc.length === 0 && bcc.length === 0 && (
                      <button
                        type="button"
                        onClick={() => setShowCcBcc(false)}
                        className="text-[11px] text-text-tertiary hover:text-text-primary px-1.5 py-1 rounded hover:bg-bg-hover transition-colors shrink-0 cursor-pointer min-h-[36px] sm:min-h-0 flex items-center touch-manipulation"
                        title="Hide Cc and Bcc"
                      >
                        Hide
                      </button>
                    )}
                  </div>
                  <AddressInput label="Bcc" addresses={bcc} onChange={setBcc} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Subject */}
        <div className="px-4 py-2 border-b border-border-secondary/60 bg-bg-primary/30">
          <div className="flex items-center gap-2 group">
            <span className="text-xs font-medium text-text-tertiary w-12 shrink-0 select-none transition-colors group-focus-within:text-accent">
              Subject
            </span>
            {(mode === "forward" || subject.toLowerCase().startsWith("fwd:")) && (
              <span
                data-testid="forward-subject-badge"
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wider uppercase bg-accent/15 text-accent border border-accent/25 shrink-0 shadow-2xs select-none"
                title="Forwarded email subject"
              >
                <Forward size={10} className="stroke-[2.5]" />
                Fwd
              </span>
            )}
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="flex-1 bg-transparent text-base sm:text-sm font-medium text-text-primary outline-none placeholder:text-text-tertiary/70 py-0.5"
            />
          </div>
        </div>

        {/* Forward context banner */}
        {mode === "forward" && (
          <div
            data-testid="forward-banner"
            className="flex items-center justify-between px-4 py-2 bg-accent/10 dark:bg-accent/15 border-b border-accent/20 text-xs shadow-2xs"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent text-white shadow-2xs shrink-0">
                <Forward size={11} className="stroke-[2.5]" />
              </span>
              <div className="min-w-0">
                <div className="font-semibold text-text-primary flex items-center gap-1.5 flex-wrap">
                  <span>Forwarding message</span>
                  <span className="text-[11px] font-normal text-text-tertiary hidden sm:inline">• Quoted email details preserved below</span>
                </div>
                <div className="text-[11px] text-text-secondary truncate sm:hidden">
                  Original headers & attachments preserved
                </div>
              </div>
            </div>
            {attachments.length > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-bg-primary/95 dark:bg-bg-secondary/95 border border-accent/30 rounded-full text-[11px] text-accent font-semibold shadow-2xs shrink-0 ml-2">
                <Paperclip size={11} className="text-accent" />
                {attachments.length} {attachments.length === 1 ? "file" : "files"}
              </span>
            )}
          </div>
        )}

        {/* Editor toolbar */}
        <EditorToolbar
          editor={editor}
          onToggleAiAssist={() => setShowAiAssist(!showAiAssist)}
          aiAssistOpen={showAiAssist}
        />

        {/* AI Assist Panel */}
        {showAiAssist && (
          <AiAssistPanel
            editor={editor}
            isReplyMode={mode === "reply" || mode === "replyAll"}
          />
        )}

        {/* Editor */}
        <div className="relative flex-1 overflow-y-auto overscroll-contain touch-pan-y -webkit-overflow-scrolling-touch scroll-smooth">
          {snippetSuggestions.length > 0 && (
            <SnippetSuggestionPopup
              suggestions={snippetSuggestions}
              selectedIndex={snippetIndex}
              onSelect={(tmpl) => applySnippet(tmpl)}
              onClose={() => setSnippetSuggestions([])}
            />
          )}
          <EditorContent editor={editor} />
          <ContractEditor />
          {/* Collapsible Quoted Context for replies/forwards */}
          {quotedHtml && (
            <div data-testid="quoted-headers-container" className="border-t border-border-secondary/60">
              {!showQuote ? (
                <div className="bg-bg-secondary/25 flex items-center justify-between text-xs text-text-tertiary">
                  <button
                    type="button"
                    onClick={() => setShowQuote(true)}
                    className="flex-1 min-h-[48px] sm:min-h-[36px] px-4 py-2 flex items-center gap-2 hover:text-text-secondary active:bg-bg-secondary/60 transition-colors text-left group cursor-pointer touch-manipulation"
                    title={mode === "forward" ? "Show forwarded email details" : "Show quoted text"}
                    aria-expanded={false}
                  >
                    <span className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-bg-secondary border border-border-secondary text-text-secondary group-hover:border-accent/40 font-medium shrink-0">···</span>
                    <span className="font-medium text-text-secondary">
                      {mode === "forward" ? "Show forwarded email details" : "Show quoted text"}
                    </span>
                    <span className="text-[11px] text-text-tertiary hidden sm:inline">
                      {mode === "forward" ? "• Preserved email headers and body" : "• Previous conversation context"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuotedHtml(null)}
                    className="min-h-[48px] sm:min-h-[36px] px-4 text-[11px] sm:text-xs text-text-tertiary hover:text-danger active:bg-red-500/10 transition-colors cursor-pointer touch-manipulation flex items-center justify-center shrink-0"
                    title="Remove quoted text"
                  >
                    Remove quote
                  </button>
                </div>
              ) : (
                <div className="px-4 py-3 bg-bg-secondary/40 animate-in fade-in duration-150">
                  <div className="flex items-center justify-between mb-2 text-[11px] text-text-tertiary">
                    <span className="font-semibold text-text-secondary tracking-wide uppercase text-[10px] flex items-center gap-1.5">
                      {mode === "forward" && <Forward size={11} className="text-accent stroke-[2.5]" />}
                      {mode === "forward" ? "Forwarded Message Details" : "Quoted Message Context"}
                    </span>
                    <div className="flex items-center gap-1 sm:gap-2">
                      <button
                        type="button"
                        onClick={() => setShowQuote(false)}
                        className="min-h-[44px] sm:min-h-[32px] px-3 text-xs text-text-secondary hover:text-text-primary flex items-center gap-1 transition-all active:scale-95 cursor-pointer touch-manipulation rounded-lg"
                        title="Collapse quoted text"
                        aria-expanded={true}
                      >
                        <ChevronUp size={13} /> Hide
                      </button>
                      <button
                        type="button"
                        onClick={() => setQuotedHtml(null)}
                        className="min-h-[44px] sm:min-h-[32px] px-3 text-xs text-text-tertiary hover:text-danger active:bg-red-500/10 transition-all active:scale-95 cursor-pointer touch-manipulation rounded-lg"
                        title="Remove quoted text"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  <div
                    className="border-l-[3px] border-accent/60 bg-bg-secondary/80 dark:bg-bg-secondary/50 rounded-r-lg p-3 text-xs text-text-secondary leading-relaxed max-h-48 overflow-y-auto border-y border-r border-border-secondary/50 font-sans"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(quotedHtml) }}
                  />
                </div>
              )}
            </div>
          )}
          {signatureHtml && (
            <div
              className="px-4 py-2 border-t border-border-secondary text-xs text-text-tertiary"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(signatureHtml) }}
            />
          )}
        </div>

        {/* Attachments */}
        <div className="border-t border-border-secondary">
          <AttachmentPicker />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 sm:py-2.5 border-t border-border-primary/60 bg-bg-secondary/70 dark:bg-bg-secondary/80 backdrop-blur-md sm:rounded-b-2xl pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-bg-tertiary/50 border border-border-primary/40 text-xs text-text-secondary font-medium min-w-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
              <span className="truncate max-w-[110px] sm:max-w-[170px]">{fromEmail ?? activeAccount?.email ?? "No account"}</span>
            </div>
            {/* Auto-save status indicator */}
            <div
              data-testid="draft-status-indicator"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-200 shrink-0 select-none ${
                isSaving
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 shadow-2xs"
                  : lastSavedAt
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 shadow-2xs"
                    : "bg-bg-tertiary/60 text-text-tertiary border border-border-secondary"
              }`}
              title={
                lastSavedAt
                  ? `Draft saved at ${new Date(lastSavedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                  : isSaving
                    ? "Saving draft changes..."
                    : "Draft auto-save enabled"
              }
            >
              {isSaving ? (
                <>
                  <Loader2 size={12} className="animate-spin text-amber-600 dark:text-amber-400 shrink-0" />
                  <span className="text-amber-700 dark:text-amber-300 font-medium">Saving...</span>
                </>
              ) : lastSavedAt ? (
                <>
                  <Check size={12} className="text-emerald-600 dark:text-emerald-400 stroke-[2.5] shrink-0" />
                  <span className="text-emerald-700 dark:text-emerald-300 font-medium">Saved as draft</span>
                </>
              ) : (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary/60 shrink-0" />
                  <span className="text-text-tertiary italic">Draft</span>
                </>
              )}
            </div>
            <SignatureSelector />
            <TemplatePicker editor={editor} />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="secondary"
              onClick={handleDiscard}
              className="min-h-[48px] sm:min-h-0 px-4 py-2 sm:px-3 sm:py-1.5 hover:text-danger hover:border-danger/30 transition-colors cursor-pointer text-sm sm:text-xs active:scale-95 rounded-xl touch-manipulation"
              title="Discard this draft and close"
              aria-label="Discard draft"
            >
              Discard
            </Button>
            <div className="inline-flex items-stretch rounded-xl shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden group/split">
              <button
                onClick={handleSend}
                disabled={to.length === 0}
                className="min-h-[48px] sm:min-h-0 px-5 py-2 sm:px-3.5 sm:py-1.5 text-sm sm:text-xs font-semibold text-white bg-accent hover:bg-accent-hover active:brightness-95 transition-all duration-150 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-accent cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 touch-manipulation"
              >
                <Send size={15} className="opacity-90" />
                <span>Send</span>
              </button>
              <button
                onClick={() => setShowSchedule((prev) => !prev)}
                disabled={to.length === 0}
                className="min-h-[48px] min-w-[48px] sm:min-h-0 sm:min-w-0 px-3 py-2 sm:px-2 sm:py-1.5 text-white bg-accent hover:bg-accent-hover active:brightness-95 border-l border-white/25 transition-all duration-150 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-accent cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 group/btn touch-manipulation"
                title="Schedule send"
                aria-label="Schedule send"
                aria-expanded={showSchedule}
                aria-haspopup="dialog"
              >
                <ChevronDown
                  size={15}
                  strokeWidth={2.2}
                  className={`transition-transform duration-200 ${showSchedule ? "rotate-180" : "group-hover/btn:translate-y-0.5"}`}
                />
              </button>
            </div>
          </div>
        </div>
      </div>

      {showSchedule && (
        <ScheduleSendDialog
          onSchedule={handleSchedule}
          onClose={() => setShowSchedule(false)}
        />
      )}
    </div>
    </CSSTransition>
  );
}
