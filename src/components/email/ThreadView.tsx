import { useEffect, useState, useRef, useCallback } from "react";
import { MessageItem } from "./MessageItem";
import { ActionBar } from "./ActionBar";
import { getMessagesForThread, type DbMessage } from "@/services/db/messages";
import { useAccountStore } from "@/stores/accountStore";
import { useUIStore } from "@/stores/uiStore";
import type { Thread } from "@/stores/threadStore";
import { useComposerStore } from "@/stores/composerStore";
import { useContextMenuStore } from "@/stores/contextMenuStore";
import { markThreadRead, archiveThread } from "@/services/emailActions";
import { getSetting } from "@/services/db/settings";
import { getAllowlistedSenders } from "@/services/db/imageAllowlist";
import { VolumeX } from "lucide-react";
import { escapeHtml, sanitizeHtml } from "@/utils/sanitize";
import { stripContractMarkup } from "@/services/contracts/contractMessage";
import { contractReplyFields } from "@/services/contracts/contractReply";
import { isNoReplyAddress } from "@/utils/noReply";
import { buildForwardQuote } from "@/utils/forwardQuoteBuilder";
import { getAttachmentsForMessage } from "@/services/db/attachments";
import type { ComposerAttachment } from "@/stores/composerStore";
import { ThreadSummary } from "./ThreadSummary";
import { UnsubscribeBanner } from "./UnsubscribeBanner";
import { SmartReplySuggestions } from "./SmartReplySuggestions";
import { InlineReply } from "./InlineReply";
import { ContactSidebar } from "./ContactSidebar";
import { TaskSidebar } from "@/components/tasks/TaskSidebar";
import { AiTaskExtractDialog } from "@/components/tasks/AiTaskExtractDialog";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { MessageSkeleton } from "@/components/ui/Skeleton";
import { RawMessageModal } from "./RawMessageModal";
import { exportThreadToFile } from "@/utils/mailboxExport";

interface ThreadViewProps {
  thread: Thread;
}

