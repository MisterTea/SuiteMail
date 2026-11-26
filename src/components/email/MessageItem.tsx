import { memo, useState, useRef, useEffect, useMemo, forwardRef } from "react";
import { formatFullDate } from "@/utils/date";
import { EmailRenderer } from "./EmailRenderer";
import { InlineAttachmentPreview } from "./InlineAttachmentPreview";
import { AttachmentList, getAttachmentsForMessage } from "./AttachmentList";
import type { DbMessage } from "@/services/db/messages";
import type { DbAttachment } from "@/services/db/attachments";
import { MailMinus, Languages, CheckCircle2, ChevronDown } from "lucide-react";
import { AuthBadge } from "./AuthBadge";
import { AuthWarningBanner } from "./AuthWarningBanner";
import { CalendarInviteBanner } from "./CalendarInviteBanner";
import { TrackingPixelBadge } from "./TrackingPixelBadge";
import { PackageTrackingCard } from "./PackageTrackingCard";
import { CalendarSuggestions } from "./CalendarSuggestions";
import { CalendarReminderBanner } from "./CalendarReminderBanner";
import { detectInviteFromMessage, hasIcsAttachment } from "@/services/calendar/inviteDetector";
import { getGoogleReminderEvent, isGoogleCalendarReminder } from "@/services/calendar/reminderDetector";
import { detectShipmentsAndFlights } from "@/utils/trackingDetector";
import { messageHasContract, stripContractMarkup } from "@/services/contracts/contractMessage";
import { ContractCard } from "./ContractCard";
import type { DetectedTracker } from "@/utils/trackingPixels";
import { spamThread } from "@/services/emailActions";

export type MessageTranslation = { status: "translating" } | { status: "ready"; text: string; visible: boolean };

