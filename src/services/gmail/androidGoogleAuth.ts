import { Capacitor, registerPlugin } from "@capacitor/core";
import type { TokenResponse, UserInfo } from "./auth";
import { normalizeEmail } from "@/utils/emailUtils";

interface GoogleAuthorization {
  accessToken: string;
  expiresIn: number;
  scopes: string[];
}
interface GoogleAccountsPlugin {
  authorize(options: {interactive: boolean; email?: string; invalidToken?: string}): Promise<GoogleAuthorization>;
}
const google = registerPlugin<GoogleAccountsPlugin>("GoogleAccounts");
export const isAndroidGoogle = () => Capacitor.getPlatform() === "android";

export async function getAndroidGoogleToken(email: string, invalidToken?: string): Promise<{accessToken: string; expiresAt: number}> {
  const result = await google.authorize({interactive:false,email,invalidToken});
  return {accessToken:result.accessToken,expiresAt:Math.floor(Date.now()/1000)+result.expiresIn};
}

export async function authorizeAndroidGoogle(expectedEmail?: string): Promise<{tokens: TokenResponse; userInfo: UserInfo}> {
  const result = await google.authorize({interactive:true,email:expectedEmail});
  // Authorization grants data access; identity is read from Google's verified userinfo endpoint.
  const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {headers:{Authorization:`Bearer ${result.accessToken}`}});
  if (!response.ok) throw new Error("Could not read the selected Google account. Please try again.");
  const profile = await response.json() as UserInfo & {verified_email?: boolean};
  if (!profile.email || profile.verified_email === false) throw new Error("Google did not return a verified email address.");
  if (expectedEmail && normalizeEmail(profile.email) !== normalizeEmail(expectedEmail)) {
    throw new Error(`Selected ${profile.email}, but this mailbox belongs to ${expectedEmail}. Choose the matching Google account.`);
  }
  return {
    userInfo:{email:profile.email,name:profile.name || profile.email,picture:profile.picture || ""},
    tokens:{access_token:result.accessToken,expires_in:result.expiresIn,token_type:"Bearer",scope:result.scopes.join(" ")},
  };
}
