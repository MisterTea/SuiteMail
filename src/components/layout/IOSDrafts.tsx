import { useEffect, useState } from "react";
import { getUnsyncedDrafts, type LocalDraft } from "@/services/db/localDrafts";
import { isIOSLocalDraft, openIOSDraft } from "@/services/draft/iosDrafts";

export function useIOSDrafts(accountIds: string, enabled: boolean) {
  const [drafts, setDrafts] = useState<LocalDraft[]>([]);
  useEffect(() => {
    if (!enabled || !accountIds) return;
    let request = 0;
    const load = () => {
      const current = ++request;
      void Promise.all(accountIds.split(",").map(getUnsyncedDrafts)).then((items) => {
        if (current === request) {
          setDrafts(items.flat().filter(({ id }) => isIOSLocalDraft(id)).sort((a, b) => b.updated_at - a.updated_at));
        }
      }).catch(() => { if (current === request) setDrafts([]); });
    };
    load();
    window.addEventListener("draft-count-changed", load);
    return () => {
      request++;
      window.removeEventListener("draft-count-changed", load);
    };
  }, [accountIds, enabled]);
  return enabled ? drafts.filter((draft) => accountIds.split(",").includes(draft.account_id)) : [];
}

export function IOSDrafts({ drafts }: { drafts: LocalDraft[] }) {
  const [error, setError] = useState(false);
  if (!drafts.length) return null;
  return (
    <section aria-label="Drafts saved on this device">
      <h3 className="px-4 pt-3 pb-1 text-xs font-medium text-text-secondary">On this device</h3>
      {error && <p role="alert" className="px-4 text-sm text-danger">Couldn’t open the draft.</p>}
      {drafts.map((draft) => (
        <button key={draft.id} type="button"
          className="block w-full min-h-12 px-4 py-2 text-left border-b border-border-secondary"
          onClick={() => { setError(false); void openIOSDraft(draft.account_id, draft.id).catch(() => setError(true)); }}>
          <span className="font-medium">{draft.subject || "(No subject)"}</span>
        </button>
      ))}
    </section>
  );
}
