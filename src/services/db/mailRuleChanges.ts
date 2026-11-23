export type MailRuleKind = "smartLabel" | "smartFolder" | "quickStep";

type MailRuleChange =
  | { kind: MailRuleKind; source: "local" }
  | { kinds: ReadonlySet<MailRuleKind>; accountId: string; globalFolders: boolean; source: "imap" };

const listeners = new Set<(change: MailRuleChange) => void>();

export function addMailRuleChangeListener(listener: (change: MailRuleChange) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function notifyMailRuleChange(change: MailRuleChange): void {
  for (const listener of listeners) {
    try {
      listener(change);
    } catch (err) {
      console.warn("[mailRules] Change listener failed:", err);
    }
  }
}

export function subscribeToSyncedMailRules(kind: MailRuleKind, accountId: string | null, reload: () => void | Promise<void>): () => void {
  return addMailRuleChangeListener((change) => {
    if (change.source === "imap" && change.kinds.has(kind) &&
        (change.accountId === accountId || (kind === "smartFolder" && change.globalFolders))) {
      void Promise.resolve(reload()).catch((err) => console.warn("[mailRules] Could not reload synced rules:", err));
    }
  });
}

let writeQueue = Promise.resolve();

export function withMailRuleWriteLock<T>(write: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(write);
  writeQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function writeMailRule<T>(kind: MailRuleKind, write: () => Promise<T>): Promise<T> {
  const result = await withMailRuleWriteLock(write);
  notifyMailRuleChange({ kind, source: "local" });
  return result;
}