interface MessageItemProps {
  message: DbMessage;
  contextMessages?: DbMessage[];
  isLast: boolean;
  blockImages?: boolean | null;
  senderAllowlisted?: boolean;
  accountId?: string;
  threadId?: string;
  isSpam?: boolean;
  focused?: boolean;
  translation?: MessageTranslation;
  onExpand?: (messageId: string) => void;
  onHideTranslation?: (messageId: string) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export const MessageItem = memo(forwardRef<HTMLDivElement, MessageItemProps>(function MessageItem({ message, contextMessages, isLast, blockImages, senderAllowlisted, accountId, threadId, isSpam, focused, translation, onExpand, onHideTranslation, onContextMenu }, ref) {
  const [expanded, setExpanded] = useState(isLast);
  const [attachments, setAttachments] = useState<DbAttachment[]>([]);
  const [attachmentsLoaded, setAttachmentsLoaded] = useState(false);
  const [authBannerDismissed, setAuthBannerDismissed] = useState(false);
  const [detectedTrackers, setDetectedTrackers] = useState<DetectedTracker[]>([]);
  const attachmentsLoadedRef = useRef(false);

  const calendarReminder = isGoogleCalendarReminder(message);
  const reminderEvent = useMemo(
    () => expanded && calendarReminder ? getGoogleReminderEvent(message) : null,
    [expanded, calendarReminder, message],
  );
  const calendarInvite = useMemo(
    () => calendarReminder ? null : detectInviteFromMessage(message, attachments),
    [calendarReminder, message, attachments],
  );
  const hasIcs = useMemo(() => hasIcsAttachment(attachments), [attachments]);

  const trackingItems = useMemo(
    () => detectShipmentsAndFlights(message.body_text || message.snippet),
    [message.body_text, message.snippet],
  );

  const showTranslation = translation?.status === "ready" && translation.visible;
  const translating = translation?.status === "translating";

  const handleReportSpam = async () => {
    const accId = accountId ?? message.account_id;
    const thrId = threadId ?? message.thread_id;
    if (accId && thrId) {
      await spamThread(accId, thrId, [], true);
    }
  };

  const loadAttachments = async () => {
    if (attachmentsLoadedRef.current) return;
    attachmentsLoadedRef.current = true;
    try {
      const atts = await getAttachmentsForMessage(message.account_id, message.id);
      setAttachments(atts);
    } catch {
      // Non-critical — just show no attachments
    } finally {
      setAttachmentsLoaded(true);
    }
  };

  // Load attachments for initially-expanded (last) message on mount
  useEffect(() => {
    if (isLast) {
      loadAttachments();
    }
  }, [isLast]); // eslint-disable-line react-hooks/exhaustive-deps

  // Open the card when the user navigates to it or requests a translation.
  useEffect(() => {
    if ((focused || translating || showTranslation) && !expanded) {
      setExpanded(true);
      loadAttachments();
    }
  }, [focused, translating, showTranslation]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggle = () => {
    const willExpand = !expanded;
    setExpanded(willExpand);
    if (willExpand) {
      onExpand?.(message.id);
      loadAttachments();
    }
  };

  // Scan HTML body for cid: references — these images are already rendered inline
  const referencedCids = useMemo(() => {
    const cids = new Set<string>();
    if (!message.body_html) return cids;
    const regex = /\bcid:([^"'\s)]+)/gi;
    let m;
    while ((m = regex.exec(message.body_html)) !== null) {
      cids.add(m[1]!);
    }
    return cids;
  }, [message.body_html]);

  const fromDisplay = message.from_name ?? message.from_address ?? "Unknown";

  return (
    <div
      ref={ref}
      data-message-card
      data-message-focused={focused || undefined}
      className={`rounded-xl border border-border-primary/60 bg-bg-primary/90 dark:bg-bg-secondary/40 shadow-xs overflow-hidden transition-all duration-150 ${
        isSpam ? "bg-red-500/8 dark:bg-red-500/10" : ""
      } ${focused ? "ring-2 ring-inset ring-accent/50" : ""}`}
      onContextMenu={onContextMenu}
    >
      {/* Header — always visible, click to expand/collapse */}
      <button
        onClick={handleToggle}
        aria-expanded={expanded}
        className="w-full text-left px-3.5 sm:px-5 py-3 sm:py-3.5 min-h-[52px] hover:bg-bg-hover/50 active:bg-bg-hover/70 transition-colors cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <div className="flex items-start sm:items-center justify-between gap-2.5 sm:gap-3">
          <div className="flex items-start sm:items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent/20 to-accent/10 text-accent font-bold text-sm flex items-center justify-center shrink-0 ring-1 ring-accent/25 shadow-xs mt-0.5 sm:mt-0">
              {fromDisplay[0]?.toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div data-message-sender-row className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
                  <span className="text-sm font-semibold text-text-primary tracking-tight truncate">
                    {fromDisplay}
                  </span>
                  {expanded && message.from_address && message.from_name && (
                    <span data-message-address-inline className="inline text-xs text-text-tertiary font-normal truncate max-w-[140px] sm:max-w-none">
                      &lt;{message.from_address}&gt;
                    </span>
                  )}
                  <AuthBadge authResults={message.auth_results} />
                  <TrackingPixelBadge trackers={detectedTrackers} />
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span data-message-date className="text-[11px] sm:text-xs font-medium text-text-tertiary whitespace-nowrap px-2 sm:px-2.5 py-0.5 rounded-md bg-bg-tertiary/40 border border-border-secondary/40">
                    {formatFullDate(message.date)}
                  </span>
                  <ChevronDown
                    size={16}
                    className={`text-text-tertiary transition-transform duration-200 shrink-0 ${expanded ? "rotate-180" : ""}`}
                  />
                </div>
              </div>
              {!expanded ? (
                <span className="text-xs text-text-tertiary truncate block mt-0.5">
                  {message.snippet}
                </span>
              ) : (
                <div className="mt-1 flex items-center gap-1.5 text-xs text-text-tertiary flex-wrap">
                  {message.from_address && message.from_name && (
                    <span className="sm:hidden text-xs text-text-tertiary font-normal truncate max-w-full block">
                      &lt;{message.from_address}&gt;
                    </span>
                  )}
                  {message.to_addresses && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-text-tertiary/75 font-medium shrink-0">to</span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-bg-tertiary/60 border border-border-secondary text-text-secondary text-[11px] font-mono max-w-full truncate">
                        {message.to_addresses}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </button>

      {/* Body — shown when expanded and image setting resolved */}
      {expanded && (
        <div data-message-body className="min-w-0 px-3.5 sm:px-5 pb-4 sm:pb-5 pt-2 border-t border-border-secondary/40">
          {!authBannerDismissed && (
            <AuthWarningBanner
              authResults={message.auth_results}
              senderAddress={message.from_address}
              onDismiss={() => setAuthBannerDismissed(true)}
              onReportSpam={handleReportSpam}
              onTrustSender={() => setAuthBannerDismissed(true)}
            />
          )}

          {calendarInvite && (
            <CalendarInviteBanner message={message} invite={calendarInvite} />
          )}

          {calendarReminder && (
            <CalendarReminderBanner key={message.id} accountId={message.account_id} event={reminderEvent} />
          )}
          {attachmentsLoaded && !calendarInvite && !calendarReminder && !hasIcs && <CalendarSuggestions message={message} context={contextMessages} />}

          {trackingItems.length > 0 && (
            <PackageTrackingCard items={trackingItems} />
          )}

          {message.list_unsubscribe && (
            <div className="mb-2">
              <UnsubscribeLink
                header={message.list_unsubscribe}
                postHeader={message.list_unsubscribe_post}
                accountId={accountId ?? message.account_id}
                threadId={threadId ?? message.thread_id}
                fromAddress={message.from_address}
                fromName={message.from_name}
              />
            </div>
          )}

          {translating && <p role="status" className="mb-3 text-xs text-text-tertiary">Translating…</p>}

          {showTranslation && (
            <div className="mb-3 p-3 rounded-lg border border-accent/30 bg-accent/5 text-xs text-text-primary leading-relaxed">
              <div className="flex items-center justify-between font-semibold text-accent mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Languages size={13} />
                  <span>English Translation (AI)</span>
                </span>
                <button
                  onClick={() => onHideTranslation?.(message.id)}
                  className="text-text-tertiary hover:text-text-primary text-[11px]"
                >
                  Hide
                </button>
              </div>
              <p className="whitespace-pre-wrap">{translation.text}</p>
            </div>
          )}

          {blockImages != null ? (
            <EmailRenderer
              html={message.body_html ? stripContractMarkup(message.body_html) : null}
              text={message.body_text ? stripContractMarkup(message.body_text) : null}
              blockImages={blockImages}
              senderAddress={message.from_address}
              accountId={message.account_id}
              senderAllowlisted={senderAllowlisted}
              messageId={message.id}
              inlineAttachments={attachments.filter((a) => a.content_id)}
              onTrackersDetected={setDetectedTrackers}
            />
          ) : (
            <div className="py-8 text-center text-text-tertiary text-sm">Loading...</div>
          )}

          {messageHasContract(message.body_html, message.body_text) && (
            <ContractCard message={message} />
          )}

          <InlineAttachmentPreview
            accountId={message.account_id}
            messageId={message.id}
            attachments={attachments}
            referencedCids={referencedCids}
            onAttachmentClick={() => {}}
          />

          <AttachmentList
            accountId={message.account_id}
            messageId={message.id}
            attachments={attachments}
            referencedCids={referencedCids}
          />
        </div>
      )}
    </div>
  );
}));

export function parseUnsubscribeUrl(header: string): string | null {
  // Prefer https URL over mailto
  const httpMatch = header.match(/<(https?:\/\/[^>]+)>/);
  if (httpMatch?.[1]) return httpMatch[1];
  const mailtoMatch = header.match(/<(mailto:[^>]+)>/);
  if (mailtoMatch?.[1]) return mailtoMatch[1];
  return null;
}

function UnsubscribeLink({
  header,
  postHeader,
  accountId,
  threadId,
  fromAddress,
  fromName,
}: {
  header: string;
  postHeader?: string | null;
  accountId: string;
  threadId: string;
  fromAddress: string | null;
  fromName: string | null;
}) {
  const url = parseUnsubscribeUrl(header);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "failed">("idle");
  if (!url) return null;

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setStatus("loading");
    try {
      const { executeUnsubscribe } = await import("@/services/unsubscribe/unsubscribeManager");
      const result = await executeUnsubscribe(
        accountId,
        threadId,
        fromAddress ?? "unknown",
        fromName,
        header,
        postHeader ?? null,
      );
      setStatus(result.success ? "done" : "failed");
    } catch (err) {
      console.error("Failed to unsubscribe:", err);
      setStatus("failed");
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={status === "loading" || status === "done"}
      title={status === "done" ? "Unsubscribed" : "Unsubscribe (u)"}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-md border transition-all ${
        status === "done"
          ? "border-success/30 bg-success/10 text-success"
          : status === "failed"
            ? "border-danger/30 bg-danger/10 text-danger hover:bg-danger/15"
            : "border-border-secondary/60 hover:border-text-secondary/60 bg-transparent hover:bg-bg-tertiary/60 text-text-tertiary hover:text-text-secondary"
      }`}
    >
      {status === "done" ? <CheckCircle2 size={12} className="text-success" /> : <MailMinus size={12} />}
      {status === "loading" && "Unsubscribing..."}
      {status === "done" && "Unsubscribed"}
      {status === "failed" && "Unsubscribe failed — click to retry"}
      {status === "idle" && "Unsubscribe"}
    </button>
  );
}

