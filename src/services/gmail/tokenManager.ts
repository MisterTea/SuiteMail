import { authorizeAndroidGoogle, getAndroidGoogleToken, isAndroidGoogle } from "./androidGoogleAuth";
import { GmailClient } from "./client";
import { startOAuthFlow } from "./auth";
import { getAllAccounts, getAccount, updateAccountAllTokens } from "../db/accounts";
import { getSetting, getSecureSetting } from "../db/settings";
import { getCurrentUnixTimestamp } from "@/utils/timestamp";
import { normalizeEmail } from "@/utils/emailUtils";

function androidClient(account: {id: string; email: string}): GmailClient {
  // Reconfirm device authorization after restart, even when an imported token is still cached in SQLite.
  return new GmailClient(account.id, "", {accessToken:"",refreshToken:"",expiresAt:0}, undefined,
    invalidToken => getAndroidGoogleToken(account.email, invalidToken));
}

// In-memory cache of active GmailClient instances per account
const clients = new Map<string, GmailClient>();

/**
 * Get or create a GmailClient for the given account.
 */
export async function getGmailClient(
  accountId: string,
): Promise<GmailClient> {
  const existing = clients.get(accountId);
  if (existing) return existing;

  const accounts = await getAllAccounts();
  const account = accounts.find((a) => a.id === accountId);

  if (!account) throw new Error(`Account ${accountId} not found`);
  if (isAndroidGoogle()) {
    const client = androidClient(account);
    clients.set(accountId, client);
    return client;
  }
  const clientId = await getClientId();
  const clientSecret = await getClientSecret();
  if (!account.access_token || !account.refresh_token) {
    throw new Error(`Account ${accountId} has no tokens`);
  }

  const client = new GmailClient(accountId, clientId, {
    accessToken: account.access_token,
    refreshToken: account.refresh_token,
    expiresAt: account.token_expires_at ?? 0,
  }, clientSecret);

  clients.set(accountId, client);
  return client;
}

/**
 * Remove a client from cache (e.g., on account removal or re-auth).
 */
export function removeClient(accountId: string): void {
  clients.delete(accountId);
}

const ENV_GMAIL_CLIENT_ID = "GMAIL_OAUTH_CLIENT_ID";
const ENV_GMAIL_CLIENT_SECRET = "GMAIL_OAUTH_CLIENT_SECRET";
const ENV_GMAIL_PAIR_ERROR =
  "GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET must both be set in .env.";

/**
 * Read a Gmail OAuth value from Vite's env or process.env.
 */
function readGmailEnv(key: typeof ENV_GMAIL_CLIENT_ID | typeof ENV_GMAIL_CLIENT_SECRET): string | undefined {
  // Static property access so Vite inlines both values in dev and production builds.
  const metaEnv =
    key === ENV_GMAIL_CLIENT_ID
      ? import.meta.env.GMAIL_OAUTH_CLIENT_ID
      : import.meta.env.GMAIL_OAUTH_CLIENT_SECRET;
  if (typeof metaEnv === "string" && metaEnv.trim()) {
    return metaEnv.trim();
  }

  const proc = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process;
  const procEnv = proc?.env?.[key];
  if (typeof procEnv === "string" && procEnv.trim()) {
    return procEnv.trim();
  }

  return undefined;
}

/**
 * Read GMAIL_OAUTH_CLIENT_ID from environment variables (.env via Vite or process.env).
 */
export function getEnvGmailClientId(): string | undefined {
  return readGmailEnv(ENV_GMAIL_CLIENT_ID);
}

/**
 * Read GMAIL_OAUTH_CLIENT_SECRET from environment variables (.env via Vite or process.env).
 */
export function getEnvGmailClientSecret(): string | undefined {
  return readGmailEnv(ENV_GMAIL_CLIENT_SECRET);
}

/**
 * The desktop OAuth client in .env. Both values are required together.
 * Returns undefined when neither variable is set.
 */
export function getEnvGmailCredentials(): { clientId: string; clientSecret: string } | undefined {
  const clientId = getEnvGmailClientId();
  const clientSecret = getEnvGmailClientSecret();
  if (!clientId && !clientSecret) return undefined;
  if (!clientId || !clientSecret) {
    throw new Error(ENV_GMAIL_PAIR_ERROR);
  }
  return { clientId, clientSecret };
}

/**
 * Get the Google OAuth client ID from environment or settings.
 */
export async function getClientId(): Promise<string> {
  const envCredentials = getEnvGmailCredentials();
  if (envCredentials) {
    return envCredentials.clientId;
  }
  const clientId = await getSetting("google_client_id");
  if (!clientId || !clientId.trim()) {
    throw new Error("Google Client ID not configured. Go to Settings to set it up.");
  }
  return clientId.trim();
}

/**
 * Get the Google OAuth client secret. The .env desktop client always has one.
 * A client ID entered in Settings may still omit it.
 */
export async function getClientSecret(): Promise<string | undefined> {
  const envCredentials = getEnvGmailCredentials();
  if (envCredentials) {
    return envCredentials.clientSecret;
  }
  const clientSecret = await getSecureSetting("google_client_secret");
  const trimmed = clientSecret?.trim();
  return trimmed || undefined;
}

/**
 * Initialize clients for all active accounts on app startup.
 */
export async function initializeClients(): Promise<void> {
  const accounts = await getAllAccounts();
  if (isAndroidGoogle()) {
    for (const account of accounts) {
      if (account.is_active && account.provider === "gmail_api") clients.set(account.id, androidClient(account));
    }
    return;
  }
  let clientId: string;
  let clientSecret: string | undefined;
  try {
    clientId = await getClientId();
    clientSecret = await getClientSecret();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message !== "Google Client ID not configured. Go to Settings to set it up.") {
      console.error(message);
    }
    return;
  }

  for (const account of accounts) {
    if (account.is_active && account.access_token && account.refresh_token) {
      const client = new GmailClient(account.id, clientId, {
        accessToken: account.access_token,
        refreshToken: account.refresh_token,
        expiresAt: account.token_expires_at ?? 0,
      }, clientSecret);
      clients.set(account.id, client);
    }
  }
}

/**
 * Re-authorize an existing account to obtain new tokens (e.g., after scope changes).
 * Preserves all local data — only replaces tokens.
 */
export async function reauthorizeAccount(
  accountId: string,
  expectedEmail: string,
): Promise<void> {
  const account = await getAccount(accountId);
  if (!account) throw new Error(`Account ${accountId} not found`);

  const android = isAndroidGoogle();
  const clientId = android ? "" : await getClientId();
  const clientSecret = android ? undefined : await getClientSecret();

  const { tokens, userInfo } = android
    ? await authorizeAndroidGoogle(expectedEmail)
    : await startOAuthFlow(clientId, clientSecret);

  if (normalizeEmail(userInfo.email) !== normalizeEmail(expectedEmail)) {
    throw new Error(
      `Signed in as ${userInfo.email}, but expected ${expectedEmail}. Please sign in with the correct account.`,
    );
  }

  if (!android && !tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Please revoke app access at https://myaccount.google.com/permissions and try again.",
    );
  }

  const expiresAt = getCurrentUnixTimestamp() + tokens.expires_in;
  await updateAccountAllTokens(accountId, tokens.access_token, tokens.refresh_token ?? "", expiresAt);

  // Evict stale client and create a fresh one
  clients.delete(accountId);
  const client = android ? androidClient(account) : new GmailClient(accountId, clientId, {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token!,
    expiresAt,
  }, clientSecret);
  clients.set(accountId, client);
}
