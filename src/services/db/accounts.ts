import { getDb, selectFirstBy } from "./connection";
import { encryptValue, decryptValue, isEncrypted } from "@/utils/crypto";

export interface DbAccount {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: number | null;
  history_id: string | null;
  last_sync_at: number | null;
  is_active: number;
  created_at: number;
  updated_at: number;
  provider: string;
  imap_host: string | null;
  imap_port: number | null;
  imap_security: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_security: string | null;
  auth_method: string;
  imap_password: string | null;
  oauth_provider: string | null;
  oauth_client_id: string | null;
  oauth_client_secret: string | null;
  /** Microsoft Entra tenant for Graph accounts. Absent on rows migrated before v29. */
  oauth_tenant?: string | null;
  /** OAuth redirect used when the account was connected. */
  oauth_redirect_uri?: string | null;
  imap_username: string | null;
  caldav_url: string | null;
  caldav_username: string | null;
  caldav_password: string | null;
  caldav_principal_url: string | null;
  caldav_home_url: string | null;
  calendar_provider: string | null;
  accept_invalid_certs: number;
}

async function decryptAccountTokens(account: DbAccount): Promise<DbAccount> {
  if (account.access_token && isEncrypted(account.access_token)) {
    try {
      account.access_token = await decryptValue(account.access_token);
    } catch (err) {
      console.warn("Failed to decrypt access token, using raw value:", err);
    }
  }
  if (account.refresh_token && isEncrypted(account.refresh_token)) {
    try {
      account.refresh_token = await decryptValue(account.refresh_token);
    } catch (err) {
      console.warn("Failed to decrypt refresh token, using raw value:", err);
    }
  }
  if (account.imap_password && isEncrypted(account.imap_password)) {
    try {
      account.imap_password = await decryptValue(account.imap_password);
    } catch (err) {
      console.warn("Failed to decrypt IMAP password, using raw value:", err);
    }
  }
  if (account.oauth_client_secret && isEncrypted(account.oauth_client_secret)) {
    try {
      account.oauth_client_secret = await decryptValue(account.oauth_client_secret);
    } catch (err) {
      console.warn("Failed to decrypt OAuth client secret, using raw value:", err);
    }
  }
  if (account.caldav_password && isEncrypted(account.caldav_password)) {
    try {
      account.caldav_password = await decryptValue(account.caldav_password);
    } catch (err) {
      console.warn("Failed to decrypt CalDAV password, using raw value:", err);
    }
  }
  return account;
}

export async function getAllAccounts(): Promise<DbAccount[]> {
  const db = await getDb();
  const accounts = await db.select<DbAccount[]>(
    "SELECT * FROM accounts WHERE provider != 'sandbox' OR is_active = 1 ORDER BY created_at ASC",
  );
  return Promise.all(accounts.map(decryptAccountTokens));
}

export async function getAccount(id: string): Promise<DbAccount | null> {
  const account = await selectFirstBy<DbAccount>(
    "SELECT * FROM accounts WHERE id = $1",
    [id],
  );
  return account ? decryptAccountTokens(account) : null;
}

export async function getAccountByEmail(
  email: string,
): Promise<DbAccount | null> {
  const account = await selectFirstBy<DbAccount>(
    "SELECT * FROM accounts WHERE lower(email) = lower($1)",
    [email],
  );
  return account ? decryptAccountTokens(account) : null;
}

function isUniqueConstraintError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("UNIQUE constraint failed");
}

/**
 * Insert a Gmail account, or refresh the existing row when that email is already stored.
 * Returns the account id that should be shown in the UI.
 */
export async function saveGmailAccount(account: {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number;
}): Promise<string> {
  const existing = await getAccountByEmail(account.email);
  if (existing) {
    await reconnectGmailAccount({ ...account, id: existing.id });
    return existing.id;
  }

  try {
    await insertAccount(account);
    return account.id;
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
    const again = await getAccountByEmail(account.email);
    if (!again) throw err;
    await reconnectGmailAccount({ ...account, id: again.id });
    return again.id;
  }
}

async function reconnectGmailAccount(account: {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number;
}): Promise<void> {
  const db = await getDb();
  const encAccessToken = await encryptValue(account.accessToken);
  const encRefreshToken = await encryptValue(account.refreshToken);
  await db.execute(
    `UPDATE accounts
     SET provider = 'gmail_api',
         calendar_provider = 'google_api',
         display_name = $1,
         avatar_url = $2,
         access_token = $3,
         refresh_token = $4,
         token_expires_at = $5,
         is_active = 1,
         updated_at = unixepoch()
     WHERE id = $6`,
    [
      account.displayName,
      account.avatarUrl,
      encAccessToken,
      encRefreshToken,
      account.tokenExpiresAt,
      account.id,
    ],
  );
}

