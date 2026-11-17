import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Send,
  Mail,
  FolderInput,
  Tag,
  Trash2,
  ShieldAlert,
  AlertTriangle,
  X,
  Check,
} from "lucide-react";
import { useConsentStore } from "@/services/ai/consent/consentStore";
import { Button } from "@/components/ui/Button";

function formatDate(dateVal: string | number): string {
  try {
    const num = typeof dateVal === "string" ? parseInt(dateVal, 10) : dateVal;
    if (isNaN(num)) return String(dateVal);
    const d = new Date(num > 1e11 ? num : num * 1000);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export function AgentConsentPopover() {
  const activeRequest = useConsentStore((s) => s.activeRequest);
  const isOpen = useConsentStore((s) => s.isOpen);
  const approve = useConsentStore((s) => s.approve);
  const refuse = useConsentStore((s) => s.refuse);

  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        refuse();
      } else if (e.key === "Enter" && !e.shiftKey) {
        // Only trigger confirm if not inside an interactive element with its own Enter handling
        const target = e.target as HTMLElement;
        if (target.tagName !== "TEXTAREA" && target.tagName !== "INPUT") {
          e.preventDefault();
          approve();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    const timer = setTimeout(() => confirmBtnRef.current?.focus(), 50);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      clearTimeout(timer);
    };
  }, [isOpen, approve, refuse]);

  if (!isOpen || !activeRequest) return null;

  const { type, title, emails, affectedEmails, changes } = activeRequest;

  // Icon based on operation
  let icon = <ShieldAlert className="text-accent" size={18} />;
  if (type === "send_email") {
    icon = <Send className="text-accent" size={18} />;
  } else if (type === "batch_send_emails") {
    icon = <Mail className="text-accent" size={18} />;
  } else if (type === "move_emails") {
    icon = <FolderInput className="text-amber-500" size={18} />;
  } else if (type === "relabel_emails") {
    icon = <Tag className="text-indigo-400" size={18} />;
  } else if (type === "delete_emails") {
    icon = <Trash2 className="text-danger" size={18} />;
  }

  // Button labels
  let refuseLabel = "Cancel";
  let approveLabel = "Confirm";
  let approveVariant: "primary" | "danger" = "primary";

  if (type === "send_email") {
    refuseLabel = "Don't Send";
    approveLabel = "Send Email";
  } else if (type === "batch_send_emails") {
    const count = emails?.length ?? 0;
    refuseLabel = "Don't Send Batch";
    approveLabel = count > 1 ? `Send All (${count})` : "Send Email";
  } else if (type === "move_emails") {
    refuseLabel = "Cancel";
    approveLabel = "Move Emails";
  } else if (type === "relabel_emails") {
    refuseLabel = "Cancel";
    approveLabel = "Apply Label Changes";
  } else if (type === "delete_emails") {
    refuseLabel = "Cancel";
    approveLabel = changes?.permanent ? "Permanently Delete" : "Move to Trash";
    approveVariant = "danger";
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-consent-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 glass-backdrop backdrop-blur-sm transition-opacity"
        onClick={refuse}
      />

      {/* Popover Card */}
      <div className="relative bg-bg-primary border border-border-primary rounded-xl glass-modal shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-border-primary bg-bg-secondary">
          <div className="p-1 rounded-md bg-bg-tertiary">{icon}</div>
          <div className="flex-1 min-w-0">
            <h2
              id="agent-consent-title"
              className="text-sm font-semibold text-text-primary truncate"
            >
              {title}
            </h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">
                Requires Consent
              </span>
              <span className="text-xs text-text-tertiary">
                Refusing will stop the agent
              </span>
            </div>
          </div>
          <button
            onClick={refuse}
            aria-label="Close and refuse consent"
            className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* SINGLE EMAIL SEND */}
          {type === "send_email" && emails && emails[0] && (
            <div className="space-y-3">
              <div className="space-y-2 text-xs">
                <div className="flex items-start gap-2">
                  <span className="text-text-tertiary w-14 shrink-0 font-medium">To:</span>
                  <div className="flex flex-wrap gap-1">
                    {emails[0].to.map((addr) => (
                      <span
                        key={addr}
                        className="px-2 py-0.5 rounded bg-bg-secondary border border-border-secondary text-text-primary font-mono text-[11px]"
                      >
                        {addr}
                      </span>
                    ))}
                  </div>
                </div>

                {emails[0].cc && emails[0].cc.length > 0 && (
                  <div className="flex items-start gap-2">
                    <span className="text-text-tertiary w-14 shrink-0 font-medium">Cc:</span>
                    <div className="flex flex-wrap gap-1">
                      {emails[0].cc.map((addr) => (
                        <span
                          key={addr}
                          className="px-2 py-0.5 rounded bg-bg-secondary border border-border-secondary text-text-primary font-mono text-[11px]"
                        >
                          {addr}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {emails[0].bcc && emails[0].bcc.length > 0 && (
                  <div className="flex items-start gap-2">
                    <span className="text-text-tertiary w-14 shrink-0 font-medium">Bcc:</span>
                    <div className="flex flex-wrap gap-1">
                      {emails[0].bcc.map((addr) => (
                        <span
                          key={addr}
                          className="px-2 py-0.5 rounded bg-bg-secondary border border-border-secondary text-text-primary font-mono text-[11px]"
                        >
                          {addr}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-baseline gap-2 pt-1 border-t border-border-secondary">
                  <span className="text-text-tertiary w-14 shrink-0 font-medium">Subject:</span>
                  <span className="text-text-primary font-medium">{emails[0].subject}</span>
                </div>
              </div>

              <div>
                <span className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider block mb-1">
                  Message Content
                </span>
                <div className="p-3 rounded-lg bg-bg-secondary border border-border-secondary text-xs text-text-primary whitespace-pre-wrap font-sans max-h-48 overflow-y-auto leading-relaxed">
                  {emails[0].body || <span className="text-text-tertiary italic">(No body content)</span>}
                </div>
              </div>
            </div>
          )}

          {/* BATCH EMAIL SEND */}
          {type === "batch_send_emails" && emails && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-text-secondary pb-1 border-b border-border-secondary">
                <span>Total recipients to email:</span>
                <span className="font-semibold text-text-primary">
                  {emails.length} email{emails.length > 1 ? "s" : ""}
                </span>
              </div>

              <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                {emails.map((em, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-lg bg-bg-secondary border border-border-secondary space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-accent">
                        Email #{idx + 1}
                      </span>
                      <span className="text-[11px] font-mono text-text-tertiary truncate max-w-[200px]">
                        {em.to.join(", ")}
                      </span>
                    </div>
                    <div className="text-xs font-medium text-text-primary">
                      {em.subject}
                    </div>
                    <div className="text-[11px] text-text-secondary line-clamp-2 bg-bg-primary/50 p-1.5 rounded border border-border-secondary/50">
                      {em.body}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* MOVING EMAILS */}
          {type === "move_emails" && (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs">
                <span className="font-medium text-amber-500">What will change:</span>
                <p className="mt-1 text-text-primary">
                  Move {affectedEmails?.length ?? 0} email thread(s) to folder:{" "}
                  <span className="font-semibold underline decoration-amber-500/50">
                    {changes?.targetFolder ?? "Unknown folder"}
                  </span>
                </p>
              </div>

              {affectedEmails && affectedEmails.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">
                    Affected Emails ({affectedEmails.length})
                  </div>
                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {affectedEmails.map((aff) => (
                      <div
                        key={aff.id}
                        className="px-3 py-2 rounded-md bg-bg-secondary border border-border-secondary text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-text-primary truncate">
                            {aff.subject}
                          </span>
                          <span className="text-[10px] text-text-tertiary shrink-0">
                            {formatDate(aff.date)}
                          </span>
                        </div>
                        <div className="text-text-secondary text-[11px] truncate mt-0.5">
                          From: {aff.sender}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* RELABELING EMAILS */}
          {type === "relabel_emails" && (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-xs space-y-1.5">
                <span className="font-medium text-indigo-400">What will change:</span>
                <div className="flex flex-wrap gap-2 pt-1">
                  {changes?.addLabels && changes.addLabels.length > 0 && (
                    <div className="flex items-center gap-1 text-emerald-400 font-medium">
                      <span>Add:</span>
                      {changes.addLabels.map((l) => (
                        <span
                          key={l}
                          className="px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/30 text-[11px]"
                        >
                          +{l}
                        </span>
                      ))}
                    </div>
                  )}
                  {changes?.removeLabels && changes.removeLabels.length > 0 && (
                    <div className="flex items-center gap-1 text-danger font-medium">
                      <span>Remove:</span>
                      {changes.removeLabels.map((l) => (
                        <span
                          key={l}
                          className="px-1.5 py-0.5 rounded bg-danger/20 border border-danger/30 text-[11px]"
                        >
                          -{l}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {affectedEmails && affectedEmails.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">
                    Affected Emails ({affectedEmails.length})
                  </div>
                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {affectedEmails.map((aff) => (
                      <div
                        key={aff.id}
                        className="px-3 py-2 rounded-md bg-bg-secondary border border-border-secondary text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-text-primary truncate">
                            {aff.subject}
                          </span>
                          <span className="text-[10px] text-text-tertiary shrink-0">
                            {formatDate(aff.date)}
                          </span>
                        </div>
                        <div className="text-text-secondary text-[11px] truncate mt-0.5">
                          From: {aff.sender}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* DELETING EMAILS */}
          {type === "delete_emails" && (
            <div className="space-y-4">
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-danger/10 border border-danger/20 text-xs text-text-primary">
                <AlertTriangle className="text-danger shrink-0 mt-0.5" size={16} />
                <div>
                  <span className="font-semibold text-danger block">
                    {changes?.permanent
                      ? "Warning: Permanent Deletion"
                      : "Moving to Trash"}
                  </span>
                  <span className="text-text-secondary mt-0.5 block">
                    {changes?.permanent
                      ? `These ${affectedEmails?.length ?? 0} email thread(s) will be permanently deleted and cannot be recovered.`
                      : `These ${affectedEmails?.length ?? 0} email thread(s) will be moved to the Trash.`}
                  </span>
                </div>
              </div>

              {affectedEmails && affectedEmails.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">
                    Affected Emails ({affectedEmails.length})
                  </div>
                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {affectedEmails.map((aff) => (
                      <div
                        key={aff.id}
                        className="px-3 py-2 rounded-md bg-bg-secondary border border-border-secondary text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-text-primary truncate">
                            {aff.subject}
                          </span>
                          <span className="text-[10px] text-text-tertiary shrink-0">
                            {formatDate(aff.date)}
                          </span>
                        </div>
                        <div className="text-text-secondary text-[11px] truncate mt-0.5">
                          From: {aff.sender}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* CUSTOM MUTABLE TOOL */}
          {type === "custom" && (
            <div className="space-y-3">
              <p className="text-xs text-text-secondary">
                {activeRequest.description}
              </p>
              <div className="p-3 rounded-lg bg-bg-secondary border border-border-secondary">
                <span className="text-[10px] font-mono text-text-tertiary block mb-1">
                  Arguments:
                </span>
                <pre className="text-xs text-text-primary font-mono overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(activeRequest.args, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-border-primary bg-bg-secondary">
          <Button
            variant="secondary"
            onClick={refuse}
            className="text-xs font-medium"
          >
            {refuseLabel}
          </Button>
          <Button
            ref={confirmBtnRef}
            variant={approveVariant}
            onClick={approve}
            className="text-xs font-medium gap-1.5"
          >
            <Check size={14} />
            {approveLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
