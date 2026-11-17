import { useState, useMemo } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { parseCsv, interpolateMergeText, type ParsedCsv } from "@/utils/csvMailMerge";
import { Upload, ChevronLeft, ChevronRight, CheckCircle2, AlertCircle } from "lucide-react";
import { sendEmail } from "@/services/emailActions";
import { buildRawEmail } from "@/utils/emailBuilder";
import { getAccount } from "@/services/db/accounts";
import { useAccountStore } from "@/stores/accountStore";

export interface MailMergeModalProps {
  isOpen: boolean;
  onClose: () => void;
  subjectTemplate: string;
  bodyHtmlTemplate: string;
  onCampaignComplete?: (totalSent: number) => void;
}

export function MailMergeModal({
  isOpen,
  onClose,
  subjectTemplate,
  bodyHtmlTemplate,
  onCampaignComplete,
}: MailMergeModalProps) {
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const [csvRaw, setCsvRaw] = useState("");
  const [previewIndex, setPreviewIndex] = useState(0);
  const [delayMs, setDelayMs] = useState(200);
  const [isSending, setIsSending] = useState(false);
  const [sendProgress, setSendProgress] = useState<{ current: number; total: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sentCount, setSentCount] = useState<number | null>(null);

  const parsed: ParsedCsv = useMemo(() => {
    return parseCsv(csvRaw);
  }, [csvRaw]);

  const emailCol = parsed.emailColumn;
  const validRows = useMemo(() => {
    if (!emailCol) return [];
    return parsed.rows.filter((r) => (r[emailCol] ?? "").includes("@"));
  }, [parsed, emailCol]);

  const currentPreviewRow = validRows[previewIndex];

  const previewSubject = useMemo(() => {
    if (!currentPreviewRow) return subjectTemplate;
    return interpolateMergeText(subjectTemplate, currentPreviewRow, false);
  }, [subjectTemplate, currentPreviewRow]);

  const previewBody = useMemo(() => {
    if (!currentPreviewRow) return bodyHtmlTemplate;
    return interpolateMergeText(bodyHtmlTemplate, currentPreviewRow, true);
  }, [bodyHtmlTemplate, currentPreviewRow]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setCsvRaw(content);
        setPreviewIndex(0);
        setErrorMsg(null);
      }
    };
    reader.readAsText(file);
  };

  const handleSendCampaign = async () => {
    if (!activeAccountId || validRows.length === 0 || !emailCol) return;
    setIsSending(true);
    setErrorMsg(null);
    setSendProgress({ current: 0, total: validRows.length });

    let sent = 0;
    try {
      const account = await getAccount(activeAccountId);
      if (!account) throw new Error("Account not found");

      for (let i = 0; i < validRows.length; i++) {
        const row = validRows[i];
        if (!row) continue;
        const recipientEmail = row[emailCol]?.trim();
        if (!recipientEmail || !recipientEmail.includes("@")) continue;

        const renderedSubject = interpolateMergeText(subjectTemplate, row, false);
        const renderedBody = interpolateMergeText(bodyHtmlTemplate, row, false);

        const raw = buildRawEmail({
          from: account.email,
          to: [recipientEmail],
          subject: renderedSubject,
          htmlBody: renderedBody,
        });

        await sendEmail(activeAccountId, raw);

        sent++;
        setSendProgress({ current: sent, total: validRows.length });

        if (delayMs > 0 && i < validRows.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }

      setSentCount(sent);
      onCampaignComplete?.(sent);
    } catch (err) {
      console.error("Mail merge campaign error:", err);
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={isSending ? () => {} : onClose} title="Mail Merge Campaign" zIndex="z-[60]" width="w-[600px]">
      <div className="space-y-4 py-1 text-xs">
        {sentCount !== null ? (
          <div className="py-8 text-center space-y-3">
            <CheckCircle2 size={36} className="text-success mx-auto" />
            <div className="text-sm font-semibold text-text-primary">Campaign Completed!</div>
            <p className="text-text-tertiary">
              Successfully sent {sentCount} personalized email{sentCount === 1 ? "" : "s"}.
            </p>
            <Button variant="primary" size="md" onClick={onClose} className="mt-2">
              Done
            </Button>
          </div>
        ) : (
          <>
            {/* Step 1: Upload or paste CSV */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-medium text-text-secondary">Recipients CSV</span>
                <label className="cursor-pointer text-accent hover:text-accent-hover font-medium flex items-center gap-1">
                  <Upload size={12} />
                  Upload .csv
                  <input type="file" accept=".csv,text/csv" onChange={handleFileUpload} className="hidden" />
                </label>
              </div>
              <textarea
                value={csvRaw}
                onChange={(e) => {
                  setCsvRaw(e.target.value);
                  setPreviewIndex(0);
                }}
                placeholder="Paste CSV here (e.g. Email, Name, Company)..."
                rows={3}
                className="w-full bg-bg-tertiary border border-border-primary rounded-lg p-2 font-mono text-[0.7rem] text-text-primary focus:border-accent outline-none"
              />
            </div>

            {/* Merge Tags / Summary */}
            {parsed.headers.length > 0 && (
              <div className="p-3 bg-bg-secondary rounded-lg border border-border-primary space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-text-primary">
                    Found {validRows.length} valid recipient{validRows.length === 1 ? "" : "s"}
                  </span>
                  {emailCol && (
                    <span className="text-[0.65rem] text-text-tertiary">
                      Email column: <span className="font-mono text-accent">{emailCol}</span>
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1 items-center">
                  <span className="text-text-tertiary text-[0.65rem] mr-1">Available tags:</span>
                  {parsed.headers.map((h) => (
                    <span key={h} className="px-1.5 py-0.5 rounded bg-bg-tertiary text-[0.65rem] font-mono text-text-secondary border border-border-primary">
                      {`{{${h}}}`}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Step 2: Live Preview */}
            {validRows.length > 0 && currentPreviewRow && (
              <div className="space-y-2 border border-border-primary rounded-lg p-3 bg-bg-tertiary/40">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-text-secondary">
                    Preview ({previewIndex + 1} of {validRows.length})
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setPreviewIndex((i) => Math.max(0, i - 1))}
                      disabled={previewIndex === 0}
                      className="p-1 rounded hover:bg-bg-hover text-text-secondary disabled:opacity-30"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewIndex((i) => Math.min(validRows.length - 1, i + 1))}
                      disabled={previewIndex >= validRows.length - 1}
                      className="p-1 rounded hover:bg-bg-hover text-text-secondary disabled:opacity-30"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
                <div className="text-[0.7rem] text-text-tertiary font-mono">
                  To: {currentPreviewRow[emailCol!]}
                </div>
                <div className="font-medium text-text-primary text-xs">
                  {previewSubject || "(No Subject)"}
                </div>
                <div
                  className="max-h-24 overflow-y-auto p-2 bg-bg-secondary rounded border border-border-primary text-text-secondary text-[0.7rem]"
                  dangerouslySetInnerHTML={{ __html: previewBody }}
                />
              </div>
            )}

            {/* Delay & Send Action */}
            <div className="flex items-center justify-between pt-2 border-t border-border-primary">
              <div className="flex items-center gap-2">
                <span className="text-text-tertiary text-[0.7rem]">Throttle:</span>
                <select
                  value={delayMs}
                  onChange={(e) => setDelayMs(Number(e.target.value))}
                  disabled={isSending}
                  className="bg-bg-tertiary text-text-primary border border-border-primary rounded px-2 py-1 text-[0.7rem]"
                >
                  <option value={100}>100ms</option>
                  <option value={200}>200ms (Recommended)</option>
                  <option value={500}>500ms</option>
                  <option value={1000}>1 second</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={onClose} disabled={isSending}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSendCampaign}
                  disabled={isSending || validRows.length === 0}
                >
                  {isSending
                    ? `Sending (${sendProgress?.current}/${sendProgress?.total})...`
                    : `Send to ${validRows.length} Recipient${validRows.length === 1 ? "" : "s"}`}
                </Button>
              </div>
            </div>

            {/* Error banner */}
            {errorMsg && (
              <div className="p-2.5 rounded bg-danger/10 border border-danger/30 text-danger text-[0.7rem] flex items-center gap-1.5">
                <AlertCircle size={14} className="shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
