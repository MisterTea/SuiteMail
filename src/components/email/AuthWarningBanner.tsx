import { useState } from "react";
import { ShieldAlert, X, Ban, FolderMinus, ShieldCheck, ChevronDown, ChevronUp } from "lucide-react";
import type { AuthResult } from "@/services/gmail/authParser";

export interface AuthWarningBannerProps {
  authResults: string | null;
  senderAddress: string | null;
  onDismiss: () => void;
  onReportSpam?: () => void;
  onTrustSender?: () => void;
}

export function AuthWarningBanner({
  authResults,
  senderAddress,
  onDismiss,
  onReportSpam,
  onTrustSender,
}: AuthWarningBannerProps) {
  const [showDetails, setShowDetails] = useState(false);

  if (!authResults) return null;

  let parsed: AuthResult;
  try {
    parsed = JSON.parse(authResults) as AuthResult;
  } catch {
    return null;
  }

  if (parsed.aggregate !== "fail") return null;

  const sender = senderAddress ?? "this sender";

  return (
    <div
      role="alert"
      className="relative overflow-hidden rounded-xl border border-red-500/30 bg-gradient-to-r from-red-500/10 via-rose-500/5 to-amber-500/5 dark:from-red-950/40 dark:via-rose-950/25 dark:to-amber-950/15 p-3 sm:p-3.5 mb-3 shadow-xs border-l-4 border-l-danger transition-all"
    >
      <div className="flex items-start gap-2.5 sm:gap-3.5">
        <div className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-danger/15 text-danger border border-danger/25 shrink-0 shadow-xs mt-0.5">
          <ShieldAlert size={20} className="text-danger" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h4 className="text-sm font-semibold text-danger tracking-tight">
              Authentication failed
            </h4>
            <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-danger/15 text-danger border border-danger/25">
              Phishing Risk
            </span>
          </div>

          <p className="text-xs text-text-secondary leading-relaxed">
            This message from <span className="font-mono font-medium text-text-primary px-1 py-0.5 rounded bg-bg-surface/80 border border-border/40 text-[11px] break-all sm:break-normal">{sender}</span> failed email authentication checks (SPF/DKIM/DMARC). It may be spoofed to steal credentials, account passwords, or sensitive personal data. Be cautious with any links or attachments.
          </p>

          {/* Action buttons */}
          <div className="mt-3 flex items-center gap-2 flex-wrap pt-1">
            <button
              onClick={onReportSpam}
              title="Report Spam (!)"
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 flex-1 sm:flex-initial text-xs font-semibold rounded-xl sm:rounded-md text-white bg-danger hover:bg-red-700 active:scale-95 shadow-xs transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-danger/40 whitespace-nowrap touch-manipulation"
            >
              <Ban size={14} />
              Report Spam
            </button>

            {onReportSpam && (
              <button
                onClick={onReportSpam}
                title="Move to Spam"
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 flex-1 sm:flex-initial text-xs font-medium rounded-xl sm:rounded-md text-danger hover:bg-danger/10 border border-danger/30 active:scale-95 transition-all cursor-pointer whitespace-nowrap touch-manipulation"
              >
                <FolderMinus size={14} />
                Move to Spam
              </button>
            )}

            <button
              onClick={onTrustSender ?? onDismiss}
              title="I trust this sender"
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 flex-1 sm:flex-initial text-xs font-medium rounded-xl sm:rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-hover border border-border active:scale-95 transition-all cursor-pointer whitespace-nowrap touch-manipulation"
            >
              <ShieldCheck size={14} />
              I trust this sender
            </button>

            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              className="w-full sm:w-auto justify-center sm:justify-start min-h-[36px] sm:min-h-0 py-1.5 sm:py-0 text-xs text-text-tertiary hover:text-text-secondary active:scale-95 transition-all underline-offset-2 hover:underline sm:ml-auto inline-flex items-center gap-1 touch-manipulation cursor-pointer"
            >
              <span>{showDetails ? "Hide technical details" : "Why was this flagged?"}</span>
              {showDetails ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          </div>

          {/* Expandable technical details */}
          {showDetails && (
            <div className="mt-3 pt-3 border-t border-danger/15 flex items-center gap-2 flex-wrap text-[11px]">
              <span className="text-text-tertiary font-medium">Verification Status:</span>
              <span className={`px-2 py-0.5 rounded font-mono ${parsed.spf.result === "pass" ? "bg-success/15 text-success" : "bg-danger/15 text-danger font-medium"}`}>
                SPF: {parsed.spf.result}
              </span>
              <span className={`px-2 py-0.5 rounded font-mono ${parsed.dkim.result === "pass" ? "bg-success/15 text-success" : "bg-danger/15 text-danger font-medium"}`}>
                DKIM: {parsed.dkim.result}
              </span>
              <span className={`px-2 py-0.5 rounded font-mono ${parsed.dmarc.result === "pass" ? "bg-success/15 text-success" : "bg-danger/15 text-danger font-medium"}`}>
                DMARC: {parsed.dmarc.result}
              </span>
            </div>
          )}
        </div>

        <button
          onClick={onDismiss}
          className="shrink-0 p-1 rounded-md hover:bg-danger/15 text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
          aria-label="Dismiss warning"
          title="Dismiss warning"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}

// Alias for generic SecurityBanner usage
export const SecurityBanner = AuthWarningBanner;
