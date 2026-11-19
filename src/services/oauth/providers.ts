import { assertSafeTenant, EWS_NATIVE_REDIRECT, EWS_RESOURCE, GRAPH_SCOPES } from "../microsoft/constants";

export interface OAuthProviderConfig {
  id: string;
  name: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  userInfoUrl?: string;
  /** Whether PKCE is required (Microsoft requires it, Yahoo supports it) */
  usePkce: boolean;
  /** When set, the sign-in flow uses this redirect instead of localhost. */
  redirectUri?: string;
  /**
   * Azure AD v1 resource. When set, authorize and token requests send this
   * resource and omit scope, PKCE, and any client secret.
   */
  resource?: string;
}

const providers: Record<string, OAuthProviderConfig> = {
  google: {
    id: "google",
    name: "Google",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://mail.google.com/",
      "openid",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ],
    userInfoUrl: "https://www.googleapis.com/oauth2/v3/userinfo",
    usePkce: true,
  },
  microsoft: {
    id: "microsoft",
    name: "Microsoft",
    authUrl:
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl:
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: [
      "https://outlook.office.com/IMAP.AccessAsUser.All",
      "https://outlook.office.com/SMTP.Send",
      "offline_access",
      "openid",
      "profile",
      "email",
    ],
    userInfoUrl: undefined,
    usePkce: true,
  },
  yahoo: {
    id: "yahoo",
    name: "Yahoo",
    authUrl: "https://api.login.yahoo.com/oauth2/request_auth",
    tokenUrl: "https://api.login.yahoo.com/oauth2/get_token",
    scopes: ["mail-r", "mail-w", "openid", "sdps-r"],
    userInfoUrl: "https://api.login.yahoo.com/openid/v1/userinfo",
    usePkce: true,
  },
};

export function getOAuthProvider(id: string): OAuthProviderConfig | null {
  if (id === "gmail") {
    return providers.google ?? null;
  }
  return providers[id] ?? null;
}

export function getAllOAuthProviders(): OAuthProviderConfig[] {
  return Object.values(providers);
}

/**
 * Microsoft Graph delegated mail for one tenant.
 * Kept off the static IMAP provider map so Outlook IMAP sign-in is unchanged.
 */
export function microsoftGraphProvider(tenant: string): OAuthProviderConfig {
  const safeTenant = assertSafeTenant(tenant);
  return {
    id: "microsoft_graph",
    name: "Microsoft 365",
    authUrl: `https://login.microsoftonline.com/${safeTenant}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${safeTenant}/oauth2/v2.0/token`,
    scopes: [...GRAPH_SCOPES],
    usePkce: true,
  };
}

/**
 * Exchange Web Services delegated mail for one tenant.
 * Kept off the static provider map so Outlook IMAP and Graph sign-in stay unchanged.
 */
export function microsoftEwsProvider(tenant: string): OAuthProviderConfig {
  const safeTenant = assertSafeTenant(tenant);
  return {
    id: "microsoft_ews",
    name: "Microsoft Office 365 Legacy (EWS)",
    authUrl: `https://login.microsoftonline.com/${safeTenant}/oauth2/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${safeTenant}/oauth2/token`,
    scopes: [],
    usePkce: false,
    redirectUri: EWS_NATIVE_REDIRECT,
    resource: EWS_RESOURCE,
  };
}
