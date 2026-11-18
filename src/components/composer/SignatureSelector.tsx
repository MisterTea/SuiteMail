import { useState, useEffect } from "react";
import { useComposerStore } from "@/stores/composerStore";
import { useAccountStore } from "@/stores/accountStore";
import {
  getSignaturesForAccount,
  type DbSignature,
} from "@/services/db/signatures";

export function SignatureSelector() {
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const isOpen = useComposerStore((s) => s.isOpen);
  const signatureId = useComposerStore((s) => s.signatureId);
  const setSignatureHtml = useComposerStore((s) => s.setSignatureHtml);
  const setSignatureId = useComposerStore((s) => s.setSignatureId);
  const [signatures, setSignatures] = useState<DbSignature[]>([]);

  useEffect(() => {
    if (!isOpen || !activeAccountId) return;
    let cancelled = false;
    getSignaturesForAccount(activeAccountId).then((sigs) => {
      if (!cancelled) setSignatures(sigs);
    });
    return () => { cancelled = true; };
  }, [isOpen, activeAccountId]);

  if (signatures.length === 0) return null;

  const handleChange = (id: string) => {
    if (id === "") {
      setSignatureId(null);
      setSignatureHtml("");
      return;
    }
    const sig = signatures.find((s) => s.id === id);
    if (sig) {
      setSignatureId(sig.id);
      setSignatureHtml(sig.body_html);
    }
  };

  return (
    <select
      value={signatureId ?? ""}
      onChange={(e) => handleChange(e.target.value)}
      aria-label="Select signature"
      className="text-xs bg-bg-tertiary/60 hover:bg-bg-tertiary text-text-secondary hover:text-text-primary border border-border-primary/60 rounded-md px-2 py-1.5 sm:py-1 min-h-[38px] sm:min-h-0 max-w-[96px] sm:max-w-[140px] truncate shrink-0 outline-none transition-colors cursor-pointer"
    >
      <option value="">No signature</option>
      {signatures.map((sig) => (
        <option key={sig.id} value={sig.id}>
          {sig.name}
        </option>
      ))}
    </select>
  );
}
