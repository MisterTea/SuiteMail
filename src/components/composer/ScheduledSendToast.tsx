import { useEffect, useRef } from "react";
import { CSSTransition } from "react-transition-group";
import { CheckCircle2, X, ExternalLink } from "lucide-react";
import { useComposerStore } from "@/stores/composerStore";
import { deleteScheduledEmail } from "@/services/db/scheduledEmails";
import { navigateToLabel } from "@/router/navigate";

const AUTO_DISMISS_SECONDS = 6;

export function ScheduledSendToast() {
  const { scheduledToast, setScheduledToast, openComposer } = useComposerStore();
  const toastRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!scheduledToast) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    timerRef.current = setTimeout(() => {
      setScheduledToast(null);
    }, AUTO_DISMISS_SECONDS * 1000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [scheduledToast, setScheduledToast]);

  const handleUndo = async () => {
    if (!scheduledToast) return;
    if (timerRef.current) clearTimeout(timerRef.current);

    const toastData = scheduledToast;
    setScheduledToast(null);

    try {
      if (toastData.id) {
        await deleteScheduledEmail(toastData.id);
      }
    } catch (err) {
      console.warn("Failed to delete scheduled email on undo:", err);
    }

    if (toastData.savedDraft) {
      openComposer({
        to: toastData.savedDraft.to,
        cc: toastData.savedDraft.cc,
        bcc: toastData.savedDraft.bcc,
        subject: toastData.savedDraft.subject,
        bodyHtml: toastData.savedDraft.bodyHtml,
        threadId: toastData.savedDraft.threadId,
        inReplyToMessageId: toastData.savedDraft.inReplyToMessageId,
        contractActive: toastData.savedDraft.contractActive,
        contractText: toastData.savedDraft.contractText,
      });
    }
  };

  const handleViewInOutbox = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setScheduledToast(null);
    navigateToLabel("drafts");
  };

  const handleDismiss = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setScheduledToast(null);
  };

  const isVisible = Boolean(scheduledToast);

  return (
    <CSSTransition
      nodeRef={toastRef}
      in={isVisible}
      timeout={200}
      classNames="toast"
      unmountOnExit
    >
      <div
        ref={toastRef}
        role="status"
        aria-live="polite"
        className="fixed bottom-[calc(max(5.5rem,4.5rem+env(safe-area-inset-bottom,0px)))] md:bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100vw-1.5rem)] sm:w-auto sm:max-w-xl bg-text-primary text-bg-primary rounded-2xl sm:rounded-xl shadow-2xl overflow-hidden border border-border-primary/20 backdrop-blur-md transition-all"
      >
        <div className="px-3.5 sm:px-4 py-2.5 sm:py-3 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 sm:gap-3">
          {/* Status icon & chip */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 sm:w-6 sm:h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shadow-2xs">
              <CheckCircle2 size={16} />
            </div>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[0.68rem] font-semibold bg-white/10 text-white tracking-wide uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Scheduled
            </span>
          </div>

          {/* Delivery description */}
          <div className="flex flex-col min-w-0 flex-1 pr-1">
            <div className="text-xs sm:text-xs font-medium text-white truncate">
              {scheduledToast ? `Delivery scheduled for ${scheduledToast.formattedTime}` : "Email scheduled"}
            </div>
            {scheduledToast?.recurrenceRule && scheduledToast.recurrenceRule !== "none" && (
              <span className="text-[0.68rem] text-white/70 truncate">
                Repeats {scheduledToast.recurrenceRule}
              </span>
            )}
          </div>

          {/* Action buttons with minimum 44-48px touch targets */}
          <div className="flex items-center gap-1 sm:gap-1.5 pl-2 border-l border-white/15 shrink-0 ml-auto sm:ml-0">
            <button
              type="button"
              onClick={handleViewInOutbox}
              className="min-h-[44px] px-2.5 py-1.5 text-xs font-semibold text-white/90 hover:text-white active:bg-white/10 rounded-lg transition-colors touch-manipulation flex items-center gap-1"
            >
              <span>View in Outbox</span>
              <ExternalLink size={12} className="opacity-70" />
            </button>
            <button
              type="button"
              onClick={handleUndo}
              className="min-h-[44px] px-2.5 py-1.5 text-xs font-semibold text-accent hover:text-accent-hover active:bg-white/10 rounded-lg transition-colors touch-manipulation flex items-center"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              title="Dismiss"
              aria-label="Dismiss"
              className="min-h-[44px] min-w-[44px] p-2 rounded-lg text-white/60 hover:text-white active:bg-white/10 transition-colors touch-manipulation flex items-center justify-center"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Countdown progress bar */}
        <div className="h-0.5 bg-white/15">
          <div
            className="h-full bg-accent rounded-full"
            style={{ animation: `countdownBar ${AUTO_DISMISS_SECONDS}s linear forwards` }}
          />
        </div>
      </div>
    </CSSTransition>
  );
}
