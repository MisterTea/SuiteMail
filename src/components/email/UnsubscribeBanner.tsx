import { useState, useEffect } from "react";
import {
  BellOff,
  MailMinus,
  CheckCircle2,
  Loader2,
  AlertCircle,
  X,
  ExternalLink,
} from "lucide-react";
import {
  executeUnsubscribe,
  parseUnsubscribeHeaders,
  getUnsubscribeStatus,
} from "@/services/unsubscribe/unsubscribeManager";
import { platformOpenUrl as openUrl } from "@/platform";
import { insertFilter } from "@/services/db/filters";
import type { DbMessage } from "@/services/db/messages";

export interface UnsubscribeBannerProps {
  accountId: string;
  threadId: string;
  message: DbMessage;
  onAutoArchive?: () => void;
  onDismiss?: () => void;
  className?: string;
}

export function UnsubscribeBanner({
  accountId,
  threadId,
  message,
  onAutoArchive,
  onDismiss,
  className = "",
}: UnsubscribeBannerProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "failed">("idle");
  const [autoArchiveFuture, setAutoArchiveFuture] = useState(true);
  const [isArchiving, setIsArchiving] = useState(false);
  const [archived, setArchived] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const header = message.list_unsubscribe;
  const postHeader = message.list_unsubscribe_post;
  const fromAddress = message.from_address;
  const fromName = message.from_name;
  const senderDisplay = fromName || fromAddress || "this mailing list";

  // Check if sender was already recorded as unsubscribed
  useEffect(() => {
    if (!accountId || !fromAddress) return;
    let cancelled = false;
    getUnsubscribeStatus(accountId, fromAddress).then((savedStatus) => {
      if (!cancelled && savedStatus === "unsubscribed") {
        setStatus("done");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, fromAddress]);

  if (!header || dismissed) return null;

  const parsed = parseUnsubscribeHeaders(header, postHeader ?? null);

  const handleUnsubscribe = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (status === "loading" || status === "done") return;
    setStatus("loading");

    try {
      const result = await executeUnsubscribe(
        accountId,
        threadId,
        fromAddress ?? "unknown",
        fromName,
        header,
        postHeader ?? null,
      );

      if (result.success) {
        setStatus("done");

        // Optionally create an automatic archive filter for future emails from this sender
        if (autoArchiveFuture && fromAddress) {
          try {
            await insertFilter({
              accountId,
              name: `Auto-archive: ${senderDisplay}`,
              criteria: { from: fromAddress },
              actions: { archive: true },
              isEnabled: true,
            });
          } catch (err) {
            console.warn("Could not insert auto-archive filter:", err);
          }
        }
      } else {
        setStatus("failed");
      }
    } catch (err) {
      console.error("Failed to execute unsubscribe:", err);
      setStatus("failed");
    }
  };

  const handleArchiveNow = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (isArchiving || archived) return;
    setIsArchiving(true);
    try {
      if (onAutoArchive) {
        onAutoArchive();
      }
      setArchived(true);
    } catch (err) {
      console.error("Failed to archive:", err);
    } finally {
      setIsArchiving(false);
    }
  };

  const handleOpenFallbackUrl = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (parsed.httpUrl) {
      try {
        await openUrl(parsed.httpUrl);
      } catch (err) {
        console.error("Failed to open unsubscribe link:", err);
      }
    }
  };

  const handleDismiss = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setDismissed(true);
    onDismiss?.();
  };

  return (
    <div
      role="region"
      aria-label="Newsletter Unsubscribe"
      className={`border-b border-border-primary/60 bg-bg-secondary/45 dark:bg-bg-secondary/25 backdrop-blur-xs px-3.5 sm:px-6 py-2.5 sm:py-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 sm:gap-3 text-xs text-text-secondary transition-all ${className}`}
    >
      {/* Idle / Unsubscribed state */}
      {status === "idle" && (
        <>
          <div className="flex items-start sm:items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-6 h-6 rounded-md bg-bg-tertiary/60 border border-border-secondary/40 text-text-tertiary shrink-0 mt-0.5 sm:mt-0">
              <BellOff size={13} />
            </span>
            <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
              <span className="text-text-secondary line-clamp-2 sm:truncate">
                This email is from a mailing list or newsletter
                {fromDisplay(fromName, fromAddress) && (
                  <span className="text-text-tertiary ml-1">
                    ({fromDisplay(fromName, fromAddress)})
                  </span>
                )}
              </span>
              {parsed.hasOneClick && (
                <span
                  title="Supports RFC 8058 instant one-click unsubscribe"
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono tracking-tight text-text-tertiary bg-bg-tertiary/70 border border-border-secondary/40 shrink-0"
                >
                  1-Click
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleUnsubscribe}
              title="Unsubscribe (u)"
              className="inline-flex items-center justify-center flex-1 sm:flex-initial min-h-[44px] sm:min-h-0 gap-1.5 px-3.5 sm:px-2.5 py-2 sm:py-1 text-xs font-semibold sm:font-medium rounded-xl sm:rounded-md border border-border-secondary hover:border-text-secondary/60 bg-bg-surface/80 hover:bg-bg-tertiary text-text-primary transition-all shadow-2xs hover:shadow-xs active:scale-[0.96] touch-manipulation cursor-pointer"
            >
              <MailMinus size={14} className="text-text-tertiary shrink-0" />
              <span>Unsubscribe</span>
              <kbd className="hidden sm:inline-block ml-0.5 px-1 py-0.2 text-[10px] font-mono text-text-tertiary bg-bg-tertiary/90 rounded border border-border-secondary/50">
                u
              </kbd>
            </button>

            <button
              type="button"
              onClick={handleDismiss}
              title="Dismiss banner"
              aria-label="Dismiss banner"
              className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-2 sm:p-1 rounded-xl sm:rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary/80 active:scale-90 transition-all shrink-0 touch-manipulation cursor-pointer"
            >
              <X size={15} />
            </button>
          </div>
        </>
      )}

      {/* Loading state */}
      {status === "loading" && (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between w-full gap-2 sm:gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-6 h-6 rounded-md bg-bg-tertiary/60 border border-border-secondary/40 text-text-tertiary shrink-0">
              <Loader2 size={13} className="animate-spin text-accent" />
            </span>
            <span className="text-text-secondary line-clamp-2 sm:truncate">
              Unsubscribing from <strong className="font-medium text-text-primary">{senderDisplay}</strong>...
            </span>
          </div>
          <button
            type="button"
            disabled
            title="Unsubscribing..."
            className="inline-flex items-center justify-center min-h-[38px] sm:min-h-0 gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-border-secondary/50 bg-bg-tertiary/40 text-text-tertiary cursor-not-allowed shrink-0"
          >
            <Loader2 size={12} className="animate-spin" />
            <span>Unsubscribing...</span>
          </button>
        </div>
      )}

      {/* Success / Done feedback state */}
      {status === "done" && (
        <>
          <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-wrap">
            <span className="flex items-center justify-center w-6 h-6 rounded-md bg-success/15 border border-success/30 text-success shrink-0 shadow-2xs mt-0.5 sm:mt-0">
              <CheckCircle2 size={14} />
            </span>
            <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 min-w-0 flex-1">
              <span className="font-medium text-text-primary line-clamp-2 sm:truncate">
                Unsubscribed from {senderDisplay}
              </span>
              <label className="inline-flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary cursor-pointer select-none transition-colors">
                <input
                  type="checkbox"
                  checked={autoArchiveFuture}
                  onChange={(e) => setAutoArchiveFuture(e.target.checked)}
                  className="rounded border-border-secondary text-accent focus:ring-accent/40 w-4 h-4 sm:w-3.5 sm:h-3.5 cursor-pointer shrink-0"
                />
                <span>Auto-archive future emails from this sender</span>
              </label>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onAutoArchive && !archived && (
              <button
                type="button"
                onClick={handleArchiveNow}
                disabled={isArchiving}
                title="Archive newsletter thread now"
                className="inline-flex items-center justify-center flex-1 sm:flex-initial min-h-[38px] sm:min-h-0 gap-1 px-3 sm:px-2.5 py-1.5 sm:py-1 text-xs font-medium rounded-md bg-accent text-accent-contrast hover:bg-accent/90 transition-all shadow-2xs active:scale-[0.98]"
              >
                {isArchiving ? "Archiving..." : "Archive now"}
              </button>
            )}
            {archived && (
              <span className="text-xs text-text-tertiary font-medium">
                Archived
              </span>
            )}
            <button
              type="button"
              onClick={handleDismiss}
              title="Dismiss"
              aria-label="Dismiss confirmation"
              className="inline-flex items-center justify-center min-h-[38px] sm:min-h-0 px-3 sm:px-2 py-1.5 sm:py-1 text-xs text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary/80 rounded-md transition-colors"
            >
              Done
            </button>
          </div>
        </>
      )}

      {/* Failed state */}
      {status === "failed" && (
        <>
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-6 h-6 rounded-md bg-warning/15 border border-warning/30 text-warning shrink-0">
              <AlertCircle size={13} />
            </span>
            <span className="text-text-secondary line-clamp-2 sm:truncate">
              Could not automatically unsubscribe from {senderDisplay}.
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {parsed.httpUrl && (
              <button
                type="button"
                onClick={handleOpenFallbackUrl}
                title="Open unsubscribe website"
                className="inline-flex items-center justify-center flex-1 sm:flex-initial min-h-[38px] sm:min-h-0 gap-1 px-3 sm:px-2.5 py-1.5 sm:py-1 text-xs font-medium rounded-md border border-border-secondary hover:border-text-secondary/60 bg-bg-surface/80 hover:bg-bg-tertiary text-text-primary transition-colors shadow-2xs"
              >
                <span>Open page</span>
                <ExternalLink size={12} className="text-text-tertiary" />
              </button>
            )}

            <button
              type="button"
              onClick={handleUnsubscribe}
              title="Unsubscribe (retry)"
              className="inline-flex items-center justify-center flex-1 sm:flex-initial min-h-[38px] sm:min-h-0 gap-1 px-3 sm:px-2.5 py-1.5 sm:py-1 text-xs font-medium rounded-md bg-bg-tertiary hover:bg-bg-tertiary/80 text-text-primary transition-colors"
            >
              Retry
            </button>

            <button
              type="button"
              onClick={handleDismiss}
              title="Dismiss banner"
              aria-label="Dismiss banner"
              className="inline-flex items-center justify-center min-h-[38px] min-w-[38px] sm:min-h-0 sm:min-w-0 p-1.5 sm:p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary/80 transition-colors shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function fromDisplay(name: string | null, address: string | null): string {
  if (name && address) return name;
  if (name) return name;
  if (address) return address;
  return "";
}