export async function insertAccount(account: {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number;
}): Promise<void> {
  const db = await getDb();
  const encAccessToken = await encryptValue(account.accessToken);
  const encRefreshToken = await encryptValue(account.refreshToken);
  await db.execute(
    `INSERT INTO accounts (id, email, display_name, avatar_url, access_token, refresh_token, token_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      account.id,
      account.email,
      account.displayName,
      account.avatarUrl,
      encAccessToken,
      encRefreshToken,
      account.tokenExpiresAt,
    ],
  );
}

export async function updateAccountTokens(
  id: string,
  accessToken: string,
  tokenExpiresAt: number,
): Promise<void> {
  const db = await getDb();
  const encAccessToken = await encryptValue(accessToken);
  await db.execute(
    "UPDATE accounts SET access_token = $1, token_expires_at = $2, updated_at = unixepoch() WHERE id = $3",
    [encAccessToken, tokenExpiresAt, id],
  );
}

export async function updateAccountSyncState(
  id: string,
  historyId: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE accounts SET history_id = $1, last_sync_at = unixepoch(), updated_at = unixepoch() WHERE id = $2",
    [historyId, id],
  );
}

export async function clearAccountHistoryId(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE accounts SET history_id = NULL, updated_at = unixepoch() WHERE id = $1",
    [id],
  );
}

export async function updateAccountAllTokens(
  id: string,
  accessToken: string,
  refreshToken: string,
  tokenExpiresAt: number,
): Promise<void> {
  const db = await getDb();
  const encAccessToken = await encryptValue(accessToken);
  const encRefreshToken = await encryptValue(refreshToken);
  await db.execute(
    "UPDATE accounts SET access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = unixepoch() WHERE id = $4",
    [encAccessToken, encRefreshToken, tokenExpiresAt, id],
  );
}

export async function deleteAccount(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM accounts WHERE id = $1", [id]);
}

export async function insertImapAccount(account: {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  imapHost: string;
  imapPort: number;
  imapSecurity: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: string;
  authMethod: string;
  password: string;
  imapUsername?: string | null;
  acceptInvalidCerts?: boolean;
}): Promise<void> {
  const db = await getDb();
  const encPassword = await encryptValue(account.password);
  await db.execute(
    `INSERT INTO accounts (id, email, display_name, avatar_url, access_token, refresh_token, provider, imap_host, imap_port, imap_security, smtp_host, smtp_port, smtp_security, auth_method, imap_password, imap_username, accept_invalid_certs)
     VALUES ($1, $2, $3, $4, NULL, NULL, 'imap', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      account.id,
      account.email,
      account.displayName,
      account.avatarUrl,
      account.imapHost,
      account.imapPort,
      account.imapSecurity,
      account.smtpHost,
      account.smtpPort,
      account.smtpSecurity,
      account.authMethod,
      encPassword,
      account.imapUsername || null,
      account.acceptInvalidCerts ? 1 : 0,
    ],
  );
}

export async function insertCalDavAccount(account: {
  id: string;
  email: string;
  displayName: string | null;
  caldavUrl: string;
  caldavUsername: string;
  caldavPassword: string;
  caldavPrincipalUrl?: string | null;
  caldavHomeUrl?: string | null;
}): Promise<void> {
  const db = await getDb();
  const encPassword = await encryptValue(account.caldavPassword);
  await db.execute(
    `INSERT INTO accounts (id, email, display_name, avatar_url, access_token, refresh_token, provider, calendar_provider, caldav_url, caldav_username, caldav_password, caldav_principal_url, caldav_home_url)
     VALUES ($1, $2, $3, NULL, NULL, NULL, 'caldav', 'caldav', $4, $5, $6, $7, $8)`,
    [
      account.id,
      account.email,
      account.displayName,
      account.caldavUrl,
      account.caldavUsername,
      encPassword,
      account.caldavPrincipalUrl ?? null,
      account.caldavHomeUrl ?? null,
    ],
  );
}

