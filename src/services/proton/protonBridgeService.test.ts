import { describe, it, expect, vi, beforeEach } from "vitest";
import { platformInvoke } from "@/platform";
import {
  isProtonEmail,
  checkProtonBridgeStatus,
  launchProtonBridge,
  getProtonRecommendedSettings,
  DEFAULT_PROTON_IMAP_PORT,
  DEFAULT_PROTON_SMTP_PORT,
} from "./protonBridgeService";

vi.mock("@/platform", () => ({
  platformInvoke: vi.fn(),
}));

describe("protonBridgeService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isProtonEmail", () => {
    it("recognizes protonmail.com", () => {
      expect(isProtonEmail("user@protonmail.com")).toBe(true);
      expect(isProtonEmail("User.Name+Tag@ProtonMail.com")).toBe(true);
    });

    it("recognizes proton.me", () => {
      expect(isProtonEmail("alice@proton.me")).toBe(true);
      expect(isProtonEmail("ALICE@PROTON.ME")).toBe(true);
    });

    it("recognizes pm.me", () => {
      expect(isProtonEmail("bob@pm.me")).toBe(true);
    });

    it("recognizes protonmail.ch", () => {
      expect(isProtonEmail("ch@protonmail.ch")).toBe(true);
    });

    it("returns false for non-proton emails", () => {
      expect(isProtonEmail("user@gmail.com")).toBe(false);
      expect(isProtonEmail("user@outlook.com")).toBe(false);
      expect(isProtonEmail("user@yahoo.com")).toBe(false);
      expect(isProtonEmail("")).toBe(false);
      expect(isProtonEmail("invalid-email")).toBe(false);
    });
  });

  describe("getProtonRecommendedSettings", () => {
    it("returns default recommended settings", () => {
      const settings = getProtonRecommendedSettings();
      expect(settings).toEqual({
        imapHost: "127.0.0.1",
        imapPort: DEFAULT_PROTON_IMAP_PORT,
        imapSecurity: "starttls",
        smtpHost: "127.0.0.1",
        smtpPort: DEFAULT_PROTON_SMTP_PORT,
        smtpSecurity: "starttls",
        acceptInvalidCerts: true,
      });
    });

    it("allows custom ports", () => {
      const settings = getProtonRecommendedSettings({ imap: 2143, smtp: 2025 });
      expect(settings.imapPort).toBe(2143);
      expect(settings.smtpPort).toBe(2025);
      expect(settings.imapHost).toBe("127.0.0.1");
      expect(settings.acceptInvalidCerts).toBe(true);
    });
  });

  describe("checkProtonBridgeStatus", () => {
    it("invokes check_proton_bridge_status and returns result", async () => {
      const mockStatus = {
        is_installed: true,
        is_running: true,
        executable_path: "C:\\Program Files\\Proton AG\\Proton Mail Bridge\\proton-bridge.exe",
        imap_port: 1143,
        smtp_port: 1025,
        imap_listening: true,
        smtp_listening: true,
        config_dir_found: true,
        banner: "* OK Proton Mail Bridge",
      };

      vi.mocked(platformInvoke).mockResolvedValueOnce(mockStatus);

      const result = await checkProtonBridgeStatus(1143, 1025);
      expect(platformInvoke).toHaveBeenCalledWith("check_proton_bridge_status", {
        customImapPort: 1143,
        customSmtpPort: 1025,
      });
      expect(result).toEqual(mockStatus);
    });

    it("gracefully falls back when invoke fails", async () => {
      vi.mocked(platformInvoke).mockRejectedValueOnce(new Error("Command failed"));

      const result = await checkProtonBridgeStatus();
      expect(result.is_running).toBe(false);
      expect(result.is_installed).toBe(false);
      expect(result.imap_port).toBe(DEFAULT_PROTON_IMAP_PORT);
      expect(result.smtp_port).toBe(DEFAULT_PROTON_SMTP_PORT);
    });
  });

  describe("launchProtonBridge", () => {
    it("invokes launch_proton_bridge", async () => {
      vi.mocked(platformInvoke).mockResolvedValueOnce(true);

      const res = await launchProtonBridge();
      expect(platformInvoke).toHaveBeenCalledWith("launch_proton_bridge");
      expect(res).toBe(true);
    });

    it("propagates error on launch failure", async () => {
      vi.mocked(platformInvoke).mockRejectedValueOnce(new Error("Executable not found"));

      await expect(launchProtonBridge()).rejects.toThrow("Executable not found");
    });
  });
});
