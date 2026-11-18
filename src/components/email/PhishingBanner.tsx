import { useState } from "react";
import { ShieldAlert, AlertTriangle, X, Ban, ShieldCheck, ChevronDown, ChevronUp } from "lucide-react";
import type { MessageScanResult } from "@/utils/phishingDetector";

export interface PhishingBannerProps {
  scanResult: MessageScanResult;
  onTrustSender: () => void;
  onReportSpam?: () => void;
  onDismiss?: () => void;
}

export function PhishingBanner({
  scanResult,
  onTrustSender,
  onReportSpam,
  onDismiss,
}: PhishingBannerProps) {
  const [showDetails, setShowDetails] = useState(false);
  const isHigh = scanResult.maxRiskScore >= 60;

  const borderClass = isHigh
    ? "border-red-500/30 border-l-4 border-l-danger bg-gradient-to-r from-red-500/10 via-rose-500/5 to-amber-500/5 dark:from-red-950/40 dark:via-rose-950/25 dark:to-amber-950/15"
    : "border-amber-500/30 border-l-4 border-l-warning bg-gradient-to-r from-amber-500/10 via-yellow-500/5 to-orange-500/5 dark:from-amber-950/40 dark:via-yellow-950/25 dark:to-orange-950/15";

  const iconBadgeClass = isHigh
    ? "bg-danger/15 text-danger border-danger/25"
    : "bg-warning/15 text-warning border-warning/25";

  const headingColor = isHigh ? "text-danger" : "text-amber-700 dark:text-amber-400";
  const badgeColor = isHigh
    ? "bg-danger/15 text-danger border-danger/25"
    : "bg-warning/15 text-amber-700 dark:text-amber-300 border-warning/25";

  return (
    <div
      role="alert"
      className={`relative overflow-hidden rounded-xl border p-3 sm:p-3.5 mb-3 mx-3 sm:mx-4 shadow-xs transition-all ${borderClass}`}
    >
      <div className="flex items-start gap-2.5 sm:gap-3.5">
        <div className={`flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-lg border shrink-0 shadow-xs mt-0.5 ${iconBadgeClass}`}>
          {isHigh ? <ShieldAlert size={20} /> : <AlertTriangle size={20} />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h4 className={`text-sm font-semibold tracking-tight ${headingColor}`}>
              {isHigh ? "High risk" : "Suspicious"} links detected
            </h4>
            <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${badgeColor}`}>
              {isHigh ? "Critical Threat" : "Caution Advised"}
            </span>
          </div>

          <p className="text-xs text-text-secondary leading-relaxed">
            {scanResult.suspiciousLinkCount === 1
              ? "1 suspicious link found"
              : `${scanResult.suspiciousLinkCount} suspicious links found`}{" "}
            in this message. Deceptive URLs or lookalike domains may disguise credential-harvesting phishing pages. Be cautious before clicking any links.
          </p>

          {/* Action buttons */}
          <div className="mt-3 flex items-center gap-2 flex-wrap pt-1">
            {onReportSpam && (
              <button
                onClick={onReportSpam}
                title="Report Spam (!)"
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 min-h-[40px] sm:min-h-0 flex-1 sm:flex-initial text-xs font-semibold rounded-md text-white bg-danger hover:bg-red-700 shadow-xs transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-danger/40 whitespace-nowrap"
              >
                <Ban size={13} />
                Report Spam
              </button>
            )}

            <button
              onClick={onTrustSender}
              title="I trust this sender"
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 min-h-[40px] sm:min-h-0 flex-1 sm:flex-initial text-xs font-medium rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-hover border border-border transition-colors cursor-pointer whitespace-nowrap"
            >
              <ShieldCheck size={13} />
              Trust this sender
            </button>

            {scanResult.links && scanResult.links.length > 0 && (
              <button
                type="button"
                onClick={() => setShowDetails(!showDetails)}
                className="w-full sm:w-auto justify-center sm:justify-start py-1 sm:py-0 text-xs text-text-tertiary hover:text-text-secondary transition-colors underline-offset-2 hover:underline sm:ml-auto inline-flex items-center gap-1"
              >
                <span>{showDetails ? "Hide link details" : "Inspect flagged links"}</span>
                {showDetails ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            )}
          </div>

          {/* Expandable link details */}
          {showDetails && scanResult.links && (
            <div className="mt-3 pt-3 border-t border-border/40 space-y-1.5 text-[11px]">
              <span className="text-text-tertiary font-medium">Flagged Link Targets:</span>
              <ul className="list-disc list-inside space-y-1 text-text-secondary font-mono text-[11px]">
                {scanResult.links
                  .filter((l) => l.riskLevel !== "safe")
                  .map((l, i) => (
                    <li key={i} className="break-all sm:truncate max-w-full sm:max-w-md">
                      {l.url}{" "}
                      {l.triggeredRules?.length
                        ? `(${l.triggeredRules.map((r) => r.detail || r.name).join(", ")})`
                        : ""}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>

        {onDismiss && (
          <button
            onClick={onDismiss}
            className="shrink-0 p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/5 text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
            aria-label="Dismiss warning"
            title="Dismiss warning"
          >
            <X size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

// Alias for generic PhishingAlert usage
export const PhishingAlert = PhishingBanner;
