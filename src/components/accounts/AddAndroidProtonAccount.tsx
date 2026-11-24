import { useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/Modal";
import { platformInvoke } from "@/platform";
import { getAccountByEmail, insertImapAccount } from "@/services/db/accounts";
import { ANDROID_PROTON_HOST } from "@/services/proton/androidProtonBridge";
import { useAccountStore } from "@/stores/accountStore";

interface Props {
  onClose: () => void;
  onSuccess: () => void;
  onBack: () => void;
}

export function AddAndroidProtonAccount({ onClose, onSuccess, onBack }: Props) {
  const addAccount = useAccountStore((state) => state.addAccount);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [mailboxPassword, setMailboxPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await platformInvoke<{ email: string }>("proton_login", {
        email: email.trim(), password, totp: totp.trim(), mailboxPassword,
      });
      const existing = await getAccountByEmail(result.email);
      if (existing && existing.imap_host !== ANDROID_PROTON_HOST) {
        throw new Error("This email address is already connected to another account.");
      }
      const config = { host: ANDROID_PROTON_HOST, username: result.email };
      await platformInvoke("imap_test_connection", { config });
      const smtp = await platformInvoke<{ success: boolean; message: string }>("smtp_test_connection", { config });
      if (!smtp.success) throw new Error(smtp.message || "Proton SMTP verification failed.");

      if (!existing) {
        const id = crypto.randomUUID();
        const displayName = result.email.split("@")[0] || result.email;
        await insertImapAccount({
          id, email: result.email, displayName, avatarUrl: null,
          imapHost: ANDROID_PROTON_HOST, imapPort: 0, imapSecurity: "ssl",
          smtpHost: ANDROID_PROTON_HOST, smtpPort: 0, smtpSecurity: "ssl",
          authMethod: "password", password: "", imapUsername: result.email,
        });
        addAccount({ id, email: result.email, displayName, avatarUrl: null, isActive: true, provider: "imap" });
      }
      setPassword("");
      setTotp("");
      setMailboxPassword("");
      onSuccess();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const input = "block w-full rounded-md border border-border-primary bg-bg-secondary px-3 py-2 text-text-primary";

  return (
    <Modal isOpen onClose={busy ? () => {} : onClose} title="Connect Proton Mail">
      <form className="space-y-4 p-4" onSubmit={connect}>
        <p className="text-sm text-text-secondary">Sign in with your paid Proton Mail account. Bridge runs on this device.</p>
        <label className="block space-y-1 text-sm">
          <span>Proton email or username</span>
          <input className={input} autoComplete="username" autoCapitalize="none" spellCheck={false} required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Proton password</span>
          <input className={input} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Authenticator code (if enabled)</span>
          <input className={input} inputMode="numeric" autoComplete="one-time-code" value={totp} onChange={(e) => setTotp(e.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Separate mailbox password (if enabled)</span>
          <input className={input} type="password" autoComplete="off" value={mailboxPassword} onChange={(e) => setMailboxPassword(e.target.value)} />
        </label>
        {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
        <div className="flex justify-between gap-2">
          <button type="button" className="rounded-md px-3 py-2 text-text-secondary hover:bg-bg-hover" onClick={onBack} disabled={busy}>Back</button>
          <button type="submit" className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60" disabled={busy}>
            {busy ? "Connecting…" : "Connect Proton Mail"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
