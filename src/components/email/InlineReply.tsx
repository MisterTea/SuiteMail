import { useState, useCallback, useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Reply, ReplyAll, Forward, Send, Maximize2, RotateCcw, X, Loader2, Users, ChevronDown } from "lucide-react";
import { useAccountStore } from "@/stores/accountStore";
import { useComposerStore } from "@/stores/composerStore";
import { useUIStore } from "@/stores/uiStore";
import { sendEmail, archiveThread } from "@/services/emailActions";
import { buildRawEmail } from "@/utils/emailBuilder";
import { appendSealedContract } from "@/services/contracts/contractCrypto";
import { contractReplyFields } from "@/services/contracts/contractReply";
import { upsertContact } from "@/services/db/contacts";
import { getSetting } from "@/services/db/settings";
import { getDefaultSignature } from "@/services/db/signatures";
import {
  isAutoDraftEnabled,
  generateAutoDraft,
  regenerateAutoDraft,
  type AutoDraftMode,
} from "@/services/ai/writingStyleService";
import type { DbMessage } from "@/services/db/messages";
import type { Thread } from "@/stores/threadStore";

type ReplyMode = "reply" | "replyAll" | "forward";

interface InlineReplyProps {
  thread: Thread;
  messages: DbMessage[];
  accountId: string;
  noReply?: boolean;
  onSent: () => void;
}