async function handlePopOut(thread: Thread) {
  try {
    if (typeof window !== "undefined" && window.supermail?.window?.openThreadWindow) {
      await window.supermail.window.openThreadWindow(thread.id, thread.accountId);
      return;
    }
    const windowLabel = `thread-${thread.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    const url = `index.html?thread=${encodeURIComponent(thread.id)}&account=${encodeURIComponent(thread.accountId)}`;
    window.open(url, windowLabel, "width=800,height=700");
  } catch (err) {
    console.error("Failed to open pop-out window:", err);
  }
}

export function ThreadView({ thread }: ThreadViewProps) {
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const contactSidebarVisible = useUIStore((s) => s.contactSidebarVisible);
  const toggleContactSidebar = useUIStore((s) => s.toggleContactSidebar);
  const taskSidebarVisible = useUIStore((s) => s.taskSidebarVisible);
  const [showTaskExtract, setShowTaskExtract] = useState(false);
  const [messages, setMessages] = useState<DbMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const markedReadRef = useRef<string | null>(null);
  // null = not yet loaded; defer iframe rendering until setting is known
  const [blockImages, setBlockImages] = useState<boolean | null>(null);
  const [allowlistedSenders, setAllowlistedSenders] = useState<Set<string>>(new Set());

  // Preload settings eagerly on mount (parallel with message loading)
  useEffect(() => {
    getSetting("block_remote_images").then((val) => setBlockImages(val !== "false"));
  }, []);

  const [isUnsubscribeDismissed, setIsUnsubscribeDismissed] = useState(false);
  useEffect(() => {
    setIsUnsubscribeDismissed(false);
  }, [thread.id]);

  const unsubscribeMessage = messages.find((m) => m.list_unsubscribe);

  const handleAutoArchive = useCallback(async () => {
    if (!activeAccountId) return;
    try {
      await archiveThread(activeAccountId, thread.id, []);
    } catch (err) {
      console.error("Failed to auto-archive thread:", err);
    }
  }, [activeAccountId, thread.id]);

  // Load messages
  useEffect(() => {
    if (!activeAccountId) return;
    setLoading(true);
    getMessagesForThread(activeAccountId, thread.id)
      .then(setMessages)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [activeAccountId, thread.id]);

  // Check per-sender allowlist (single batch query instead of N queries)
  useEffect(() => {
    if (!activeAccountId || messages.length === 0) return;
    let cancelled = false;

    const senders: string[] = [];
    for (const msg of messages) {
      if (msg.from_address) senders.push(msg.from_address);
    }
    const uniqueSenders = [...new Set(senders)];

    getAllowlistedSenders(activeAccountId, uniqueSenders).then((allowed) => {
      if (!cancelled) setAllowlistedSenders(allowed);
    });

    return () => { cancelled = true; };
  }, [activeAccountId, messages]);

  // Auto-mark unread threads as read when opened (respects mark-as-read setting)
  const markAsReadBehavior = useUIStore((s) => s.markAsReadBehavior);
  useEffect(() => {
    if (!activeAccountId) return;
    if (markedReadRef.current === thread.id) return;
    markedReadRef.current = thread.id;

    if (thread.isRead || markAsReadBehavior === "manual") return;

    const markRead = () => {
      markThreadRead(activeAccountId, thread.id, [], true).catch((err) => {
        console.error("Failed to mark thread as read:", err);
      });
    };

    if (markAsReadBehavior === "2s") {
      const timer = setTimeout(markRead, 2000);
      return () => clearTimeout(timer);
    }

    // instant
    markRead();
  }, [activeAccountId, thread.id, markAsReadBehavior]);

  const openComposer = useComposerStore((s) => s.openComposer);
  const openMenu = useContextMenuStore((s) => s.openMenu);
  const defaultReplyMode = useUIStore((s) => s.defaultReplyMode);
  const lastMessage = messages[messages.length - 1];

  const handleReply = useCallback(async () => {
    if (!lastMessage) return;
    const replyTo = lastMessage.reply_to ?? lastMessage.from_address;
    const contract = await contractReplyFields(lastMessage.body_html, lastMessage.body_text);
    openComposer({
      mode: "reply",
      to: replyTo ? [replyTo] : [],
      subject: `Re: ${lastMessage.subject ?? ""}`,
      bodyHtml: "",
      quotedHtml: buildQuote(lastMessage),
      threadId: lastMessage.thread_id,
      inReplyToMessageId: lastMessage.id,
      contractActive: contract.contractActive,
      contractText: contract.contractText,
    });
  }, [lastMessage, openComposer]);

  const handleReplyAll = useCallback(async () => {
    if (!lastMessage) return;
    const replyTo = lastMessage.reply_to ?? lastMessage.from_address;
    const allRecipients = new Set<string>();
    if (replyTo) allRecipients.add(replyTo);
    if (lastMessage.to_addresses) {
      lastMessage.to_addresses.split(",").forEach((a) => allRecipients.add(a.trim()));
    }
    const ccList: string[] = [];
    if (lastMessage.cc_addresses) {
      lastMessage.cc_addresses.split(",").forEach((a) => ccList.push(a.trim()));
    }
    const contract = await contractReplyFields(lastMessage.body_html, lastMessage.body_text);
    openComposer({
      mode: "replyAll",
      to: Array.from(allRecipients),
      cc: ccList,
      subject: `Re: ${lastMessage.subject ?? ""}`,
      bodyHtml: "",
      quotedHtml: buildQuote(lastMessage),
      threadId: lastMessage.thread_id,
      inReplyToMessageId: lastMessage.id,
      contractActive: contract.contractActive,
      contractText: contract.contractText,
    });
  }, [lastMessage, openComposer]);

  const handleForward = useCallback(async () => {
    if (!lastMessage) return;
    let initialAttachments: ComposerAttachment[] = [];
    if (activeAccountId) {
      try {
        const dbAtts = await getAttachmentsForMessage(activeAccountId, lastMessage.id);
        initialAttachments = dbAtts
          .filter((a) => !a.is_inline && a.filename)
          .map((a) => ({
            id: crypto.randomUUID(),
            filename: a.filename ?? "attachment",
            mimeType: a.mime_type ?? "application/octet-stream",
            size: a.size ?? 0,
            content: "",
          }));
      } catch (err) {
        console.error("Failed to load attachments for forward:", err);
      }
    }

    const rawSub = lastMessage.subject ?? "";
    const cleanSub = rawSub.startsWith("Fwd:") ? rawSub : `Fwd: ${rawSub}`;

    openComposer({
      mode: "forward",
      to: [],
      subject: cleanSub,
      bodyHtml: "",
      quotedHtml: buildForwardQuote({
        ...lastMessage,
        attachments: initialAttachments,
      }),
      threadId: lastMessage.thread_id,
      inReplyToMessageId: lastMessage.id,
      attachments: initialAttachments,
    });
  }, [lastMessage, activeAccountId, openComposer]);

  const handlePrint = useCallback(() => {
    if (messages.length === 0) return;
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.left = "-9999px";
    iframe.style.top = "-9999px";
    iframe.style.width = "0";
    iframe.style.height = "0";
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
    if (!doc) { document.body.removeChild(iframe); return; }

    const messagesHtml = messages.map((msg) => {
      const date = new Date(msg.date).toLocaleString();
      const from = msg.from_name
        ? `${escapeHtml(msg.from_name)} &lt;${escapeHtml(msg.from_address ?? "")}&gt;`
        : escapeHtml(msg.from_address ?? "Unknown");
      const to = escapeHtml(msg.to_addresses ?? "");
      const body = msg.body_html
        ? sanitizeHtml(stripContractMarkup(msg.body_html))
        : escapeHtml(stripContractMarkup(msg.body_text ?? ""));
      return `
        <div style="margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #e5e5e5">
          <div style="margin-bottom:8px;color:#666;font-size:12px">
            <strong>From:</strong> ${from}<br/>
            <strong>To:</strong> ${to}<br/>
            <strong>Date:</strong> ${date}
          </div>
          <div>${body}</div>
        </div>`;
    }).join("");

    const safeSubject = escapeHtml(thread.subject ?? "");
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><title>${safeSubject || "Email"}</title>
      <style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:800px;margin:20px auto;color:#333;font-size:14px}
      h1{font-size:18px;margin-bottom:8px}img{max-width:100%}</style></head>
      <body><h1>${safeSubject || "(No subject)"}</h1>${messagesHtml}</body></html>`);
    doc.close();

    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => document.body.removeChild(iframe), 1000);
  }, [messages, thread.subject]);

  // Message-level keyboard navigation (ArrowUp / ArrowDown)
  const [focusedMsgIdx, setFocusedMsgIdx] = useState(-1);
  const messageRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Reset focused index when thread changes
  useEffect(() => {
    setFocusedMsgIdx(-1);
  }, [thread.id]);

  // Scroll focused message into view
  useEffect(() => {
    if (focusedMsgIdx >= 0 && messageRefs.current[focusedMsgIdx]) {
      messageRefs.current[focusedMsgIdx]!.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [focusedMsgIdx]);

  // Arrow key handler for message navigation (only in full-screen thread view)
  // In split-pane mode, arrows navigate the thread list instead (handled by useKeyboardShortcuts)
  const readingPanePosition = useUIStore((s) => s.readingPanePosition);
  useEffect(() => {
    if (readingPanePosition !== "hidden") return;

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputFocused =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;
      if (isInputFocused) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedMsgIdx((prev) => {
          const next = prev + 1;
          return next < messages.length ? next : prev;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedMsgIdx((prev) => {
          const next = prev - 1;
          return next >= 0 ? next : prev;
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [messages.length, readingPanePosition]);

  const [rawMessageTarget, setRawMessageTarget] = useState<{
    messageId: string;
    accountId: string;
  } | null>(null);

  // Listen for "View Source" event from context menu
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        messageId: string;
        accountId: string;
      };
      setRawMessageTarget(detail);
    };
    window.addEventListener("suitemail-view-raw-message", handler);
    return () => window.removeEventListener("suitemail-view-raw-message", handler);
  }, []);

  // Listen for extract-task event from keyboard shortcut
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { threadId: string } | undefined;
      if (detail?.threadId === thread.id) {
        setShowTaskExtract(true);
      }
    };
    window.addEventListener("suitemail-extract-task", handler);
    return () => window.removeEventListener("suitemail-extract-task", handler);
  }, [thread.id]);

  const handleMessageContextMenu = useCallback((e: React.MouseEvent, msg: DbMessage) => {
    e.preventDefault();
    openMenu("message", { x: e.clientX, y: e.clientY }, {
      messageId: msg.id,
      threadId: msg.thread_id,
      accountId: msg.account_id,
      fromAddress: msg.from_address,
      fromName: msg.from_name,
      replyTo: msg.reply_to,
      toAddresses: msg.to_addresses,
      ccAddresses: msg.cc_addresses,
      subject: msg.subject,
      date: msg.date,
      bodyHtml: msg.body_html,
      bodyText: msg.body_text,
    });
  }, [openMenu]);

  const handleExport = useCallback(async () => {
    if (messages.length === 0) return;
    await exportThreadToFile(thread.subject ?? "email", messages);
  }, [messages, thread.subject]);

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <MessageSkeleton />
        <MessageSkeleton />
        <MessageSkeleton />
      </div>
    );
  }

  // Detect no-reply senders — disable reply buttons but still allow forward
  const noReply = isNoReplyAddress(lastMessage?.reply_to ?? lastMessage?.from_address);

  // Get the primary sender for the contact sidebar
  const primarySender = lastMessage?.from_address ?? null;
  const primarySenderName = lastMessage?.from_name ?? null;

  return (
    <div className="flex h-full @container relative overflow-hidden bg-bg-primary/30">
      <div className="flex flex-col flex-1 min-w-0">
        {/* Unified action bar */}
        <ActionBar
          thread={thread}
          messages={messages}
          noReply={noReply}
          defaultReplyMode={defaultReplyMode}
          contactSidebarVisible={contactSidebarVisible}
          taskSidebarVisible={taskSidebarVisible}
          onReply={handleReply}
          onReplyAll={handleReplyAll}
          onForward={handleForward}
          onPrint={handlePrint}
          onExport={handleExport}
          onPopOut={() => handlePopOut(thread)}
          onToggleContactSidebar={toggleContactSidebar}
          onToggleTaskSidebar={() => useUIStore.getState().toggleTaskSidebar()}
        />

        {/* Unsubscribe banner / top utility bar */}
        {unsubscribeMessage && !isUnsubscribeDismissed && activeAccountId && (
          <UnsubscribeBanner
            accountId={activeAccountId}
            threadId={thread.id}
            message={unsubscribeMessage}
            onAutoArchive={handleAutoArchive}
            onDismiss={() => setIsUnsubscribeDismissed(true)}
          />
        )}

        {/* Thread subject */}
        <div className="px-3.5 sm:px-6 py-2.5 sm:py-3.5 @md:px-8 border-b border-border-primary/60 bg-bg-primary/40 backdrop-blur-xs flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0 flex-1">
            <h1 className="text-base sm:text-xl font-bold tracking-tight text-text-primary flex items-center gap-2 break-words leading-snug select-text">
              {thread.subject ?? "(No subject)"}
              {thread.isMuted && (
                <span className="text-warning shrink-0" title="Muted">
                  <VolumeX size={16} />
                </span>
              )}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-accent/10 text-accent border border-accent/20 shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-accent/70" />
                {messages.length} message{messages.length !== 1 ? "s" : ""} in this thread
              </span>
            </div>
          </div>
        </div>

        {/* AI Summary */}
        {activeAccountId && (
          <ThreadSummary
            threadId={thread.id}
            accountId={activeAccountId}
            messages={messages}
          />
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto overscroll-y-contain px-3 sm:px-6 pt-2.5 sm:pt-4 pb-[calc(env(safe-area-inset-bottom,0px)+6rem)] md:pb-6 @md:px-8 space-y-3.5">
          <ErrorBoundary name="MessageList">
            {messages.map((msg, i) => (
              <MessageItem
                key={msg.id}
                ref={(el) => { messageRefs.current[i] = el; }}
                message={msg}
                isLast={i === messages.length - 1}
                focused={i === focusedMsgIdx}
                blockImages={blockImages}
                senderAllowlisted={msg.from_address ? allowlistedSenders.has(msg.from_address) : false}
                isSpam={thread.labelIds.includes("SPAM")}
                onContextMenu={(e) => handleMessageContextMenu(e, msg)}
              />
            ))}
          </ErrorBoundary>

          {/* Smart Reply Suggestions */}
          {activeAccountId && messages.length > 0 && (
            <SmartReplySuggestions
              threadId={thread.id}
              accountId={activeAccountId}
              messages={messages}
              noReply={noReply}
            />
          )}

          {/* Inline Reply */}
          {activeAccountId && (
            <InlineReply
              thread={thread}
              messages={messages}
              accountId={activeAccountId}
              noReply={noReply}
              onSent={() => {
                // Reload messages after sending
                getMessagesForThread(activeAccountId, thread.id)
                  .then(setMessages)
                  .catch(console.error);
              }}
            />
          )}
        </div>
      </div>

      {/* Contact sidebar */}
      {contactSidebarVisible && primarySender && activeAccountId && (
        <ContactSidebar
          email={primarySender}
          name={primarySenderName}
          accountId={activeAccountId}
          onClose={toggleContactSidebar}
        />
      )}

      {/* Task sidebar */}
      {taskSidebarVisible && activeAccountId && (
        <TaskSidebar accountId={activeAccountId} threadId={thread.id} />
      )}

      {/* Raw message source modal */}
      {rawMessageTarget && (
        <RawMessageModal
          isOpen={true}
          onClose={() => setRawMessageTarget(null)}
          messageId={rawMessageTarget.messageId}
          accountId={rawMessageTarget.accountId}
        />
      )}

      {/* AI Task Extraction Dialog */}
      {showTaskExtract && activeAccountId && (
        <AiTaskExtractDialog
          threadId={thread.id}
          accountId={activeAccountId}
          messages={messages}
          onClose={() => setShowTaskExtract(false)}
        />
      )}
    </div>
  );
}

function buildQuote(msg: DbMessage): string {
  const date = new Date(msg.date).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const from = msg.from_name
    ? `${escapeHtml(msg.from_name)} &lt;${escapeHtml(msg.from_address ?? "")}&gt;`
    : escapeHtml(msg.from_address ?? "Unknown");
  const body = msg.body_html
    ? sanitizeHtml(stripContractMarkup(msg.body_html))
    : escapeHtml(stripContractMarkup(msg.body_text ?? ""));
  return `<div class="quoted-message" style="border-left:3px solid rgba(99, 102, 241, 0.45);padding-left:12px;margin-left:0;margin-top:14px;margin-bottom:8px;color:#6b7280;font-size:13px;line-height:1.5;"><div style="font-weight:500;margin-bottom:4px;color:#4b5563;">On ${date}, ${from} wrote:</div><div>${body}</div></div>`;
}
