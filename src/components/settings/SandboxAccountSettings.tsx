import { useEffect, useState } from "react";
import { getAllAccounts } from "@/services/db/accounts";
import { SANDBOX_ID, sandboxIsEnabled, setSandboxEnabled } from "@/services/email/sandbox";
import { useAccountStore } from "@/stores/accountStore";
import { navigateToLabel } from "@/router/navigate";

export function SandboxAccountSettings() {
  const accountsInStore = useAccountStore((state) => state.accounts);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void sandboxIsEnabled().then(setEnabled).catch(() => {}); }, [accountsInStore]);
  const toggle = async () => {
    setBusy(true); setError("");
    try {
      await setSandboxEnabled(!enabled);
      const accounts = await getAllAccounts();
      const store = useAccountStore.getState();
      store.setAccounts(accounts.map((a) => ({ id: a.id, email: a.email, displayName: a.display_name, avatarUrl: a.avatar_url, provider: a.provider, isActive: a.is_active === 1 })), !enabled ? SANDBOX_ID : store.activeAccountId);
      if (!enabled) { store.setActiveAccount(SANDBOX_ID); navigateToLabel("inbox"); }
      else if (useAccountStore.getState().activeAccountId) store.setActiveAccount(useAccountStore.getState().activeAccountId!);
      setEnabled(!enabled);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  return <section className="mb-6 space-y-2" aria-label="Sandbox account">
    <div className="flex items-center justify-between gap-3">
      <div><h3 className="text-sm font-medium">Sandbox account</h3>
        <p className="text-xs text-text-secondary">Try features with 75 generated emails. Sending stays local and gets one automatic reply per conversation. Disabling keeps your sandbox mail.</p></div>
      <button type="button" role="switch" aria-checked={enabled} aria-label="Enable sandbox account" disabled={busy} onClick={() => void toggle()} className="inline-flex shrink-0 items-center justify-center">
        <span aria-hidden="true" className={`relative w-10 h-5 rounded-full ${enabled ? "bg-accent" : "bg-bg-tertiary"}`}><span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white ${enabled ? "translate-x-5" : ""}`} /></span>
      </button>
    </div>
    {busy && <p role="status" className="text-xs">Updating sandbox…</p>}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </section>;
}
