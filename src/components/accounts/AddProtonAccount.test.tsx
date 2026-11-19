import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AddProtonAccount } from "./AddProtonAccount";
import { platformInvoke, platformOpenUrl } from "@/platform";
import { insertImapAccount } from "@/services/db/accounts";
import { useAccountStore } from "@/stores/accountStore";

vi.mock("@/platform", () => ({
  platformInvoke: vi.fn(),
  platformOpenUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/db/accounts", () => ({
  insertImapAccount: vi.fn().mockResolvedValue(undefined),
}));

describe("AddProtonAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAccountStore.setState({ accounts: [], activeAccountId: null });
  });

  it("renders Proton Mail setup modal and checks bridge status on mount", async () => {
    vi.mocked(platformInvoke).mockImplementation((cmd) => {
      if (cmd === "check_proton_bridge_status") {
        return Promise.resolve({
          is_installed: true,
          is_running: true,
          executable_path: "/usr/bin/proton-bridge",
          imap_port: 1143,
          smtp_port: 1025,
          imap_listening: true,
          smtp_listening: true,
          config_dir_found: true,
          banner: "* OK Proton Mail Bridge",
        });
      }
      return Promise.resolve(null);
    });

    render(<AddProtonAccount onClose={() => {}} onSuccess={() => {}} onBack={() => {}} />);

    expect(screen.getByRole("heading", { name: "Connect Proton Mail" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect Proton Mail" })).toBeInTheDocument();
    expect(screen.getByText(/Proton Mail Bridge Integration/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Proton Mail Bridge is active & listening")).toBeInTheDocument();
    });
  });

  it("shows start bridge button when installed but not running", async () => {
    vi.mocked(platformInvoke).mockImplementation((cmd) => {
      if (cmd === "check_proton_bridge_status") {
        return Promise.resolve({
          is_installed: true,
          is_running: false,
          executable_path: "C:\\Program Files\\Proton AG\\Proton Mail Bridge\\proton-bridge.exe",
          imap_port: 1143,
          smtp_port: 1025,
          imap_listening: false,
          smtp_listening: false,
          config_dir_found: true,
          banner: null,
        });
      }
      if (cmd === "launch_proton_bridge") {
        return Promise.resolve(true);
      }
      return Promise.resolve(null);
    });

    render(<AddProtonAccount onClose={() => {}} onSuccess={() => {}} onBack={() => {}} />);

    await waitFor(() => {
      expect(
        screen.getByText("Proton Mail Bridge is installed but not running"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Start Proton Mail Bridge/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Start Proton Mail Bridge/i }));

    await waitFor(() => {
      expect(platformInvoke).toHaveBeenCalledWith("launch_proton_bridge");
    });
  });

  it("shows download button when Bridge is not detected", async () => {
    vi.mocked(platformInvoke).mockImplementation((cmd) => {
      if (cmd === "check_proton_bridge_status") {
        return Promise.resolve({
          is_installed: false,
          is_running: false,
          executable_path: null,
          imap_port: 1143,
          smtp_port: 1025,
          imap_listening: false,
          smtp_listening: false,
          config_dir_found: false,
          banner: null,
        });
      }
      return Promise.resolve(null);
    });

    render(<AddProtonAccount onClose={() => {}} onSuccess={() => {}} onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("Proton Mail Bridge not detected")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Download Bridge/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Download Bridge/i }));
    expect(platformOpenUrl).toHaveBeenCalledWith("https://proton.me/mail/bridge");
  });

  it("toggles bridge password guide accordion", async () => {
    vi.mocked(platformInvoke).mockResolvedValue({
      is_installed: false,
      is_running: false,
      executable_path: null,
      imap_port: 1143,
      smtp_port: 1025,
      imap_listening: false,
      smtp_listening: false,
      config_dir_found: false,
      banner: null,
    });

    render(<AddProtonAccount onClose={() => {}} onSuccess={() => {}} onBack={() => {}} />);

    const guideBtn = screen.getByText("Where do I find my Bridge Password?");
    fireEvent.click(guideBtn);

    expect(
      screen.getByText(/Copy the generated/i),
    ).toBeInTheDocument();
  });

  it("successfully connects, verifies, and saves Proton account", async () => {
    const onSuccess = vi.fn();

    vi.mocked(platformInvoke).mockImplementation((cmd) => {
      if (cmd === "check_proton_bridge_status") {
        return Promise.resolve({
          is_installed: true,
          is_running: true,
          executable_path: null,
          imap_port: 1143,
          smtp_port: 1025,
          imap_listening: true,
          smtp_listening: true,
          config_dir_found: true,
          banner: "* OK Proton Mail Bridge",
        });
      }
      if (cmd === "imap_test_connection") {
        return Promise.resolve("OK connected");
      }
      if (cmd === "smtp_test_connection") {
        return Promise.resolve({ success: true, message: "OK" });
      }
      return Promise.resolve(null);
    });

    render(<AddProtonAccount onClose={() => {}} onSuccess={onSuccess} onBack={() => {}} />);

    const emailInput = screen.getByPlaceholderText(/you@proton.me/i);
    const passInput = screen.getByPlaceholderText(/Generated password from Proton Mail Bridge/i);

    fireEvent.change(emailInput, { target: { value: "test@proton.me" } });
    fireEvent.change(passInput, { target: { value: "16charbridgepwd" } });

    const submitBtn = screen.getByRole("button", { name: /Connect Proton Mail/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(platformInvoke).toHaveBeenCalledWith("imap_test_connection", {
        config: {
          host: "127.0.0.1",
          port: 1143,
          security: "starttls",
          username: "test@proton.me",
          password: "16charbridgepwd",
          auth_method: "password",
          accept_invalid_certs: true,
        },
      });
      expect(platformInvoke).toHaveBeenCalledWith("smtp_test_connection", {
        config: {
          host: "127.0.0.1",
          port: 1025,
          security: "starttls",
          username: "test@proton.me",
          password: "16charbridgepwd",
          auth_method: "password",
          accept_invalid_certs: true,
        },
      });
      expect(insertImapAccount).toHaveBeenCalled();
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it("handles IMAP connection failure with helpful error message", async () => {
    vi.mocked(platformInvoke).mockImplementation((cmd) => {
      if (cmd === "check_proton_bridge_status") {
        return Promise.resolve({
          is_installed: true,
          is_running: false,
          executable_path: null,
          imap_port: 1143,
          smtp_port: 1025,
          imap_listening: false,
          smtp_listening: false,
          config_dir_found: true,
          banner: null,
        });
      }
      if (cmd === "imap_test_connection") {
        return Promise.reject(new Error("Connection refused: 127.0.0.1:1143"));
      }
      return Promise.resolve(null);
    });

    render(<AddProtonAccount onClose={() => {}} onSuccess={() => {}} onBack={() => {}} />);

    const emailInput = screen.getByPlaceholderText(/you@proton.me/i);
    const passInput = screen.getByPlaceholderText(/Generated password from Proton Mail Bridge/i);

    fireEvent.change(emailInput, { target: { value: "test@proton.me" } });
    fireEvent.change(passInput, { target: { value: "somepassword" } });

    const submitBtn = screen.getByRole("button", { name: /Connect Proton Mail/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Could not connect to Proton Mail Bridge on 127.0.0.1:1143/i),
      ).toBeInTheDocument();
    });
  });
});
