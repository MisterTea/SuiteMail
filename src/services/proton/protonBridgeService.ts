import { platformInvoke as invoke } from "@/platform";
import type { SecurityType } from "@/services/imap/autoDiscovery";

export interface ProtonBridgeStatus {
  is_installed: boolean;
  is_running: boolean;
  executable_path: string | null;
  imap_port: number;
  smtp_port: number;
  imap_listening: boolean;
  smtp_listening: boolean;
  config_dir_found: boolean;
  banner: string | null;
}

export const PROTON_DOMAINS = [
  "proton.me",
  "protonmail.com",
  "pm.me",
  "protonmail.ch",
];

export const PROTON_BRIDGE_DOWNLOAD_URL = "https://proton.me/mail/bridge";
export const PROTON_BRIDGE_GITHUB_URL = "https://github.com/protonmail/proton-bridge";
export const PROTON_BRIDGE_SETUP_GUIDE_URL = "https://proton.me/support/bridge-setup";

export const DEFAULT_PROTON_IMAP_PORT = 1143;
export const DEFAULT_PROTON_SMTP_PORT = 1025;

/**
 * Check whether an email address is associated with Proton Mail.
 */
export function isProtonEmail(email: string): boolean {
  if (!email || !email.includes("@")) return false;
  const parts = email.trim().toLowerCase().split("@");
  if (parts.length < 2) return false;
  const domain = parts[parts.length - 1];
  if (!domain) return false;
  return PROTON_DOMAINS.includes(domain);
}

/**
 * Query the status of Proton Mail Bridge from the desktop backend.
 */
export async function checkProtonBridgeStatus(
  imapPort?: number,
  smtpPort?: number,
): Promise<ProtonBridgeStatus> {
  try {
    return await invoke<ProtonBridgeStatus>("check_proton_bridge_status", {
      customImapPort: imapPort ?? null,
      customSmtpPort: smtpPort ?? null,
    });
  } catch (err) {
    console.warn("Failed to check Proton Bridge status via Tauri command:", err);
    return {
      is_installed: false,
      is_running: false,
      executable_path: null,
      imap_port: imapPort ?? DEFAULT_PROTON_IMAP_PORT,
      smtp_port: smtpPort ?? DEFAULT_PROTON_SMTP_PORT,
      imap_listening: false,
      smtp_listening: false,
      config_dir_found: false,
      banner: null,
    };
  }
}

/**
 * Attempt to start Proton Mail Bridge if found on the system.
 */
export async function launchProtonBridge(): Promise<boolean> {
  try {
    return await invoke<boolean>("launch_proton_bridge");
  } catch (err) {
    console.error("Failed to launch Proton Bridge:", err);
    throw err;
  }
}

export interface ProtonRecommendedSettings {
  imapHost: string;
  imapPort: number;
  imapSecurity: SecurityType;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: SecurityType;
  acceptInvalidCerts: boolean;
}

/**
 * Return default recommended connection settings for Proton Mail Bridge.
 */
export function getProtonRecommendedSettings(ports?: {
  imap?: number;
  smtp?: number;
}): ProtonRecommendedSettings {
  return {
    imapHost: "127.0.0.1",
    imapPort: ports?.imap ?? DEFAULT_PROTON_IMAP_PORT,
    imapSecurity: "starttls",
    smtpHost: "127.0.0.1",
    smtpPort: ports?.smtp ?? DEFAULT_PROTON_SMTP_PORT,
    smtpSecurity: "starttls",
    acceptInvalidCerts: true,
  };
}