export function InlineReply({ thread, messages, accountId, noReply, onSent }: InlineReplyProps) {
  const [mode, setMode] = useState<ReplyMode | null>(null);
  const [sending, setSending] = useState(false);
  const [signatureHtml, setSignatureHtml] = useState("");
  const [autoDraftLoading, setAutoDraftLoading] = useState(false);
  const [hasAutoDraft, setHasAutoDraft] = useState(false);
  const [showRecipientsList, setShowRecipientsList] = useState(false);
  const [contractText, setContractText] = useState<string | null>(null);
  const accounts = useAccountStore((s) => s.accounts);
  const activeAccount = accounts.find((a) => a.id === accountId);
  const openComposer = useComposerStore((s) => s.openComposer);
  const containerRef = useRef<HTMLDivElement>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoDraftAbortRef = useRef(false);

  const lastMessage = messages[messages.length - 1];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!lastMessage) return;
      const fields = await contractReplyFields(lastMessage.body_html, lastMessage.body_text);
      if (cancelled) return;
      setContractText(fields.contractActive ? fields.contractText : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [lastMessage?.id, lastMessage?.body_html, lastMessage?.body_text]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, link: { openOnClick: false } }),
      Placeholder.configure({
        placeholder: "Write your reply...",
      }),
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none px-3 py-2 min-h-[80px] max-h-[200px] overflow-y-auto focus:outline-none text-text-primary text-sm",
      },
    },
  });

  const loadAutoDraft = useCallback(async (draftMode: AutoDraftMode) => {
    if (!editor) return;
    autoDraftAbortRef.current = false;
    setAutoDraftLoading(true);
    try {
      const enabled = await isAutoDraftEnabled();
      if (!enabled || autoDraftAbortRef.current) return;

      const draft = await generateAutoDraft(thread.id, accountId, messages, draftMode);
      if (autoDraftAbortRef.current || !draft) return;

      // Only set content if the editor is still empty (user hasn't typed)
      if (editor.isEmpty) {
        editor.commands.setContent(draft);
        setHasAutoDraft(true);
      }
    } catch (err) {
      console.warn("Auto-draft generation failed:", err);
    } finally {
      setAutoDraftLoading(false);
    }
  }, [editor, thread.id, accountId, messages]);

  const activateMode = useCallback((newMode: ReplyMode) => {
    setMode(newMode);
    setHasAutoDraft(false);
    autoDraftAbortRef.current = true; // Cancel any in-flight draft
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    focusTimerRef.current = setTimeout(() => editor?.commands.focus(), 50);

    // Trigger auto-draft for reply/replyAll (not forward)
    if (newMode === "reply" || newMode === "replyAll") {
      loadAutoDraft(newMode);
    }
  }, [editor, loadAutoDraft]);

  // Load default signature
  useEffect(() => {
    getDefaultSignature(accountId).then((sig) => {
      if (sig) setSignatureHtml(sig.body_html);
    });
  }, [accountId]);

  // Listen for inline reply events from keyboard shortcuts
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { mode: ReplyMode } | undefined;
      if (detail?.mode) {
        activateMode(detail.mode);
      }
    };
    window.addEventListener("suitemail-inline-reply", handler);
    return () => window.removeEventListener("suitemail-inline-reply", handler);
  }, [activateMode]);

  // Scroll into view when activated
  useEffect(() => {
    if (mode && containerRef.current) {
      containerRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [mode]);

  const getRecipients = useCallback((): { to: string[]; cc: string[] } => {
    if (!lastMessage) return { to: [], cc: [] };

    if (mode === "forward") return { to: [], cc: [] };

    const replyTo = lastMessage.reply_to ?? lastMessage.from_address;

    if (mode === "reply") {
      return { to: replyTo ? [replyTo] : [], cc: [] };
    }

    // replyAll
    const allTo = new Set<string>();
    if (replyTo) allTo.add(replyTo);
    if (lastMessage.to_addresses) {
      lastMessage.to_addresses.split(",").forEach((a) => allTo.add(a.trim()));
    }
    // Remove self from recipients
    if (activeAccount?.email) allTo.delete(activeAccount.email);

    const ccList: string[] = [];
    if (lastMessage.cc_addresses) {
      lastMessage.cc_addresses.split(",").forEach((a) => {
        const trimmed = a.trim();
        if (trimmed && trimmed !== activeAccount?.email) ccList.push(trimmed);
      });
    }

    return { to: Array.from(allTo), cc: ccList };
  }, [lastMessage, mode, activeAccount?.email]);

  const getSubject = useCallback((): string => {
    const sub = lastMessage?.subject ?? "";
    if (mode === "forward") return sub.startsWith("Fwd:") ? sub : `Fwd: ${sub}`;
    return sub.startsWith("Re:") ? sub : `Re: ${sub}`;
  }, [lastMessage, mode]);

  const handleSend = useCallback(async () => {
    if (!activeAccount || !editor || sending) return;
    const { to, cc } = getRecipients();
    if (to.length === 0 && mode !== "forward") return;

    setSending(true);
    try {
      let html = editor.getHTML();
      let textToSeal = contractText;
      if (mode !== "forward" && textToSeal == null && lastMessage) {
        const fields = await contractReplyFields(lastMessage.body_html, lastMessage.body_text);
        textToSeal = fields.contractActive ? fields.contractText : null;
      }
      if (mode !== "forward" && textToSeal != null && textToSeal.trim()) {
        html = await appendSealedContract(html, textToSeal, activeAccount.email);
      }
      if (signatureHtml) {
        html += `<div style="margin-top:16px;border-top:1px solid #e5e5e5;padding-top:12px">${signatureHtml}</div>`;
      }

      const raw = buildRawEmail({
        from: activeAccount.email,
        to,
        cc: cc.length > 0 ? cc : undefined,
        subject: getSubject(),
        htmlBody: html,
        inReplyTo: lastMessage?.id,
        threadId: thread.id,
      });

      // Get undo send delay
      const delaySetting = await getSetting("undo_send_delay_seconds");
      const delay = parseInt(delaySetting ?? "5", 10) * 1000;

      const { setUndoSendVisible, setUndoSendTimer } = useComposerStore.getState();
      setUndoSendVisible(true);

      const timer = setTimeout(async () => {
        try {
          await sendEmail(accountId, raw, thread.id);

          // Send & archive: remove from inbox if enabled
          if (useUIStore.getState().sendAndArchive) {
            try { await archiveThread(accountId, thread.id, []); } catch { /* ignore */ }
          }

          // Update contacts frequency
          for (const addr of [...to, ...cc]) {
            await upsertContact(addr, null);
          }
        } catch (err) {
          console.error("Failed to send inline reply:", err);
        } finally {
          setUndoSendVisible(false);
        }
      }, delay);

      setUndoSendTimer(timer);

      // Reset state
      editor.commands.setContent("");
      setMode(null);
      onSent();
    } catch (err) {
      console.error("Failed to send:", err);
    } finally {
      setSending(false);
    }
  }, [activeAccount, editor, sending, getRecipients, getSubject, signatureHtml, lastMessage, thread.id, accountId, mode, onSent, contractText]);

  const handleExpandToComposer = useCallback(() => {
    if (!editor || !lastMessage) return;
    const { to, cc } = getRecipients();
    const bodyHtml = editor.getHTML();

    openComposer({
      mode: mode === "forward" ? "forward" : mode === "replyAll" ? "replyAll" : "reply",
      to,
      cc,
      subject: getSubject(),
      bodyHtml,
      threadId: thread.id,
      inReplyToMessageId: lastMessage.id,
      contractActive: mode !== "forward" && contractText != null,
      contractText: mode !== "forward" && contractText != null ? contractText : "",
    });

    // Reset inline state
    editor.commands.setContent("");
    setMode(null);
  }, [editor, lastMessage, getRecipients, getSubject, mode, thread.id, openComposer, contractText]);

  const handleRegenerateDraft = useCallback(async () => {
    if (!editor || !mode || mode === "forward") return;
    autoDraftAbortRef.current = false;
    setAutoDraftLoading(true);
    try {
      const draft = await regenerateAutoDraft(thread.id, accountId, messages, mode);
      if (autoDraftAbortRef.current || !draft) return;
      editor.commands.setContent(draft);
      setHasAutoDraft(true);
    } catch (err) {
      console.warn("Auto-draft regeneration failed:", err);
    } finally {
      setAutoDraftLoading(false);
    }
  }, [editor, mode, thread.id, accountId, messages]);

  const handleClearDraft = useCallback(() => {
    if (!editor) return;
    editor.commands.setContent("");
    setHasAutoDraft(false);
    editor.commands.focus();
  }, [editor]);

  // Abort auto-draft on user typing
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      if (autoDraftLoading) {
        autoDraftAbortRef.current = true;
      }
    };
    editor.on("update", onUpdate);
    return () => { editor.off("update", onUpdate); };
  }, [editor, autoDraftLoading]);

  // Cleanup focus timer on unmount
  useEffect(() => {
    return () => {
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
      autoDraftAbortRef.current = true;
    };
  }, []);

  // Handle Ctrl+Enter to send, Escape to close
  useEffect(() => {
    if (!mode) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSend();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        editor?.commands.setContent("");
        setMode(null);
        setHasAutoDraft(false);
        autoDraftAbortRef.current = true;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mode, handleSend, editor]);

  if (!lastMessage) return null;

  // Collapsed state — show reply buttons
  if (!mode) {
    const allRecips = new Set<string>();
    if (lastMessage.reply_to || lastMessage.from_address) allRecips.add(lastMessage.reply_to ?? lastMessage.from_address!);
    if (lastMessage.to_addresses) lastMessage.to_addresses.split(",").forEach((a) => a.trim() && allRecips.add(a.trim()));
    if (lastMessage.cc_addresses) lastMessage.cc_addresses.split(",").forEach((a) => a.trim() && allRecips.add(a.trim()));
    if (activeAccount?.email) allRecips.delete(activeAccount.email);
    const hasMultipleRecipients = allRecips.size > 1;

    return (
      <div ref={containerRef} className="mx-2.5 sm:mx-4 my-2.5 sm:my-3 flex flex-wrap sm:flex-nowrap items-center gap-2">
        <button
          onClick={() => activateMode("reply")}
          disabled={noReply}
          title={noReply ? "This sender does not accept replies" : "Reply (r)"}
          className="flex-1 sm:flex-initial min-h-[44px] sm:min-h-0 flex items-center justify-center gap-1.5 px-4 py-2.5 sm:py-2 text-xs font-semibold text-text-secondary border border-border-primary/80 bg-bg-primary/80 rounded-xl hover:bg-bg-hover hover:text-text-primary active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-secondary touch-manipulation cursor-pointer"
        >
          <Reply size={14} className="text-accent" />
          Reply
        </button>
        <button
          onClick={() => activateMode("replyAll")}
          disabled={noReply}
          title={noReply ? "This sender does not accept replies" : "Reply All (a)"}
          className={`flex-1 sm:flex-initial min-h-[44px] sm:min-h-0 flex items-center justify-center gap-1.5 px-4 py-2.5 sm:py-2 text-xs font-semibold rounded-xl active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-secondary touch-manipulation cursor-pointer ${
            hasMultipleRecipients
              ? "bg-accent/15 text-accent border border-accent/30 hover:bg-accent hover:text-white"
              : "text-text-secondary border border-border-primary/80 bg-bg-primary/80 hover:bg-bg-hover hover:text-text-primary"
          }`}
        >
          <ReplyAll size={14} className={hasMultipleRecipients ? "text-accent" : ""} />
          <span>Reply All</span>
          {hasMultipleRecipients && (
            <span className="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-accent/20 text-accent border border-accent/30">
              {allRecips.size}
            </span>
          )}
        </button>
        <button
          onClick={() => activateMode("forward")}
          title="Forward (f)"
          className="flex-1 sm:flex-initial min-h-[44px] sm:min-h-0 flex items-center justify-center gap-1.5 px-4 py-2.5 sm:py-2 text-xs font-medium text-text-secondary border border-border-primary/80 bg-bg-primary/80 rounded-xl hover:bg-bg-hover hover:text-text-primary active:scale-[0.98] transition-all touch-manipulation cursor-pointer"
        >
          <Forward size={14} />
          Forward
        </button>
      </div>
    );
  }

  // Expanded state — editor visible
  const { to, cc } = getRecipients();
  const totalRecipients = to.length + cc.length;
  const modeLabel = mode === "reply" ? "Reply" : mode === "replyAll" ? "Reply All" : "Forward";

  return (
    <div ref={containerRef} className="mx-2.5 sm:mx-4 my-2.5 sm:my-3 border border-border-primary rounded-xl overflow-hidden bg-bg-primary shadow-lg ring-1 ring-accent/20 focus-within:ring-2 focus-within:ring-accent/40 transition-all">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2 bg-bg-secondary/70 border-b border-border-secondary">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="flex items-center gap-0.5 bg-bg-primary/80 p-0.5 rounded-lg border border-border-secondary/60 shrink-0 shadow-2xs">
            {(["reply", "replyAll", "forward"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`min-h-[36px] sm:min-h-0 px-2.5 sm:px-2 py-1 text-xs font-semibold rounded-md transition-all active:scale-95 cursor-pointer flex items-center gap-1 touch-manipulation ${
                  mode === m
                    ? "bg-accent/15 text-accent shadow-2xs ring-1 ring-accent/30 font-bold"
                    : "text-text-tertiary hover:text-text-primary hover:bg-bg-hover"
                }`}
              >
                {m === "reply" && <Reply size={12} className="shrink-0" />}
                {m === "replyAll" && <ReplyAll size={12} className="shrink-0" />}
                {m === "forward" && <Forward size={12} className="shrink-0" />}
                <span>{m === "reply" ? "Reply" : m === "replyAll" ? "Reply All" : "Forward"}</span>
                {m === "replyAll" && totalRecipients > 1 && (
                  <span className={`text-[10px] px-1 rounded-full font-bold leading-tight ${mode === "replyAll" ? "bg-accent text-white" : "bg-accent/15 text-accent"}`}>
                    {totalRecipients}
                  </span>
                )}
              </button>
            ))}
          </div>
          {/* Quick tap recipient pill / summary */}
          {totalRecipients > 0 && mode !== "forward" && (
            <button
              type="button"
              onClick={() => setShowRecipientsList(!showRecipientsList)}
              aria-expanded={showRecipientsList}
              title={showRecipientsList ? "Collapse recipients" : "View and manage recipients"}
              className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary px-2.5 py-1 rounded-full bg-bg-primary/90 hover:bg-bg-hover border border-border-secondary/80 font-medium transition-all max-w-[150px] sm:max-w-[260px] cursor-pointer shadow-2xs active:scale-95 shrink min-h-[36px] sm:min-h-0 touch-manipulation"
            >
              <Users size={12} className="text-accent shrink-0" />
              <span className="truncate text-left">
                {to[0] ? to[0].split("@")[0] : "Recipients"}
                {totalRecipients > 1 ? ` +${totalRecipients - 1}` : ""}
              </span>
              {cc.length > 0 && (
                <span className="text-[10px] text-accent font-semibold px-1 py-0.2 rounded bg-accent/10 border border-accent/20 shrink-0 hidden sm:inline">
                  Cc:{cc.length}
                </span>
              )}
              <ChevronDown size={11} className={`text-text-tertiary transition-transform duration-200 shrink-0 ${showRecipientsList ? "rotate-180" : ""}`} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleExpandToComposer}
            title="Expand to full composer"
            aria-label="Expand to full composer"
            className="min-h-[36px] min-w-[36px] sm:min-h-[28px] sm:min-w-[28px] text-text-tertiary hover:text-text-primary hover:bg-bg-hover rounded-lg flex items-center justify-center transition-all active:scale-95 cursor-pointer touch-manipulation"
          >
            <Maximize2 size={14} />
          </button>
          <button
            onClick={() => setMode(null)}
            className="min-h-[36px] px-2.5 sm:min-h-0 text-xs text-text-tertiary hover:text-danger hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer touch-manipulation"
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Expandable Recipient Detail Drawer in InlineReply */}
      {showRecipientsList && totalRecipients > 0 && mode !== "forward" && (
        <div className="px-3.5 py-2.5 bg-bg-secondary/90 dark:bg-bg-secondary/70 border-b border-border-secondary text-xs space-y-2 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="flex items-center justify-between text-text-tertiary text-[11px] font-semibold uppercase tracking-wider">
            <span className="flex items-center gap-1.5 text-text-secondary">
              <Users size={12} className="text-accent" />
              {mode === "replyAll" ? "Reply All Recipients" : "Reply Recipient"} ({totalRecipients})
            </span>
            <button
              type="button"
              onClick={() => setShowRecipientsList(false)}
              className="text-xs text-accent hover:underline lowercase font-normal cursor-pointer py-0.5 px-1.5"
            >
              hide
            </button>
          </div>
          {to.length > 0 && (
            <div className="flex items-start gap-2">
              <span className="text-text-tertiary font-medium w-8 shrink-0 pt-0.5 text-[11px]">To:</span>
              <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
                {to.map((addr) => (
                  <span key={addr} className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs bg-bg-primary border border-border-secondary text-text-primary shadow-2xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                    <span className="truncate max-w-[220px]">{addr}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {cc.length > 0 && (
            <div className="flex items-start gap-2 pt-1 border-t border-border-secondary/50">
              <span className="text-text-tertiary font-medium w-8 shrink-0 pt-0.5 text-[11px]">Cc:</span>
              <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
                {cc.map((addr) => (
                  <span key={addr} className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs bg-bg-primary border border-border-secondary text-text-secondary shadow-2xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                    <span className="truncate max-w-[220px]">{addr}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Editor */}
      <div className="relative">
        <EditorContent editor={editor} />
        {autoDraftLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg-primary/60 backdrop-blur-[1px]">
            <div className="flex items-center gap-2 text-xs text-text-secondary">
              <Loader2 size={14} className="animate-spin" />
              Generating draft...
            </div>
          </div>
        )}
      </div>

      {mode !== "forward" && contractText != null && (
        <div className="border-t border-border-secondary px-3 py-2">
          <hr data-testid="inline-contract-separator" className="mb-2 border-border-primary" />
          <label htmlFor="inline-suitemail-contract" className="mb-1 block text-xs font-semibold text-text-secondary">
            Contract
          </label>
          <textarea
            id="inline-suitemail-contract"
            aria-label="Contract"
            value={contractText}
            onChange={(e) => setContractText(e.target.value)}
            rows={4}
            className="w-full resize-y rounded-lg border border-border-primary bg-bg-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-border-secondary bg-bg-secondary">
        <div className="flex items-center gap-1">
          <button
            onClick={handleExpandToComposer}
            title="Expand to full composer"
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-text-tertiary hover:text-text-primary transition-colors"
          >
            <Maximize2 size={12} />
            Expand
          </button>
          {hasAutoDraft && mode !== "forward" && (
            <>
              <button
                onClick={handleRegenerateDraft}
                disabled={autoDraftLoading}
                title="Regenerate AI draft"
                className="flex items-center gap-1 px-2 py-1 text-xs text-text-tertiary hover:text-accent transition-colors disabled:opacity-50"
              >
                <RotateCcw size={11} />
                Regenerate
              </button>
              <button
                onClick={handleClearDraft}
                title="Clear AI draft"
                className="flex items-center gap-1 px-2 py-1 text-xs text-text-tertiary hover:text-danger transition-colors"
              >
                <X size={11} />
                Clear
              </button>
            </>
          )}
        </div>
        <button
          onClick={handleSend}
          disabled={sending || (to.length === 0 && mode !== "forward")}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send size={12} />
          {modeLabel}
        </button>
      </div>
    </div>
  );
}
