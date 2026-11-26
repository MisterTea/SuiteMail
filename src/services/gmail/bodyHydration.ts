import { getAccount } from "../db/accounts";
import { getThreadMessageStates } from "../db/messages";
import { storeThreadBodies } from "./sync";

const inFlight = new Map<string, Promise<boolean>>();

/**
 * Download the bodies of a Gmail thread that was stored from metadata only (initial sync stores
 * headers first). Resolves true when new bodies were stored and the caller should reload messages.
 */
export function hydrateGmailThreadBodies(accountId: string, threadId: string): Promise<boolean> {
  const key = `${accountId}:${threadId}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const work = (async () => {
    const account = await getAccount(accountId);
    if (account?.provider !== "gmail_api") return false;
    const states = await getThreadMessageStates(accountId, threadId);
    if (!states.some((m) => !m.body_cached)) return false;
    const { getGmailClient } = await import("./tokenManager");
    const client = await getGmailClient(accountId);
    return (await storeThreadBodies(client, accountId, [threadId])) > 0;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, work);
  return work;
}
