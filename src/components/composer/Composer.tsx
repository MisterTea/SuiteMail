import { isIOSLocalDraft } from "@/services/draft/iosDrafts";
import { isIOS } from "@/platform/ios";
import { useSendChecks } from "./SendChecks";
import { deleteStoredDraft } from "@/services/draft/openThreadDraft";
import { buildScheduledRawMime } from "@/services/snooze/scheduledSendManager";
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
import { MeetingTimesDialog, meetingTimesHtml } from "./MeetingTimesDialog";
import { SignatureSelector } from "./SignatureSelector";
import { TemplatePicker } from "./TemplatePicker";
import { SnippetSuggestionPopup } from "./SnippetSuggestionPopup";
import { FromSelector } from "./FromSelector";
import { useComposerStore } from "@/stores/composerStore";
import { useAccountStore } from "@/stores/accountStore";
import { useNativePhone } from "@/hooks/useNativePhone";
import { Modal } from "@/components/ui/Modal";
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
import { startAutoSave, stopAutoSave, flushAutoSave, waitForPendingAutoSave } from "@/services/composer/draftAutoSave";
import { getTemplatesForAccount, type DbTemplate } from "@/services/db/templates";
import { readFileAsBase64 } from "@/utils/fileUtils";
import { interpolateVariables } from "@/utils/templateVariables";
import { sanitizeHtml } from "@/utils/sanitize";
import { appendSealedContract } from "@/services/contracts/contractCrypto";

