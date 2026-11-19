import { platformInvoke as invoke, platformOpenUrl as openUrl } from "@/platform";
import { microsoftGraphProvider, type OAuthProviderConfig } from "./providers";
import { msgraphGetProfile } from "../microsoft/graphCommands";

const OAUTH_CALLBACK_PORT = 17248;

interface OAuthServerResult {
  code: string;
  state: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
  id_token?: string;
}

export interface ProviderUserInfo {
  email: string;
  name: string;
  picture?: string;
}

function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Start the OAuth2 + PKCE flow for a non-Gmail provider.
 * 1. Start localhost callback server (Rust)
 * 2. Open browser to provider consent screen
 * 3. Capture redirect with auth code
 * 4. Exchange code for tokens
 * 5. Fetch user profile info
 */
export interface ProviderOAuthOptions {
  redirectUri?: string;
  loginHint?: string;
}

function isLoopbackRedirect(redirectUri: string): boolean {
  try {
    const url = new URL(redirectUri);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function sendsScopeOnTokenRequest(providerId: string): boolean {
  return providerId === "microsoft" || providerId === "microsoft_graph";
}

export async function startProviderOAuthFlow(
  provider: OAuthProviderConfig,
  clientId: string,
  clientSecret?: string,
  options?: ProviderOAuthOptions,
): Promise<{ tokens: TokenResponse; userInfo: ProviderUserInfo }> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const stateArray = new Uint8Array(32);
  crypto.getRandomValues(stateArray);
  const oauthState = base64UrlEncode(stateArray);

  const redirectUri =
    options?.redirectUri
    ?? provider.redirectUri
    ?? (provider.id === "google"
      ? `http://127.0.0.1:${OAUTH_CALLBACK_PORT}`
      : `http://localhost:${OAUTH_CALLBACK_PORT}`);

  const params: Record<string, string> = {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state: oauthState,
  };
  if (provider.resource) {
    params.resource = provider.resource;
  } else if (provider.scopes.length > 0) {
    params.scope = provider.scopes.join(" ");
  }

  if (provider.usePkce) {
    params.code_challenge = codeChallenge;
    params.code_challenge_method = "S256";
  }

  // Provider-specific auth params
  if (provider.id === "microsoft_graph" || provider.id === "microsoft_ews") {
    params.prompt = "select_account";
    params.response_mode = "query";
  } else if (provider.id === "microsoft") {
    params.prompt = "consent";
    params.response_mode = "query";
  } else if (provider.id === "google") {
    params.access_type = "offline";
    params.prompt = "consent";
  }

  if (options?.loginHint) {
    params.login_hint = options.loginHint;
  }

  const authUrl = `${provider.authUrl}?${new URLSearchParams(params).toString()}`;

  let result: OAuthServerResult;
  if (isLoopbackRedirect(redirectUri)) {
    const serverPromise = invoke<OAuthServerResult>("start_oauth_server", {
      port: OAUTH_CALLBACK_PORT,
      state: oauthState,
    });

    await new Promise((r) => setTimeout(r, 100));
    await openUrl(authUrl);
    result = await serverPromise;
  } else {
    result = await invoke<OAuthServerResult>("oauth_webview_login", {
      authUrl,
      redirectPrefix: redirectUri,
      state: oauthState,
    });
  }

  if (result.state !== oauthState) {
    throw new Error("OAuth state mismatch — possible CSRF attack. Please try again.");
  }

  const tokens = await exchangeCode(
    provider,
    result.code,
    clientId,
    redirectUri,
    codeVerifier,
    clientSecret,
  );

  const userInfo = await fetchUserInfo(provider, tokens);

  return { tokens, userInfo };
}

export interface DeviceCodePrompt {
  userCode: string;
  verificationUri: string;
  message: string;
}

interface DeviceCodeStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  message: string;
}

interface DeviceCodePoll {
  pending: boolean;
  slow_down: boolean;
  tokens: TokenResponse | null;
}

