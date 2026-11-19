import { getAccount } from "@/services/db/accounts";
import { getAliasesForAccount } from "@/services/db/sendAsAliases";
import { useAccountStore } from "@/stores/accountStore";

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Name to show for a message. Uses the stored From name, and falls back to
 * the account profile name when the message is from one of the user's own
 * addresses that was stored without a display name.
 */
export function fallbackSenderName(
  fromName: string | null | undefined,
  fromAddress: string | null | undefined,
  accounts: { email: string; displayName: string | null }[],
): string | null {
  const name = clean(fromName);
  if (name) return name;
  const address = fromAddress?.trim().toLowerCase();
  if (!address) return null;
  for (const account of accounts) {
    if (account.email.trim().toLowerCase() === address) {
      return clean(account.displayName);
    }
  }
  return null;
}

/**
 * Name to put on mail sent from this account.
 * Prefers the Gmail send-as display name for the chosen address, then the
 * account profile name when sending as the account itself.
 */
export async function resolveSenderDisplayName(
  accountId: string,
  fromEmail: string,
): Promise<string | null> {
  const email = fromEmail.trim().toLowerCase();

  try {
    const aliases = await getAliasesForAccount(accountId);
    const alias = aliases.find((entry) => entry.email.trim().toLowerCase() === email);
    const aliasName = clean(alias?.display_name);
    if (aliasName) return aliasName;
  } catch (err) {
    console.warn("Failed to read send-as name:", err);
  }

  let accountEmail: string | null = null;
  let accountName: string | null = null;
  try {
    const account = await getAccount(accountId);
    if (account) {
      accountEmail = account.email;
      accountName = clean(account.display_name);
    }
  } catch (err) {
    console.warn("Failed to read account name:", err);
  }

  if (!accountName || !accountEmail) {
    try {
      const stored = useAccountStore.getState().accounts.find((account) => account.id === accountId);
      if (stored) {
        accountEmail = accountEmail ?? stored.email;
        accountName = accountName ?? clean(stored.displayName);
      }
    } catch {
      // Account store is unavailable outside the app shell.
    }
  }

  if (!accountName) return null;
  const sameAccount = !email || (accountEmail != null && accountEmail.trim().toLowerCase() === email);
  return sameAccount ? accountName : null;
}
