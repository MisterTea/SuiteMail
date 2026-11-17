import { triggerSync } from "../gmail/syncManager";
import type { DbAccount } from "../db/accounts";

export interface IdleSession {
  accountId: string;
  active: boolean;
  stop: () => void;
}

const activeSessions = new Map<string, IdleSession>();

/**
 * Handle notification that an account mailbox received changes (via IDLE or push).
 */
export async function onMailboxChange(accountId: string): Promise<void> {
  try {
    await triggerSync([accountId]);
  } catch (err) {
    console.error(`IDLE: Failed to trigger delta sync for ${accountId}:`, err);
  }
}

/**
 * Start IMAP IDLE listener for an account.
 */
export function startAccountIdle(account: DbAccount): IdleSession {
  stopAccountIdle(account.id);

  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    activeSessions.delete(account.id);
  };

  const session: IdleSession = {
    accountId: account.id,
    active: true,
    stop,
  };

  activeSessions.set(account.id, session);
  return session;
}

/**
 * Stop IMAP IDLE listener for a specific account.
 */
export function stopAccountIdle(accountId: string): void {
  const existing = activeSessions.get(accountId);
  if (existing) {
    existing.stop();
  }
}

/**
 * Start IDLE listeners for all IMAP accounts.
 */
export function startAllIdle(accounts: DbAccount[]): void {
  const imapAccounts = accounts.filter((a) => a.provider === "imap");
  for (const acc of imapAccounts) {
    startAccountIdle(acc);
  }
}

/**
 * Stop all active IDLE listeners.
 */
export function stopAllIdle(): void {
  for (const session of activeSessions.values()) {
    session.stop();
  }
  activeSessions.clear();
}