/**
 * Microsoft Graph sign-in through the device-code flow.
 * The user finishes in a normal browser. The request has no reply address.
 */
export function startGraphDeviceCodeSignIn(
  tenant: string,
  clientId: string,
  hooks: {
    onCode: (prompt: DeviceCodePrompt) => void;
    isCancelled: () => boolean;
  },
): Promise<{ tokens: TokenResponse; userInfo: ProviderUserInfo }> {
  return startDeviceCodeSignIn(microsoftGraphProvider(tenant), clientId, hooks);
}

async function startDeviceCodeSignIn(
  provider: OAuthProviderConfig,
  clientId: string,
  hooks: {
    onCode: (prompt: DeviceCodePrompt) => void;
    isCancelled: () => boolean;
  },
): Promise<{ tokens: TokenResponse; userInfo: ProviderUserInfo }> {
  const safeTenant = new URL(provider.authUrl).pathname.split("/").filter(Boolean)[0] ?? "organizations";
  const scope = provider.scopes.join(" ");
  const started = await invoke<DeviceCodeStart>("oauth_device_code_begin", {
    tenant: safeTenant,
    clientId,
    scope,
  });
  if (hooks.isCancelled()) {
    throw new Error("Sign-in was cancelled.");
  }
  hooks.onCode({
    userCode: started.user_code,
    verificationUri: started.verification_uri,
    message: started.message,
  });
  try {
    await openUrl(started.verification_uri);
  } catch {
    // The code and address stay on screen when the browser does not open.
  }

  let interval = Number.isFinite(started.interval) ? Math.max(0, started.interval) : 5;
  const deadline = Date.now() + Math.max(30, started.expires_in || 900) * 1000;
  while (Date.now() < deadline) {
    if (!(await waitSeconds(interval, hooks.isCancelled))) {
      throw new Error("Sign-in was cancelled.");
    }
    const poll = await invoke<DeviceCodePoll>("oauth_device_code_poll", {
      tenant: safeTenant,
      clientId,
      deviceCode: started.device_code,
      scope,
    });
    if (poll.slow_down) interval += 5;
    if (poll.pending || !poll.tokens) continue;
    const userInfo = await fetchUserInfo(provider, poll.tokens);
    return { tokens: poll.tokens, userInfo };
  }
  throw new Error("The sign-in code expired. Try again.");
}

async function waitSeconds(seconds: number, isCancelled: () => boolean): Promise<boolean> {
  const step = 200;
  const total = Math.max(0, seconds) * 1000;
  for (let waited = 0; waited < total; waited += step) {
    if (isCancelled()) return false;
    await new Promise((resolve) => setTimeout(resolve, Math.min(step, total - waited)));
  }
  return !isCancelled();
}

async function exchangeCode(
  provider: OAuthProviderConfig,
  code: string,
  clientId: string,
  redirectUri: string,
  codeVerifier: string,
  clientSecret?: string,
): Promise<TokenResponse> {
  // Use Rust backend for token exchange to avoid CORS issues (required for Microsoft native client)
  return invoke<TokenResponse>("oauth_exchange_token", {
    tokenUrl: provider.tokenUrl,
    code,
    clientId,
    redirectUri,
    codeVerifier: provider.usePkce ? codeVerifier : null,
    clientSecret: clientSecret || null,
    scope: sendsScopeOnTokenRequest(provider.id) && !provider.resource
      ? provider.scopes.join(" ")
      : null,
    resource: provider.resource ?? null,
  });
}

/**
 * Refresh an expired access token for a non-Gmail provider.
 */
export async function refreshProviderToken(
  provider: OAuthProviderConfig,
  refreshToken: string,
  clientId: string,
  clientSecret?: string,
): Promise<TokenResponse> {
  // Use Rust backend for token refresh to avoid CORS issues
  return invoke<TokenResponse>("oauth_refresh_token", {
    tokenUrl: provider.tokenUrl,
    refreshToken,
    clientId,
    clientSecret: clientSecret || null,
    scope: sendsScopeOnTokenRequest(provider.id) && !provider.resource
      ? provider.scopes.join(" ")
      : null,
    resource: provider.resource ?? null,
  });
}

