/** Delegated Graph scopes for a mailbox. Shared and calendar scopes are omitted. */
export const GRAPH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Mail.ReadWrite",
  "Mail.Send",
] as const;

/**
 * v2 scope names for Exchange Web Services. The Legacy sign-in does not send
 * these. It uses the v1 resource below, which covers EWS.AccessAsUser.All.
 */
export const EWS_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "https://outlook.office.com/EWS.AccessAsUser.All",
] as const;

/** Mailbox endpoint documented for Exchange Web Services on Microsoft 365. */
export const EWS_HOST_URL = "https://outlook.office365.com/EWS/Exchange.asmx";

/**
 * Reply address registered for a public mobile and desktop client.
 * Authorization-code sign-in returns here. No client secret is used.
 */
export const EWS_NATIVE_REDIRECT = "https://login.microsoftonline.com/common/oauth2/nativeclient";

/** Azure AD v1 resource for Office 365 Exchange. Not a Graph scope. */
export const EWS_RESOURCE = "https://outlook.office.com";

/** Redirect for a public client the user registers themselves. */
export const LOCALHOST_REDIRECT = "http://localhost:17248";

/** Tenant segment used in login.microsoftonline.com URLs. Rejects path tricks. */
export function assertSafeTenant(tenant: string): string {
  const value = tenant.trim() || "organizations";
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]{0,200}$/.test(value)) {
    throw new Error("Tenant id contains unsupported characters.");
  }
  return value;
}
