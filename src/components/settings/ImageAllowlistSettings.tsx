import { useEffect, useState } from "react";
import type { Account } from "@/stores/accountStore";
import {
  addImageAllowlistChangeListener,
  addToAllowlist,
  getAllowlistForAccount,
  removeFromAllowlist,
  type AllowlistEntry,
} from "@/services/db/imageAllowlist";
import { Button } from "../ui/Button";

interface ImageAllowlistSettingsProps {
  accounts: Account[];
  activeAccountId: string | null;
}

export function ImageAllowlistSettings({ accounts, activeAccountId }: ImageAllowlistSettingsProps) {
  const mailAccounts = accounts.filter((account) => account.provider !== "caldav");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const account = mailAccounts.find(({ id }) => id === (selectedAccountId ?? activeAccountId)) ?? mailAccounts[0];
  if (!account) return null;

  return (
    <div className="space-y-2 text-sm">
      <h4 className="font-medium text-text-primary">Trusted image senders</h4>
      <label className="flex flex-wrap items-center gap-2 text-text-secondary">
        Mailbox
        <select
          value={account.id}
          onChange={(event) => setSelectedAccountId(event.target.value)}
          className="max-w-full rounded-md border border-border-primary bg-bg-tertiary p-2"
        >
          {mailAccounts.map(({ id, email }) => <option key={id} value={id}>{email}</option>)}
        </select>
      </label>
      <TrustedSenders key={account.id} accountId={account.id} />
    </div>
  );
}

function TrustedSenders({ accountId }: { accountId: string }) {
  const [entries, setEntries] = useState<AllowlistEntry[] | null>(null);
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let request = 0;
    const refresh = async () => {
      const id = ++request;
      try {
        const senders = await getAllowlistForAccount(accountId);
        if (id === request) setEntries(senders);
      } catch {
        if (id === request) setError("Couldn’t load trusted image senders.");
      }
    };
    const unsubscribe = addImageAllowlistChangeListener((change) => {
      if (change.accountId === accountId) void refresh();
    });
    void refresh();
    return () => {
      request++;
      unsubscribe();
    };
  }, [accountId]);

  async function updateSender(address: string, allow: boolean) {
    setSaving(true);
    setError("");
    try {
      if (allow) {
        await addToAllowlist(accountId, address);
        setEmail("");
      } else {
        await removeFromAllowlist(accountId, address);
      }
    } catch {
      setError("Couldn’t update trusted image senders.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {entries?.length === 0 && <p className="text-xs text-text-tertiary">No trusted image senders.</p>}
      {!!entries?.length && (
        <ul className="space-y-1">
          {entries.map(({ id, sender_address: address }) => (
            <li key={id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 break-all text-text-secondary">{address}</span>
              <Button
                type="button"
                disabled={saving}
                aria-label={`Remove ${address}`}
                onClick={() => void updateSender(address, false)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!saving && email.trim()) void updateSender(email, true);
        }}
      >
        <input
          type="email"
          required
          aria-label="Trusted sender email address"
          placeholder="name@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-border-primary bg-bg-tertiary p-2"
        />
        <Button type="submit" disabled={saving || !email.trim()}>Add sender</Button>
      </form>
      {error && <p role="alert" className="text-danger">{error}</p>}
    </>
  );
}
