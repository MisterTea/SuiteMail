import { X } from "lucide-react";
import { useComposerStore } from "@/stores/composerStore";

/**
 * Divider and contract text under the letter.
 * Shown for a new contract and for a reply that continues one.
 */
export function ContractEditor() {
  const contractActive = useComposerStore((s) => s.contractActive);
  const contractText = useComposerStore((s) => s.contractText);
  const setContractText = useComposerStore((s) => s.setContractText);
  const setContractActive = useComposerStore((s) => s.setContractActive);

  if (!contractActive) return null;

  return (
    <div className="border-t border-border-secondary">
      <hr data-testid="contract-separator" className="mx-4 my-0 border-border-primary" />
      <div className="px-4 py-2">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <label htmlFor="suitemail-contract" className="text-xs font-semibold text-text-secondary">
            Contract
          </label>
          <button
            type="button"
            onClick={() => {
              setContractActive(false);
              setContractText("");
            }}
            className="flex items-center gap-1 text-xs text-text-tertiary hover:text-danger rounded px-1.5 py-0.5 hover:bg-danger/10 transition-colors cursor-pointer"
            title="Remove contract"
          >
            <X size={12} />
            Remove
          </button>
        </div>
        <textarea
          id="suitemail-contract"
          aria-label="Contract"
          value={contractText}
          onChange={(e) => setContractText(e.target.value)}
          placeholder="Write the contract terms. The other person can edit them and reply."
          rows={5}
          className="w-full resize-y rounded-lg border border-border-primary bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
      </div>
    </div>
  );
}
