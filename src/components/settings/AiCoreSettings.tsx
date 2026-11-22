import { useEffect, useState } from "react";
import { platformInvoke } from "@/platform";
import type { AiCoreStatus } from "@/services/ai/providers/aicoreProvider";
import { Button } from "@/components/ui/Button";

export function AiCoreSettings() {
  const [status, setStatus] = useState<AiCoreStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    platformInvoke<AiCoreStatus>("aicore_is_available")
      .then((value) => { if (active) setStatus(value); })
      .catch((err) => { if (active) setError(String(err)); });
    return () => { active = false; };
  }, []);

  const check = async (prepare: boolean) => {
    setBusy(true);
    setError("");
    try {
      setStatus(await platformInvoke<AiCoreStatus>(prepare ? "aicore_prepare" : "aicore_is_available"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return <div className="space-y-3">
    <p className="text-sm text-text-secondary">
      Uses the on-device model with FULL preference for accuracy. Android manages the model; no API key or server is needed.
    </p>
    <p role="status" className="text-xs text-text-secondary">
      {busy ? "Preparing AiCore… Model downloads may take several minutes." : error || status?.message || "Checking device support…"}
    </p>
    <div className="flex flex-wrap gap-2">
      {status?.status === "downloadable" && <Button disabled={busy} onClick={() => void check(true)}>Set up AiCore</Button>}
      <Button variant="secondary" disabled={busy} onClick={() => void check(false)}>Check availability</Button>
    </div>
  </div>;
}