export async function updateAccountCalDav(
  accountId: string,
  fields: {
    caldavUrl: string;
    caldavUsername: string;
    caldavPassword: string;
    caldavPrincipalUrl?: string | null;
    caldavHomeUrl?: string | null;
    calendarProvider: string;
  },
): Promise<void> {
  const db = await getDb();
  const encPassword = await encryptValue(fields.caldavPassword);
  await db.execute(
    `UPDATE accounts SET caldav_url = $1, caldav_username = $2, caldav_password = $3,
       caldav_principal_url = $4, caldav_home_url = $5, calendar_provider = $6,
       updated_at = unixepoch() WHERE id = $7`,
    [
      fields.caldavUrl,
      fields.caldavUsername,
      encPassword,
      fields.caldavPrincipalUrl ?? null,
      fields.caldavHomeUrl ?? null,
      fields.calendarProvider,
      accountId,
    ],
  );
}

/**
 * Insert a Microsoft Graph account, or refresh the existing row for that email.
 * A Gmail row is left alone so a Graph sign-in cannot replace Gmail tokens.
 */
export async function saveMsGraphAccount(account: {
  id: string;
  email: string;
  displayName: string | null;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number;
  oauthClientId: string;
  oauthClientSecret: string | null;
  oauthTenant: string;
  oauthRedirectUri: string;
}): Promise<string> {
  const existing = await getAccountByEmail(account.email);
  if (existing?.provider === "gmail_api") {
    throw new Error("This email is already connected as a Gmail account.");
  }
  if (existing) {
    await updateMsGraphAccount({ ...account, id: existing.id });
    return existing.id;
  }
  try {
    await insertMsGraphAccount(account);
    return account.id;
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
    const again = await getAccountByEmail(account.email);
    if (!again || again.provider === "gmail_api") throw err;
    await updateMsGraphAccount({ ...account, id: again.id });
    return again.id;
  }
}

async function insertMsGraphAccount(account: {
  id: string;
  email: string;
  displayName: string | null;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number;
  oauthClientId: string;
  oauthClientSecret: string | null;
  oauthTenant: string;
  oauthRedirectUri: string;
}): Promise<void> {
  const db = await getDb();
  const encAccessToken = await encryptValue(account.accessToken);
  const encRefreshToken = await encryptValue(account.refreshToken);
  const encClientSecret = account.oauthClientSecret
    ? await encryptValue(account.oauthClientSecret)
    : null;
  await db.execute(
    `INSERT INTO accounts (
       id, email, display_name, access_token, refresh_token, token_expires_at,
       provider, auth_method, oauth_provider, oauth_client_id, oauth_client_secret,
       oauth_tenant, oauth_redirect_uri
     ) VALUES ($1, $2, $3, $4, $5, $6, 'msgraph', 'oauth2', 'microsoft_graph', $7, $8, $9, $10)`,
    [
      account.id,
      account.email,
      account.displayName,
      encAccessToken,
      encRefreshToken,
      account.tokenExpiresAt,
      account.oauthClientId,
      encClientSecret,
      account.oauthTenant,
      account.oauthRedirectUri,
    ],
  );
}

async function updateMsGraphAccount(account: {
  id: string;
  displayName: string | null;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number;
  oauthClientId: string;
  oauthClientSecret: string | null;
  oauthTenant: string;
  oauthRedirectUri: string;
}): Promise<void> {
  const db = await getDb();
  const encAccessToken = await encryptValue(account.accessToken);
  const encRefreshToken = await encryptValue(account.refreshToken);
  const encClientSecret = account.oauthClientSecret
    ? await encryptValue(account.oauthClientSecret)
    : null;
  await db.execute(
    `UPDATE accounts SET
       display_name = $1,
       access_token = $2,
       refresh_token = $3,
       token_expires_at = $4,
       provider = 'msgraph',
       auth_method = 'oauth2',
       oauth_provider = 'microsoft_graph',
       oauth_client_id = $5,
       oauth_client_secret = $6,
       oauth_tenant = $7,
       oauth_redirect_uri = $8,
       is_active = 1,
       updated_at = unixepoch()
     WHERE id = $9`,
    [
      account.displayName,
      encAccessToken,
      encRefreshToken,
      account.tokenExpiresAt,
      account.oauthClientId,
      encClientSecret,
      account.oauthTenant,
      account.oauthRedirectUri,
      account.id,
    ],
  );
}

/**
 * Insert an Exchange Web Services account, or refresh the existing row for that email.
 * A Gmail row is left alone. Re-auth of an existing EWS row keeps its sync checkpoint.
 */
