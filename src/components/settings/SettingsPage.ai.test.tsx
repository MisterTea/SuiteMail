import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  tab: "ai" as string,
  settings: {} as Record<string, string>,
  navigateToSettings: vi.fn(),
  getBundleRules: vi.fn(async () => []),
  setBundleRule: vi.fn(async () => {}),
  getEmbeddingStats: vi.fn(async () => ({ totalMessages: 10, embeddedCount: 4 })),
  refreshWritingStyle: vi.fn(async () => null),
}));

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ tab: mocks.tab }),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => "web" },
  registerPlugin: vi.fn(() => ({})),
}));

vi.mock("@/hooks/useNativePhone", () => ({
  useNativePhone: () => false,
}));

vi.mock("@/platform", () => ({
  isElectron: () => false,
  platformInvoke: vi.fn(),
}));

vi.mock("@/router/navigate", () => ({
  navigateToLabel: vi.fn(),
  navigateToSettings: (...args: unknown[]) => mocks.navigateToSettings(...args),
}));

vi.mock("@/services/db/settings", () => ({
  getSetting: vi.fn(async (key: string) => mocks.settings[key] ?? null),
  setSetting: vi.fn(async (key: string, value: string) => {
    mocks.settings[key] = value;
  }),
  getSecureSetting: vi.fn(async (key: string) => mocks.settings[key] ?? null),
  setSecureSetting: vi.fn(async (key: string, value: string) => {
    mocks.settings[key] = value;
  }),
}));

vi.mock("@/services/ai/providerManager", () => ({
  getActiveProviderName: vi.fn(async () => (mocks.settings["ai_provider"] as string) ?? "claude"),
  clearProviderClients: vi.fn(),
}));

vi.mock("@/services/ai/androidHostAi", () => ({
  isAndroidAiRuntime: () => false,
  isAndroidEmulator: vi.fn(async () => false),
  resolveOllamaServerUrl: vi.fn(async (url: string | null) => url ?? "http://localhost:11434"),
}));

vi.mock("@/services/ai/llamaServer", () => ({
  DEFAULT_PI_SERVER_URL: "http://127.0.0.1:8080",
  loadPiServerUrl: vi.fn(async () => "http://127.0.0.1:8080"),
  piServerPort: () => 8080,
}));

vi.mock("@/services/db/bundleRules", () => ({
  getBundleRules: mocks.getBundleRules,
  setBundleRule: mocks.setBundleRule,
}));

vi.mock("@/services/db/embeddings", () => ({
  getEmbeddingStats: mocks.getEmbeddingStats,
  clearAllEmbeddings: vi.fn(async () => {}),
}));

vi.mock("@/services/ai/writingStyleService", () => ({
  refreshWritingStyle: mocks.refreshWritingStyle,
}));

vi.mock("@/services/attachments/cacheManager", () => ({
  getCacheSize: vi.fn(async () => 0),
  clearAllCache: vi.fn(async () => {}),
}));

vi.mock("@/services/crypto/pgpService", () => ({
  getPgpIdentity: vi.fn(async () => null),
}));

import { SettingsPage } from "./SettingsPage";
import { useAccountStore } from "@/stores/accountStore";
import { getSettingsGroup } from "@/constants/settingsGroups";

describe("SettingsPage AI sections", () => {
  beforeEach(() => {
    mocks.settings = {};
    vi.clearAllMocks();
    useAccountStore.setState({
      accounts: [
        { id: "acc-1", email: "work@example.com", displayName: "Work", avatarUrl: null, isActive: true, provider: "gmail_api" },
        { id: "acc-2", email: "personal@example.com", displayName: "Personal", avatarUrl: null, isActive: true, provider: "imap" },
      ],
      activeAccountId: "acc-1",
    });
  });

  it("maps general AI and mailbox AI tabs to their respective groups", () => {
    expect(getSettingsGroup("ai")).toBe("general");
    expect(getSettingsGroup("mailbox-ai")).toBe("mailbox");
  });

  it("shows only AI provider settings in General settings > AI", async () => {
    mocks.tab = "ai";
    render(<SettingsPage />);

    expect(screen.getByRole("heading", { name: "General settings" })).toBeInTheDocument();
    const navButtons = screen.getByRole("navigation", { name: "Settings categories" }).querySelectorAll("button");
    expect([...navButtons].map((b) => b.textContent)).toEqual(["General", "Accounts", "Shortcuts", "AI", "About"]);

    await waitFor(() => {
      expect(screen.getByText("Provider")).toBeInTheDocument();
    });
    expect(screen.getByText("AI Provider")).toBeInTheDocument();
    expect(screen.getByText("API Key")).toBeInTheDocument();

    expect(screen.queryByText("Enable AI features")).not.toBeInTheDocument();
    expect(screen.queryByText("Auto-Draft Replies")).not.toBeInTheDocument();
    expect(screen.queryByText("Bundling & Delivery Schedules")).not.toBeInTheDocument();
    expect(screen.queryByText("Vector Database & Semantic Search")).not.toBeInTheDocument();
  });

  it("shows mailbox-specific AI settings in Mailbox settings > AI and scopes them per account", async () => {
    mocks.tab = "mailbox-ai";
    render(<SettingsPage />);

    expect(screen.getByRole("heading", { name: "Mailbox settings" })).toBeInTheDocument();
    const navButtons = screen.getByRole("navigation", { name: "Settings categories" }).querySelectorAll("button");
    expect([...navButtons].map((b) => b.textContent)).toEqual(["Notifications", "Composing", "Mail Rules", "People", "AI"]);

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "Enable AI features" })).toBeInTheDocument();
    });

    expect(screen.queryByText("AI Provider")).not.toBeInTheDocument();
    expect(screen.getByText("Auto-Draft Replies")).toBeInTheDocument();
    expect(screen.getByText("Categories")).toBeInTheDocument();
    expect(screen.getByText("Bundling & Delivery Schedules")).toBeInTheDocument();
    expect(screen.getByText("Vector Database & Semantic Search")).toBeInTheDocument();

    // Disable AI features for work@example.com (acc-1)
    const aiToggle = screen.getByRole("switch", { name: "Enable AI features" });
    expect(aiToggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(aiToggle);
    await waitFor(() => {
      expect(aiToggle).toHaveAttribute("aria-checked", "false");
    });
    expect(mocks.settings["ai_enabled:acc-1"]).toBe("false");

    // Switch mailbox to personal@example.com (acc-2): AI features should still be enabled
    const accountSelect = screen.getByLabelText("Mailbox account");
    fireEvent.change(accountSelect, { target: { value: "acc-2" } });
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "Enable AI features" })).toHaveAttribute("aria-checked", "true");
    });
    expect(mocks.getEmbeddingStats).toHaveBeenCalledWith("acc-2");
    expect(mocks.getBundleRules).toHaveBeenCalledWith("acc-2");
  });
});