export function Composer() {
  const androidMobile = useNativePhone();
  const [showFormatting, setShowFormatting] = useState(() => !isIOS());
  const [showMore, setShowMore] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [closing, setClosing] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [discarding, setDiscarding] = useState(false);
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

  const viewedAccountId = useAccountStore((s) => s.activeAccountId);
  const draftAccountId = useComposerStore((s) => s.accountId);
  const { approveSend, sendReviewDialog } = useSendChecks(isOpen);
  const accounts = useAccountStore((s) => s.accounts);
  const activeAccount = draftAccountId
    ? accounts.find((account) => account.id === draftAccountId)
    : accounts.find((account) => account.id === viewedAccountId && account.provider !== "caldav")
      ?? accounts.find((account) => account.provider !== "caldav");
  const activeAccountId = activeAccount?.id;
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
  const [showMeetingTimes, setShowMeetingTimes] = useState(false);
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

  useEffect(() => {
    if (!isOpen) setShowMeetingTimes(false);
  }, [isOpen]);

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
        placeholder: androidMobile ? "Write your message…" : "Write your message... (type ;shortcut to expand snippets)",
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
        role: "textbox",
        "aria-label": "Message body",
        "aria-multiline": "true",
        class:
          `prose prose-sm max-w-none px-4 py-3 ${androidMobile ? "min-h-[160px] pb-8" : "min-h-[220px] pb-32 sm:pb-8"} focus:outline-none text-text-primary text-base sm:text-sm leading-relaxed`,
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
      if (sig && !isIOSLocalDraft(store.draftId)) {
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
    const saveWhenHidden = () => {
      if (document.hidden) void flushAutoSave().catch(() => {});
    };
    if (isIOS()) document.addEventListener("visibilitychange", saveWhenHidden);
    return () => {
      document.removeEventListener("visibilitychange", saveWhenHidden);
      stopAutoSave();
    };
  }, [isOpen, activeAccountId]);

  // For forwards, expand the quoted email header card by default so user can review what is being forwarded
  useEffect(() => {
    if (mode === "forward" && isOpen) {
      setShowQuote(!androidMobile);
    }
  }, [mode, isOpen, androidMobile]);

  // Synchronize editor content when composer opens with prefilled content
  useEffect(() => {
    if (isOpen && editor) {
      const initialBody = useComposerStore.getState().bodyHtml || "";
      if (editor.getHTML() !== initialBody) {
        editor.commands.setContent(initialBody);
      }
    }
  }, [isOpen, editor]);

  const dismissKeyboard = useCallback(() => {
    editor?.commands.blur();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }, [editor]);

  const commitRecipientInputs = useCallback(() => {
    const fields = overlayRef.current?.querySelectorAll<HTMLInputElement>("input[data-recipient-input]");
    for (const field of fields ?? []) {
      if (!field.checkValidity()) {
        field.reportValidity();
        field.focus();
        return false;
      }
    }
    if (document.activeElement instanceof HTMLInputElement && document.activeElement.dataset.recipientInput) {
      document.activeElement.blur();
    }
    return true;
  }, []);

  const handleSaveClose = useCallback(async () => {
    if (closing || !commitRecipientInputs()) return;
    setClosing(true);
    setSaveError("");
    try {
      await flushAutoSave();
      dismissKeyboard();
      closeComposer();
    } catch {
      setSaveError("Couldn't save draft. Please retry Save & close.");
    } finally {
      setClosing(false);
    }
  }, [closing, commitRecipientInputs, dismissKeyboard, closeComposer]);

  useEffect(() => {
    if (!isOpen) return;
    setShowFormatting(!isIOS());
    setShowMore(false);
    setSaveError("");
    const onError = () => setSaveError("Couldn't save draft. Please retry Save & close.");
    window.addEventListener("composer-save-error", onError);
    return () => window.removeEventListener("composer-save-error", onError);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !androidMobile) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || confirmDiscard || showSchedule || showMeetingTimes || document.querySelectorAll('[role="dialog"]').length > 1) return;
      event.preventDefault();
      void handleSaveClose();
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [isOpen, androidMobile, confirmDiscard, showSchedule, showMeetingTimes, handleSaveClose]);

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
    if (!commitRecipientInputs()) return;
    const state = useComposerStore.getState();
    if (state.to.length === 0) return;
    const authoredText = editor?.getText() ?? "";
    if (!await approveSend({
      from: state.fromEmail ?? activeAccount.email,
      to: state.to, cc: state.cc, bcc: state.bcc, mode: state.mode,
      text: `${state.subject} ${authoredText}`,
      hasAttachment: state.attachments.some((attachment) => Boolean(attachment.content) || attachment.size === 0),
    })) return;
    const current = useComposerStore.getState();
    if (!current.isOpen || current.subject !== state.subject || current.to !== state.to || current.cc !== state.cc
      || current.bcc !== state.bcc || current.fromEmail !== state.fromEmail || current.attachments !== state.attachments
      || (editor?.getText() ?? "") !== authoredText) return;

    sendingRef.current = true;
    try {
      await flushAutoSave();
    } catch {
      sendingRef.current = false;
      setSaveError("Couldn't save draft before sending. Please retry.");
      return;
    }
    stopAutoSave();
    const savedDraftId = useComposerStore.getState().draftId;
    try {
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
    const currentDraftId = savedDraftId;

    const restoreDraft = () => {
      sendingRef.current = false;
      if (useComposerStore.getState().isOpen) {
        useToastStore.getState().showToast({ message: "Close the current draft to recover this message.", duration: 0, action: { label: "Recover draft", onClick: restoreDraft } });
        return;
      }
      useComposerStore.getState().openComposer({ ...state, accountId: activeAccountId, draftId: currentDraftId });
      useComposerStore.setState({ fromEmail: state.fromEmail, signatureHtml: state.signatureHtml, signatureId: state.signatureId });
    };
    state.setUndoSendRestore(restoreDraft);
    // Show undo send UI
    state.setUndoSendVisible(true);

    const timer = setTimeout(async () => {
      try {
        const result = await sendEmail(activeAccountId, raw, state.threadId ?? undefined);
        if (!result.success) throw new Error(result.error || "Could not send message");

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
          try { await upsertContact(addr, null); } catch { /* Sending already succeeded. */ }
        }
      } catch (err) {
        console.error("Failed to send email:", err);
        useToastStore.getState().showToast({
          message: isIOS() && err instanceof Error ? err.message : "Couldn't send. Your draft is available to retry.",
          duration: 0,
          action: { label: "Recover draft", onClick: restoreDraft },
        });
      } finally {
        useComposerStore.getState().setUndoSendVisible(false);
        useComposerStore.getState().setUndoSendRestore(null);
        useComposerStore.getState().setUndoSendTimer(null);
        sendingRef.current = false;
      }
    }, delay);

    state.setUndoSendTimer(timer);
    dismissKeyboard();
    closeComposer();
    } catch {
      sendingRef.current = false;
      startAutoSave(activeAccountId);
      setSaveError("Couldn't prepare this message. Your draft is still here; please retry.");
    }
  }, [activeAccountId, activeAccount, closeComposer, getOutgoingHtml, commitRecipientInputs, dismissKeyboard, approveSend, editor]);

  const handleSchedule = useCallback(async (scheduledAt: number, recurrenceRule?: string | null) => {
    if (!activeAccountId || !activeAccount) return;
    if (!commitRecipientInputs()) return;
    const state = useComposerStore.getState();
    if (state.to.length === 0) return;
    const authoredText = editor?.getText() ?? "";
    if (!await approveSend({
      from: state.fromEmail ?? activeAccount.email,
      to: state.to, cc: state.cc, bcc: state.bcc, mode: state.mode,
      text: `${state.subject} ${authoredText}`,
      scheduled: true,
      hasAttachment: state.attachments.some((attachment) => Boolean(attachment.content) || attachment.size === 0),
    })) return;
    const current = useComposerStore.getState();
    if (!current.isOpen || current.subject !== state.subject || current.to !== state.to || current.cc !== state.cc
      || current.bcc !== state.bcc || current.fromEmail !== state.fromEmail || current.attachments !== state.attachments
      || (editor?.getText() ?? "") !== authoredText) return;

    const html = await getOutgoingHtml();
    const editableHtml = getFullHtml();

    const attachmentData = state.attachments.length > 0
      ? JSON.stringify(state.attachments.map((a) => ({
          filename: a.filename,
          mimeType: a.mimeType,
          content: a.content,
        })))
      : null;

    const scheduled = {
      accountId: activeAccountId,
      fromAddress: state.fromEmail ?? activeAccount.email,
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
    };
    // Android and iOS send from a native background job, which needs the finished MIME.
    const scheduledId = await insertScheduledEmail({ ...scheduled, rawMime: buildScheduledRawMime(scheduled, activeAccount.email) });

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
    dismissKeyboard();
    closeComposer();
  }, [activeAccountId, activeAccount, closeComposer, getFullHtml, getOutgoingHtml, commitRecipientInputs, dismissKeyboard, approveSend, editor]);

  const handleDiscard = useCallback(async () => {
    if (discarding) return;
    setDiscarding(true);
    await waitForPendingAutoSave();
    stopAutoSave();
    const state = useComposerStore.getState();
    const currentDraftId = state.draftId;
    try {
      if (currentDraftId && activeAccountId) {
        const result = await deleteDraftAction(activeAccountId, currentDraftId);
        if (!result.success) throw new Error(result.error || "Could not delete draft");
      }
      const draftAccountId = state.accountId ?? activeAccountId;
      if (state.draftMessageId && state.threadId && draftAccountId) {
        await deleteStoredDraft(draftAccountId, state.threadId, state.draftMessageId);
      }
    } catch {
      setSaveError("Couldn't discard draft. Your changes are still here.");
      setDiscarding(false);
      setConfirmDiscard(false);
      if (activeAccountId) startAutoSave(activeAccountId);
      return;
    }
    setDiscarding(false);
    setConfirmDiscard(false);
    dismissKeyboard();

    closeComposer();

    useToastStore.getState().showToast({
      message: "Draft discarded",
      icon: <Trash2 size={15} className="text-red-500 shrink-0" aria-hidden="true" />,
    });

    window.dispatchEvent(new CustomEvent("suitemail-sync-done"));
    window.dispatchEvent(new CustomEvent("draft-count-changed"));
  }, [activeAccountId, closeComposer, dismissKeyboard, discarding]);

  const handlePopOutComposer = useCallback(async () => {
    try {
      const state = useComposerStore.getState();
      const params = new URLSearchParams();
      params.set("compose", "true");
      params.set("mode", state.mode);
      if (activeAccountId) params.set("accountId", activeAccountId);
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
  }, [editor, closeComposer, activeAccountId]);

  const isFullpage = viewMode === "fullpage";
  useEffect(() => { if (lastSavedAt) setSaveError(""); }, [lastSavedAt]);

  return (
    <CSSTransition nodeRef={overlayRef} in={isOpen} timeout={200} classNames="slide-up" unmountOnExit>
    <div ref={overlayRef} style={androidMobile ? { height: "var(--mobile-viewport-height, 100dvh)", bottom: "auto" } : undefined} className={`fixed inset-0 z-[60] flex ${isFullpage ? "items-stretch justify-center p-0 sm:p-4" : "items-end justify-center pb-0 sm:pb-4"} pointer-events-none`}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 pointer-events-auto backdrop-animate"
        onClick={() => void handleSaveClose()}
      />

      {/* Composer window */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={displayMode === "new" ? "New message" : displayMode === "replyAll" ? "Reply all" : displayMode === "forward" ? "Forward email" : "Reply"}
        style={androidMobile ? { height: "100%", maxHeight: "100%", paddingTop: "env(safe-area-inset-top)" } : undefined}
        className={`relative bg-bg-primary border rounded-t-2xl sm:rounded-2xl pb-0 glass-modal pointer-events-auto flex flex-col slide-up-panel shadow-2xl shadow-black/15 dark:shadow-black/45 overflow-hidden ${
          isFullpage ? "w-full h-full max-w-5xl" : "w-full max-w-2xl h-[100dvh] max-h-[100dvh] sm:h-auto sm:max-h-[82vh]"
        } ${isDragging ? "border-accent ring-2 ring-accent/30" : "border-border-primary/80 dark:border-white/10 ring-1 ring-black/[0.04] dark:ring-white/[0.06]"}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Mobile Drag Indicator Handle */}
        <div className={`${androidMobile ? "hidden" : ""} w-10 h-1 bg-border-primary/70 dark:bg-white/20 rounded-full mx-auto mt-2 -mb-1 sm:hidden shrink-0`} aria-hidden="true" />
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
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border-primary/60 bg-bg-secondary/70 dark:bg-bg-secondary/80 backdrop-blur-md">
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
                  className={`${androidMobile ? "hidden" : ""} inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-accent/10 hover:bg-accent/20 active:scale-95 text-accent border border-accent/20 transition-all cursor-pointer touch-manipulation`}
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
              onClick={() => void handleSaveClose()}
              className="text-text-tertiary hover:text-danger hover:bg-danger/10 min-h-[48px] min-w-[48px] sm:min-h-0 sm:min-w-0 p-2 sm:p-1.5 flex items-center justify-center rounded-full sm:rounded-md transition-all duration-150 active:scale-90 touch-manipulation cursor-pointer"
              data-testid="composer-save-close"
              disabled={closing}
              title="Save & close"
              aria-label="Save & close"
            >
              {androidMobile ? <span className="text-xs font-semibold">{closing ? "Saving…" : "Save & close"}</span> : <X size={18} className="sm:w-[15px] sm:h-[15px]" />}
            </button>
          </div>
        </div>

        {androidMobile && <div role="status" aria-live="polite" className="shrink-0 px-4 py-1 text-xs text-text-secondary">{saveError || (isSaving || closing ? "Saving…" : lastSavedAt ? "Saved to Drafts" : "Unsaved changes")}</div>}
        {/* Phone-width windows scroll the whole body like the native phone layout; otherwise long recipient lists squeeze the editor to nothing. */}
        <div className={androidMobile ? "min-h-0 flex-1 flex flex-col [&>*]:shrink-0 overflow-y-auto overscroll-contain" : "contents max-sm:flex max-sm:min-h-0 max-sm:flex-1 max-sm:flex-col max-sm:[&>*]:shrink-0 max-sm:overflow-y-auto max-sm:overscroll-contain"}>
        {/* Address fields */}
        <div className="px-4 py-2 border-b border-border-secondary/60 bg-bg-primary/50 transition-all">
          <FromSelector
            aliases={aliases}
            selectedEmail={fromEmail ?? activeAccount?.email ?? ""}
            onChange={(alias) => setFromEmail(alias.email)}
          />

          {/* Compact recipient summary row when collapsed on mobile */}
          {!isRecipientsExpanded && (to.length + cc.length + bcc.length > 1) ? (
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
                {bcc.length > 0 && <span className="text-xs shrink-0">Bcc: {bcc.length}</span>}
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
                <div className="flex-1 min-w-0">
                  <AddressInput
                    label="To"
                    addresses={to}
                    onChange={setTo}
                    autoFocus={!isIOS() && (mode === "forward" || (mode === "new" && to.length === 0))}
                    placeholder={mode === "forward" ? "Enter recipient to forward to..." : "Add recipients..."}
                    isForwardMode={mode === "forward"}
                  />
                </div>
                <div className="flex items-center gap-1 shrink-0 mt-0.5">
                  {!showCcBcc && cc.length === 0 && bcc.length === 0 && (
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
              {(showCcBcc || cc.length > 0 || bcc.length > 0) && (
                <div className="pt-2 border-t border-border-secondary/60 bg-bg-secondary/35 -mx-4 px-4 py-2 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
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
              aria-label="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="flex-1 bg-transparent text-base sm:text-sm font-medium text-text-primary outline-none placeholder:text-text-tertiary/70 py-0.5"
            />
          </div>
        </div>

        {/* Forward context banner */}
        {mode === "forward" && !androidMobile && (
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
        {!isIOS() && <div className="px-4 py-1 border-b border-border-secondary">
          <Button type="button" disabled={!editor} aria-haspopup="dialog" aria-expanded={showMeetingTimes}
            className="min-h-[40px] sm:min-h-0" onClick={() => setShowMeetingTimes(true)}>
            Suggest meeting times
          </Button>
        </div>}
        {(!androidMobile || showFormatting) && <EditorToolbar
          editor={editor}
          onToggleAiAssist={() => setShowAiAssist(!showAiAssist)}
          aiAssistOpen={showAiAssist}
        />}

        {/* AI Assist Panel */}
        {showAiAssist && (
          <AiAssistPanel
            editor={editor}
            isReplyMode={mode === "reply" || mode === "replyAll"}
          />
        )}

        {/* Editor */}
        <div className={androidMobile ? "relative flex-1 min-h-[160px]" : "relative flex-1 max-sm:min-h-[160px] overflow-y-auto overscroll-contain touch-pan-y -webkit-overflow-scrolling-touch scroll-smooth"}>
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
        {!androidMobile && <div className="border-t border-border-secondary">
          <AttachmentPicker />
        </div>}

        </div>
        {androidMobile && <div data-composer-accessories className="shrink-0 border-t border-border-secondary"><AttachmentPicker /></div>}
        {androidMobile && <div data-composer-accessories className="shrink-0 flex flex-wrap items-center gap-2 px-4 border-t border-border-secondary">
          <button type="button" className="min-h-[48px] px-3 text-sm" aria-expanded={showFormatting} onClick={() => setShowFormatting(!showFormatting)}>Format</button>
          <button type="button" className="min-h-[48px] px-3 text-sm" aria-expanded={showMore} onClick={() => setShowMore(!showMore)}>More</button>
          <button type="button" className="min-h-[48px] px-3 text-sm text-accent" disabled={!to.length} onClick={() => setShowSchedule(true)}>Send later</button>
          {showMore && <div className="flex flex-wrap items-center gap-2 w-full"><SignatureSelector /><TemplatePicker editor={editor} /><button type="button" className="min-h-[48px] px-3 text-sm text-danger" onClick={() => setConfirmDiscard(true)}>Discard draft</button></div>}
        </div>}
        {/* Footer */}
        <div data-composer-footer className="shrink-0 flex items-center justify-between px-4 py-2.5 sm:py-2.5 border-t border-border-primary/60 bg-bg-secondary/70 dark:bg-bg-secondary/80 backdrop-blur-md sm:rounded-b-2xl pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className={androidMobile ? "hidden" : "flex items-center gap-2 sm:gap-3 min-w-0"}>
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
          <div className={androidMobile ? "flex w-full justify-end gap-2" : "flex items-center gap-2 shrink-0"}>
            <Button
              variant="secondary"
              onClick={() => androidMobile ? setConfirmDiscard(true) : void handleDiscard()}
              className={`${androidMobile ? "hidden" : ""} min-h-[48px] sm:min-h-0 px-4 py-2 sm:px-3 sm:py-1.5 hover:text-danger hover:border-danger/30 transition-colors cursor-pointer text-sm sm:text-xs active:scale-95 rounded-xl touch-manipulation`}
              title="Discard this draft and close"
              aria-label="Discard draft"
            >
              Discard
            </Button>
            <div className="inline-flex items-stretch rounded-xl shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden group/split">
              <button
                onClick={handleSend}
                disabled={to.length === 0 || closing}
                style={androidMobile ? { minHeight: 48 } : undefined}
                className="min-h-[48px] sm:min-h-0 px-5 py-2 sm:px-3.5 sm:py-1.5 text-sm sm:text-xs font-semibold text-white bg-accent hover:bg-accent-hover active:brightness-95 transition-all duration-150 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-accent cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 touch-manipulation"
              >
                <Send size={15} className="opacity-90" />
                <span>Send</span>
              </button>
              <button
                onClick={() => setShowSchedule((prev) => !prev)}
                disabled={to.length === 0}
                className={`${androidMobile ? "hidden" : ""} min-h-[48px] min-w-[48px] sm:min-h-0 sm:min-w-0 px-3 py-2 sm:px-2 sm:py-1.5 text-white bg-accent hover:bg-accent-hover active:brightness-95 border-l border-white/25 transition-all duration-150 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-accent cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 group/btn touch-manipulation`}
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

      <Modal isOpen={confirmDiscard} onClose={() => !discarding && setConfirmDiscard(false)} title="Discard this draft?" zIndex="z-[80]">
        <div className="p-4"><p className="text-sm">This deletes your saved draft and current changes.</p><div className="mt-4 flex flex-wrap gap-2"><button autoFocus type="button" disabled={discarding} className="min-h-[48px] px-4 rounded-lg border border-border-primary" onClick={() => setConfirmDiscard(false)}>Keep editing</button><button type="button" disabled={discarding} className="min-h-[48px] px-4 rounded-lg bg-danger text-white" onClick={() => void handleDiscard()}>{discarding ? "Discarding…" : "Discard draft"}</button></div></div>
      </Modal>
      {sendReviewDialog}
      {isOpen && showMeetingTimes && (
        <MeetingTimesDialog
          onClose={() => setShowMeetingTimes(false)}
          onAccept={(spans) => {
            if (editor) {
              editor.chain().focus().insertContentAt(editor.state.selection.to, meetingTimesHtml(spans)).run();
            }
            if (!useComposerStore.getState().subject.trim()) setSubject("Finding a time to meet");
            setShowMeetingTimes(false);
          }}
        />
      )}
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