function parseIdToken(idToken: string): Record<string, unknown> {
  const payload = idToken.split(".")[1];
  if (!payload) throw new Error("Invalid ID token format");
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const decoded = atob(padded);
  return JSON.parse(decoded);
}

function claimString(claims: Record<string, unknown>, key: string): string {
  const value = claims[key];
  return typeof value === "string" ? value.trim() : "";
}

/** Mailbox address from an ID token or an access-token JWT. */
function mailboxFromClaims(claims: Record<string, unknown>): string {
  for (const key of ["email", "preferred_username", "upn", "unique_name"]) {
    const raw = claimString(claims, key);
    if (!raw.includes("@")) continue;
    const hash = raw.lastIndexOf("#");
    const address = hash >= 0 ? raw.slice(hash + 1) : raw;
    if (address.includes("@")) return address;
  }
  return "";
}

function claimsFromJwt(token: string | undefined): Record<string, unknown> | null {
  if (!token || token.split(".").length < 2) return null;
  try {
    return parseIdToken(token);
  } catch {
    return null;
  }
}

async function fetchUserInfo(
  provider: OAuthProviderConfig,
  tokens: TokenResponse,
): Promise<ProviderUserInfo> {
  if (provider.id === "microsoft_graph") {
    try {
      const profile = await msgraphGetProfile(tokens.access_token);
      if (profile.email) {
        return {
          email: profile.email,
          name: profile.name ?? "",
          picture: undefined,
        };
      }
    } catch {
      // Fall through to the ID token. UT preferred_username is often an EID address.
    }
    if (tokens.id_token) {
      const claims = parseIdToken(tokens.id_token);
      return {
        email: (claims.email as string) || (claims.preferred_username as string) || "",
        name: (claims.name as string) || "",
        picture: undefined,
      };
    }
    return { email: "", name: "", picture: undefined };
  }

  // EWS cannot call Graph. v1 often returns the mailbox only inside the access token.
  if (provider.id === "microsoft_ews") {
    const claims = claimsFromJwt(tokens.id_token) ?? claimsFromJwt(tokens.access_token);
    if (!claims) return { email: "", name: "", picture: undefined };
    return {
      email: mailboxFromClaims(claims),
      name: claimString(claims, "name"),
      picture: undefined,
    };
  }

  // Microsoft IMAP: extract user info from ID token (can't use Graph API with Outlook scopes)
  if (provider.id === "microsoft") {
    if (tokens.id_token) {
      const claims = parseIdToken(tokens.id_token);
      return {
        email: (claims.email as string) || (claims.preferred_username as string) || "",
        name: (claims.name as string) || "",
        picture: undefined,
      };
    }
    // Fallback if no ID token
    return { email: "", name: "", picture: undefined };
  }

  // Google: extract user info from ID token if available
  if (provider.id === "google" && tokens.id_token) {
    try {
      const claims = parseIdToken(tokens.id_token);
      return {
        email: (claims.email as string) || "",
        name: (claims.name as string) || "",
        picture: (claims.picture as string) || undefined,
      };
    } catch {
      // Fallback to userInfoUrl
    }
  }

  if (!provider.userInfoUrl) {
    throw new Error(`Provider ${provider.id} has no user info endpoint`);
  }

  const response = await fetch(provider.userInfoUrl, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch user info: ${await response.text()}`);
  }

  const data = await response.json();

  // Normalize response across providers
  if (provider.id === "yahoo") {
    return {
      email: data.email || "",
      name: data.name || data.nickname || "",
      picture: data.picture || undefined,
    };
  }

  return {
    email: data.email || "",
    name: data.name || "",
    picture: data.picture || undefined,
  };
}
