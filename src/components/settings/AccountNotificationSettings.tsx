import { useEffect, useState } from "react";
import { type Account } from "@/stores/accountStore";
import { addVipSender, getAllVipSenders, removeVipSender, type NotificationVip } from "@/services/db/notificationVips";
import {
  getAccountNotificationPreferences,
  saveAccountNotificationPreferences,
  type AccountNotificationPreferences,
} from "@/services/notifications/notificationPreferences";
import { Button } from "../ui/Button";

export function AccountNotificationSettings({ accounts, activeAccountId }: { accounts: Account[]; activeAccountId: string | null }) {
  const mailAccounts = accounts.filter((account) => account.provider !== "caldav");
  const [selection, setSelection] = useState<string | null>(null);
  const accountId = mailAccounts.find((account) => account.id === (selection ?? activeAccountId))?.id ?? mailAccounts[0]?.id;
  const [loaded, setLoaded] = useState<{ accountId: string; value: AccountNotificationPreferences } | null>(null);
  const [senders, setSenders] = useState<NotificationVip[]>([]);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const preferences = loaded?.accountId === accountId ? loaded?.value : null;

  useEffect(() => {
    if (!accountId) return;
    let active = true;
    setError("");
    setEmail("");
    Promise.all([getAccountNotificationPreferences(accountId), getAllVipSenders(accountId)])
      .then(([value, vips]) => {
        if (active) {
          setLoaded({ accountId, value });
          setSenders(vips);
        }
      })
      .catch(() => { if (active) setError("Couldn’t load notification settings."); });
    return () => { active = false; };
  }, [accountId]);

  if (!accountId) return null;
  const save = async (change: Partial<AccountNotificationPreferences>) => {
    if (!preferences || saving) return;
    setError("");
    setSaving(true);
    try {
      const value = { ...preferences, ...change };
      await saveAccountNotificationPreferences(accountId, value);
      setLoaded({ accountId, value });
    } catch {
      setError("Couldn’t save notification settings.");
    } finally {
      setSaving(false);
    }
  };
  const updateVip = async (address: string, remove: boolean) => {
    setSaving(true);
    setError("");
    try {
      if (remove) await removeVipSender(accountId, address);
      else await addVipSender(accountId, address.trim());
      setSenders(await getAllVipSenders(accountId));
      if (!remove) setEmail("");
    } catch {
      setError("Couldn’t update VIP senders.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 text-sm">
      <label className="flex flex-wrap items-center justify-between gap-2">
        Account
        <select value={accountId} disabled={saving} onChange={(event) => setSelection(event.target.value)} className="rounded-md bg-bg-tertiary border border-border-primary p-2">
          {mailAccounts.map((account) => <option key={account.id} value={account.id}>{account.email}</option>)}
        </select>
      </label>
      {error && <p role="alert" className="text-danger">{error}</p>}
      {preferences && (
        <>
          <label className="flex items-center gap-2"><input type="checkbox" disabled={saving} checked={preferences.enabled} onChange={(event) => void save({ enabled: event.target.checked })} /> Notify about new mail</label>
          <label className="flex items-center gap-2"><input type="checkbox" disabled={saving || !preferences.enabled} checked={preferences.quiet} onChange={(event) => void save({ quiet: event.target.checked })} /> Quiet hours</label>
          {preferences.quiet && (
            <div className="pl-5 space-y-3">
              <div className="flex flex-wrap gap-3">
                <label className="flex items-center gap-2">From <input type="time" disabled={saving || !preferences.enabled} value={preferences.start} onChange={(event) => { if (event.target.value) void save({ start: event.target.value }); }} /></label>
                <label className="flex items-center gap-2">Until <input type="time" disabled={saving || !preferences.enabled} value={preferences.end} onChange={(event) => { if (event.target.value) void save({ end: event.target.value }); }} /></label>
              </div>
              <label className="flex items-center gap-2"><input type="checkbox" disabled={saving || !preferences.enabled} checked={preferences.vipBypass} onChange={(event) => void save({ vipBypass: event.target.checked })} /> Let VIP senders through</label>
              <label className="flex items-center gap-2"><input type="checkbox" disabled={saving || !preferences.enabled} checked={preferences.digest} onChange={(event) => void save({ digest: event.target.checked })} /> Show a digest when quiet hours end</label>
            </div>
          )}
          <div className="space-y-2">
            <h4 className="font-medium">VIP senders</h4>
            <p className="text-xs text-text-tertiary">VIP senders get through category filters.</p>
            {senders.map((vip) => (
              <div key={vip.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{vip.email_address}</span>
                <Button variant="secondary" disabled={saving} onClick={() => void updateVip(vip.email_address, true)}>Remove</Button>
              </div>
            ))}
            <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void updateVip(email, false); }}>
              <input type="email" required aria-label="VIP email address" placeholder="name@example.com" value={email} onChange={(event) => setEmail(event.target.value)} className="flex-1 min-w-0 rounded-md bg-bg-tertiary border border-border-primary p-2" />
              <Button type="submit" variant="secondary" disabled={saving || !email.trim()}>Add VIP</Button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
