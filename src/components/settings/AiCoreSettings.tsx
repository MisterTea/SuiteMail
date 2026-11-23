import { useEffect, useRef, useState } from "react";
import { platformInvoke } from "@/platform";
import { prepareAiCore, type AiCoreStatus } from "@/services/ai/providers/aicoreProvider";
import { AiCoreDownloadConsent } from "@/components/ai/AiCoreDownloadConsent";
import { Button } from "@/components/ui/Button";

const PROGRESS_POLL_MS = 1_000;

export function AiCoreSettings() {
  const [status, setStatus] = useState<AiCoreStatus | null>(null);
  const [busy, setBusy] = useState<"setup" | "check" | null>(null);
  const [error, setError] = useState("");
  const [requiresConsent, setRequiresConsent] = useState(false);
  const requestRevision = useRef(0);
  const preparing = busy === "setup";
  const downloading = status?.status === "downloading";
  const pollProgress = preparing || (downloading && !busy);

  useEffect(() => {
    let active = true;
    const revision = requestRevision.current;
    platformInvoke<AiCoreStatus>("aicore_is_available")
      .then((value) => { if (active && requestRevision.current === revision) setStatus(value); })
      .catch((err) => { if (active && requestRevision.current === revision) setError(String(err)); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!pollProgress) return;
    let active = true;
    const revision = requestRevision.current;
    let timer = setTimeout(poll, PROGRESS_POLL_MS);

    async function poll() {
      try {
        const next = await platformInvoke<AiCoreStatus>("aicore_is_available");
        if (active && requestRevision.current === revision && (!preparing || next.status === "downloading")) {
          setStatus(next);
        }
      } catch {
        // Keep the last reported progress through a transient status-check failure.
      } finally {
        if (active && requestRevision.current === revision) timer = setTimeout(poll, PROGRESS_POLL_MS);
      }
    }

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [pollProgress, preparing]);

  const check = async (prepare: boolean, allowMeteredDownload = false) => {
    requestRevision.current++;
    setBusy(prepare ? "setup" : "check");
    setError("");
    try {
      const next = prepare ? await prepareAiCore(allowMeteredDownload) : await platformInvoke<AiCoreStatus>("aicore_is_available");
      setStatus(next);
      setRequiresConsent(prepare && next.downloadRequiresConsent === true);
    } catch (err) {
      if (prepare) setStatus(status);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      requestRevision.current++;
      setBusy(null);
    }
  };

  const progress = downloading ? status.downloadPercentage : undefined;
  const downloadedMiB = Math.floor((status?.downloadedBytes ?? 0) / (1024 * 1024));
  const progressDetail = progress !== undefined ? ` ${progress}%` : downloadedMiB > 0 ? ` ${downloadedMiB} MiB downloaded.` : "";
  const message = busy === "check" && !downloading ? "Checking device support…"
    : preparing && !downloading ? "Starting AiCore setup…"
    : status?.message || "Checking device support…";

  return <div className="space-y-3">
    <p className="text-sm text-text-secondary">
      Uses the on-device model with FULL preference for accuracy. Android manages the model; no API key or server is needed.
    </p>
    <p role="status" className="text-xs text-text-secondary">
      {error || (downloading ? `${message}${progressDetail}` : message)}
    </p>
    {!error && (preparing || downloading) && (
      <progress aria-label="AiCore model download" className="block h-2 w-full accent-accent" max={100} value={progress} />
    )}
    <div className="flex flex-wrap gap-2">
      {status?.status === "downloadable" && <Button disabled={!!busy} onClick={() => void check(true)}>Set up AiCore</Button>}
      <Button variant="secondary" disabled={!!busy} onClick={() => void check(false)}>Check availability</Button>
    </div>
    {requiresConsent && <AiCoreDownloadConsent
      onCancel={() => setRequiresConsent(false)}
      onConfirm={() => {
        setRequiresConsent(false);
        void check(true, true);
      }}
    />}
  </div>;
}