export async function saveEwsAccount(account: {
  id: string;
  email: string;
  displayName: string | null;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number;
  oauthClientId: string;
  oauthClientSecret: string | null;
  oauthTenant: string;
  oauthRedirectUri: string;
}): Promise<string> {
  const existing = await getAccountByEmail(account.email);
  if (existing?.provider === "gmail_api") {
    throw new Error("This email is already connected as a Gmail account.");
  }
  if (existing) {
    await updateEwsAccount({ ...account, id: existing.id });
    return existing.id;
  }
  try {
    await insertEwsAccount(account);
    return account.id;
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
    const again = await getAccountByEmail(account.email);
    if (!again || again.provider === "gmail_api") throw err;
    await updateEwsAccount({ ...account, id: again.id });
    return again.id;
  }
}

async function insertEwsAccount(account: {
  id: string;
  email: string;
  displayName: string | null;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number;
  oauthClientId: string;
  oauthClientSecret: string | null;
  oauthTenant: string;
  oauthRedirectUri: string;
}): Promise<void> {
  const db = await getDb();
  const encAccessToken = await encryptValue(account.accessToken);
  const encRefreshToken = await encryptValue(account.refreshToken);
  const encClientSecret = account.oauthClientSecret
    ? await encryptValue(account.oauthClientSecret)
    : null;
  await db.execute(
    `INSERT INTO accounts (
       id, email, display_name, access_token, refresh_token, token_expires_at,
       provider, auth_method, oauth_provider, oauth_client_id, oauth_client_secret,
       oauth_tenant, oauth_redirect_uri
     ) VALUES ($1, $2, $3, $4, $5, $6, 'ews', 'oauth2', 'microsoft_ews', $7, $8, $9, $10)`,
    [
      account.id,
      account.email,
      account.displayName,
      encAccessToken,
      encRefreshToken,
      account.tokenExpiresAt,
      account.oauthClientId,
      encClientSecret,
      account.oauthTenant,
      account.oauthRedirectUri,
    ],
  );
}

async function updateEwsAccount(account: {
  id: string;
  displayName: string | null;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number;
  oauthClientId: string;
  oauthClientSecret: string | null;
  oauthTenant: string;
  oauthRedirectUri: string;
}): Promise<void> {
  const db = await getDb();
  const encAccessToken = await encryptValue(account.accessToken);
  const encRefreshToken = await encryptValue(account.refreshToken);
  const encClientSecret = account.oauthClientSecret
    ? await encryptValue(account.oauthClientSecret)
    : null;
  await db.execute(
    `UPDATE accounts SET
       display_name = $1,
       access_token = $2,
       refresh_token = $3,
       token_expires_at = $4,
       history_id = CASE WHEN provider = 'ews' THEN history_id ELSE NULL END,
       provider = 'ews',
       auth_method = 'oauth2',
       oauth_provider = 'microsoft_ews',
       oauth_client_id = $5,
       oauth_client_secret = $6,
       oauth_tenant = $7,
       oauth_redirect_uri = $8,
       is_active = 1,
       updated_at = unixepoch()
     WHERE id = $9`,
    [
      account.displayName,
      encAccessToken,
      encRefreshToken,
      account.tokenExpiresAt,
      account.oauthClientId,
      encClientSecret,
      account.oauthTenant,
      account.oauthRedirectUri,
      account.id,
    ],
  );
}

export async function insertOAuthImapAccount(account: {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  imapHost: string;
  imapPort: number;
  imapSecurity: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number;
  oauthProvider: string;
  oauthClientId: string;
  oauthClientSecret: string | null;
  imapUsername?: string | null;
  acceptInvalidCerts?: boolean;
}): Promise<void> {
  const db = await getDb();
  const encAccessToken = await encryptValue(account.accessToken);
  const encRefreshToken = await encryptValue(account.refreshToken);
  const encClientSecret = account.oauthClientSecret
    ? await encryptValue(account.oauthClientSecret)
    : null;
  await db.execute(
    `INSERT INTO accounts (id, email, display_name, avatar_url, access_token, refresh_token, token_expires_at, provider, imap_host, imap_port, imap_security, smtp_host, smtp_port, smtp_security, auth_method, imap_password, oauth_provider, oauth_client_id, oauth_client_secret, imap_username, accept_invalid_certs)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'imap', $8, $9, $10, $11, $12, $13, 'oauth2', NULL, $14, $15, $16, $17, $18)`,
    [
      account.id,
      account.email,
      account.displayName,
      account.avatarUrl,
      encAccessToken,
      encRefreshToken,
      account.tokenExpiresAt,
      account.imapHost,
      account.imapPort,
      account.imapSecurity,
      account.smtpHost,
      account.smtpPort,
      account.smtpSecurity,
      account.oauthProvider,
      account.oauthClientId,
      encClientSecret,
      account.imapUsername || null,
      account.acceptInvalidCerts ? 1 : 0,
    ],
  );
}
