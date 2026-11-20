// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ensureSettingsFolder,
  buildSettingsEmail,
  uploadSettingsReplacement,
  applyFilterChangeAndUpload,
  applyGeneralSettingChangeAndUpload,
  uploadFilterSettings,
  uploadGeneralSettings,
  syncGeneralSettings,
  syncFilterSettings,
  uploadFilterSettingsForAccount,
  uploadGeneralSettingsForAccount,
  syncSettingsForAccount,
  reconcileFiltersToDb,
  isGeneralSettingsFolder,
  isFiltersSettingsFolder,
  isSettingsFolder,
  SETTINGS_SIDECAR_FOLDER,
  SETTINGS_GENERAL_FOLDER,
  SETTINGS_FILTERS_FOLDER,
  type FilterRulePayload,
  type GeneralSettingsPayload,
  type FiltersSettingsPayload,
} from "./settingsSidecarSync";
import type { ImapConfig } from "./electronCommands";

const mockCommands = {
  imapListFolders: vi.fn(),
  imapCreateFolder: vi.fn(),
  imapAppendMessage: vi.fn(),
  imapSearchAllUids: vi.fn(),
  imapFetchMessages: vi.fn(),
  imapDeleteMessages: vi.fn(),
  imapGetFolderStatus: vi.fn(),
};

vi.mock("./electronCommands", () => ({
  imapListFolders: vi.fn((config) => mockCommands.imapListFolders(config)),
  imapCreateFolder: vi.fn((config, folder) => mockCommands.imapCreateFolder(config, folder)),
  imapAppendMessage: vi.fn((config, folder, raw, flags) =>
    mockCommands.imapAppendMessage(config, folder, raw, flags)
  ),
  imapSearchAllUids: vi.fn((config, folder) => mockCommands.imapSearchAllUids(config, folder)),
  imapFetchMessages: vi.fn((config, folder, uids) => mockCommands.imapFetchMessages(config, folder, uids)),
  imapDeleteMessages: vi.fn((config, folder, uids) => mockCommands.imapDeleteMessages(config, folder, uids)),
  imapGetFolderStatus: vi.fn((config, folder) => mockCommands.imapGetFolderStatus(config, folder)),
}));

const mockDb = {
  select: vi.fn(),
  execute: vi.fn(),
};

vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => mockDb),
  boolToInt: (b: boolean) => (b ? 1 : 0),
  buildDynamicUpdate: () => null,
}));

const mockSettingsStore: Record<string, string> = {};
const mockFiltersStore: Record<string, any[]> = {};
const mockAccountsStore: Record<string, any> = {};

vi.mock("../db/settings", () => ({
  getSetting: vi.fn(async (key: string) => mockSettingsStore[key] ?? null),
  setSetting: vi.fn(async (key: string, val: string) => {
    mockSettingsStore[key] = val;
  }),
  getAllSettings: vi.fn(async () => ({ ...mockSettingsStore })),
  addSettingChangeListener: vi.fn(() => () => {}),
}));

vi.mock("../db/filters", () => ({
  getFiltersForAccount: vi.fn(async (accId: string) => mockFiltersStore[accId] ?? []),
  addFilterChangeListener: vi.fn(() => () => {}),
  insertFilter: vi.fn(),
  updateFilter: vi.fn(),
  deleteFilter: vi.fn(),
}));

vi.mock("../db/accounts", () => ({
  getAccount: vi.fn(async (id: string) => mockAccountsStore[id] ?? null),
  getAllAccounts: vi.fn(async () => Object.values(mockAccountsStore)),
}));

vi.mock("../db/folderSyncState", () => ({
  getFolderSyncState: vi.fn(async () => null),
  upsertFolderSyncState: vi.fn(async () => {}),
}));

vi.mock("./imapConfigBuilder", () => ({
  buildImapConfig: vi.fn((account) => ({
    host: account.imap_host || "imap.example.com",
    port: 993,
    security: "tls",
    username: account.email,
    password: "secret-password",
    auth_method: "password",
  })),
}));

const testConfig: ImapConfig = {
  host: "imap.example.com",
  port: 993,
  security: "tls",
  username: "user@example.com",
  password: "password",
  auth_method: "password",
};

describe("settingsSidecarSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(mockSettingsStore)) delete mockSettingsStore[k];
    for (const k of Object.keys(mockFiltersStore)) delete mockFiltersStore[k];
    for (const k of Object.keys(mockAccountsStore)) delete mockAccountsStore[k];
  });

  describe("folder helpers", () => {
    it("correctly identifies settings folder and subfolders", () => {
      expect(isSettingsFolder(".settings")).toBe(true);
      expect(isSettingsFolder(".settings/general")).toBe(true);
      expect(isSettingsFolder(".settings/filters")).toBe(true);
      expect(isSettingsFolder("INBOX/.settings")).toBe(true);
      expect(isSettingsFolder("INBOX")).toBe(false);

      expect(isGeneralSettingsFolder(".settings/general")).toBe(true);
      expect(isGeneralSettingsFolder(".settings/filters")).toBe(false);
      expect(isGeneralSettingsFolder("INBOX/.settings/general")).toBe(true);

      expect(isFiltersSettingsFolder(".settings/filters")).toBe(true);
      expect(isFiltersSettingsFolder(".settings/general")).toBe(false);
      expect(isFiltersSettingsFolder("INBOX/.settings/filters")).toBe(true);
    });

    it("ensures .settings folder and subfolders exist on the server", async () => {
      // 1. Folders already exist
      mockCommands.imapListFolders.mockResolvedValueOnce([
        { path: "INBOX", name: "INBOX", raw_path: "INBOX" },
        { path: ".settings", name: ".settings", raw_path: ".settings" },
        { path: ".settings/general", name: "general", raw_path: ".settings/general" },
      ]);

      const generalFolder = await ensureSettingsFolder(testConfig, "general");
      expect(generalFolder).toBe(".settings/general");
      expect(mockCommands.imapCreateFolder).not.toHaveBeenCalled();

      // 2. Folders don't exist: creates parent and subfolder
      mockCommands.imapListFolders.mockResolvedValueOnce([
        { path: "INBOX", name: "INBOX", raw_path: "INBOX", delimiter: "/" },
      ]);
      mockCommands.imapCreateFolder.mockResolvedValue(undefined);

      const filtersFolder = await ensureSettingsFolder(testConfig, "filters");
      expect(filtersFolder).toBe(".settings/filters");
      expect(mockCommands.imapCreateFolder).toHaveBeenCalledWith(testConfig, ".settings");
      expect(mockCommands.imapCreateFolder).toHaveBeenCalledWith(testConfig, ".settings/filters");
    });
  });

  describe("buildSettingsEmail", () => {
    it("constructs an RFC 2822 email for general settings with proper headers", () => {
      const payload: GeneralSettingsPayload = {
        version: 1,
        updatedAt: 1710000000,
        settings: { theme: "dark", undo_send_delay_seconds: "10" },
      };

      const email = buildSettingsEmail("user@example.com", "general", payload);
      expect(email).toContain("From: <user@example.com>");
      expect(email).toContain("To: <user@example.com>");
      expect(email).toContain("Subject: SuperMail-Settings: general");
      expect(email).toContain("X-SuperMail-Sidecar: true");
      expect(email).toContain("X-SuperMail-Settings-Type: general");
      expect(email).toContain('"theme": "dark"');
    });

    it("constructs an RFC 2822 email for filters with proper headers", () => {
      const payload: FiltersSettingsPayload = {
        version: 1,
        updatedAt: 1710000000,
        filters: [
          {
            id: "f-1",
            name: "Important VIP",
            isEnabled: true,
            criteria: { from: "vip@example.com" },
            actions: { star: true },
          },
        ],
      };

      const email = buildSettingsEmail("user@example.com", "filters", payload);
      expect(email).toContain("Subject: SuperMail-Settings: filters");
      expect(email).toContain("X-SuperMail-Settings-Type: filters");
      expect(email).toContain('"vip@example.com"');
    });
  });

  describe("uploadSettingsReplacement", () => {
    it("appends the new message and deletes old UIDs from the folder", async () => {
      mockCommands.imapListFolders.mockResolvedValue([
        { path: ".settings/general", name: "general", raw_path: ".settings/general" },
      ]);
      mockCommands.imapSearchAllUids.mockResolvedValue([101, 102]);
      mockCommands.imapAppendMessage.mockResolvedValue(undefined);
      mockCommands.imapDeleteMessages.mockResolvedValue(undefined);

      const payload: GeneralSettingsPayload = {
        version: 1,
        updatedAt: 1710000000,
        settings: { theme: "light" },
      };

      await uploadSettingsReplacement(testConfig, "user@example.com", "general", payload);

      expect(mockCommands.imapAppendMessage).toHaveBeenCalledWith(
        testConfig,
        ".settings/general",
        expect.any(String),
        "(\\Seen)"
      );
      expect(mockCommands.imapDeleteMessages).toHaveBeenCalledWith(
        testConfig,
        ".settings/general",
        [101, 102]
      );
    });
  });

  describe("applyFilterChangeAndUpload", () => {
    it("adds a new filter to the existing settings message and uploads replacement", async () => {
      mockCommands.imapListFolders.mockResolvedValue([
        { path: ".settings/filters", name: "filters", raw_path: ".settings/filters" },
      ]);
      mockCommands.imapSearchAllUids.mockResolvedValue([200]);
      mockCommands.imapFetchMessages.mockResolvedValue({
        messages: [
          {
            uid: 200,
            body_text: JSON.stringify({
              version: 1,
              updatedAt: 1700000000,
              filters: [
                {
                  id: "existing-1",
                  name: "Existing Rule",
                  isEnabled: true,
                  criteria: { subject: "urgent" },
                  actions: { star: true },
                },
              ],
            }),
          },
        ],
      });
      mockCommands.imapAppendMessage.mockResolvedValue(undefined);
      mockCommands.imapDeleteMessages.mockResolvedValue(undefined);
      mockDb.select.mockResolvedValue([]);

      const newFilter: FilterRulePayload = {
        id: "filter-2",
        name: "Newsletters",
        isEnabled: true,
        criteria: { from: "news@example.com" },
        actions: { markRead: true },
      };

      const result = await applyFilterChangeAndUpload(
        testConfig,
        "user@example.com",
        { action: "add", filter: newFilter },
        "acc-1"
      );

      expect(result.filters).toHaveLength(2);
      expect(result.filters.map((f) => f.id)).toEqual(["existing-1", "filter-2"]);
      expect(mockCommands.imapAppendMessage).toHaveBeenCalledTimes(1);
      expect(mockCommands.imapDeleteMessages).toHaveBeenCalledWith(
        testConfig,
        ".settings/filters",
        [200]
      );
    });

    it("updates an existing filter and uploads replacement", async () => {
      mockCommands.imapListFolders.mockResolvedValue([
        { path: ".settings/filters", name: "filters", raw_path: ".settings/filters" },
      ]);
      mockCommands.imapSearchAllUids.mockResolvedValue([201]);
      mockCommands.imapFetchMessages.mockResolvedValue({
        messages: [
          {
            uid: 201,
            body_text: JSON.stringify({
              version: 1,
              updatedAt: 1700000000,
              filters: [
                {
                  id: "f-update",
                  name: "Old Name",
                  isEnabled: true,
                  criteria: { subject: "test" },
                  actions: { star: true },
                },
              ],
            }),
          },
        ],
      });
      mockCommands.imapAppendMessage.mockResolvedValue(undefined);
      mockCommands.imapDeleteMessages.mockResolvedValue(undefined);
      mockDb.select.mockResolvedValue([]);

      const updatedFilter: FilterRulePayload = {
        id: "f-update",
        name: "New Name",
        isEnabled: false,
        criteria: { subject: "updated" },
        actions: { star: false },
      };

      const result = await applyFilterChangeAndUpload(
        testConfig,
        "user@example.com",
        { action: "update", filter: updatedFilter },
        "acc-1"
      );

      expect(result.filters).toHaveLength(1);
      expect(result.filters[0].name).toBe("New Name");
      expect(result.filters[0].isEnabled).toBe(false);
      expect(mockCommands.imapDeleteMessages).toHaveBeenCalledWith(
        testConfig,
        ".settings/filters",
        [201]
      );
    });

    it("deletes a filter and uploads replacement", async () => {
      mockCommands.imapListFolders.mockResolvedValue([
        { path: ".settings/filters", name: "filters", raw_path: ".settings/filters" },
      ]);
      mockCommands.imapSearchAllUids.mockResolvedValue([202]);
      mockCommands.imapFetchMessages.mockResolvedValue({
        messages: [
          {
            uid: 202,
            body_text: JSON.stringify({
              version: 1,
              updatedAt: 1700000000,
              filters: [
                {
                  id: "to-delete",
                  name: "To Delete",
                  isEnabled: true,
                  criteria: {},
                  actions: {},
                },
                {
                  id: "to-keep",
                  name: "To Keep",
                  isEnabled: true,
                  criteria: {},
                  actions: {},
                },
              ],
            }),
          },
        ],
      });
      mockCommands.imapAppendMessage.mockResolvedValue(undefined);
      mockCommands.imapDeleteMessages.mockResolvedValue(undefined);
      mockDb.select.mockResolvedValue([]);

      const result = await applyFilterChangeAndUpload(
        testConfig,
        "user@example.com",
        { action: "delete", filter: { id: "to-delete" } },
        "acc-1"
      );

      expect(result.filters).toHaveLength(1);
      expect(result.filters[0].id).toBe("to-keep");
      expect(mockCommands.imapDeleteMessages).toHaveBeenCalledWith(
        testConfig,
        ".settings/filters",
        [202]
      );
    });
  });

  describe("applyGeneralSettingChangeAndUpload", () => {
    it("updates general setting and uploads replacement to .settings/general", async () => {
      mockCommands.imapListFolders.mockResolvedValue([
        { path: ".settings/general", name: "general", raw_path: ".settings/general" },
      ]);
      mockCommands.imapSearchAllUids.mockResolvedValue([300]);
      mockCommands.imapFetchMessages.mockResolvedValue({
        messages: [
          {
            uid: 300,
            body_text: JSON.stringify({
              version: 1,
              updatedAt: 1700000000,
              settings: { theme: "system" },
            }),
          },
        ],
      });
      mockCommands.imapAppendMessage.mockResolvedValue(undefined);
      mockCommands.imapDeleteMessages.mockResolvedValue(undefined);

      const result = await applyGeneralSettingChangeAndUpload(
        testConfig,
        "user@example.com",
        "theme",
        "dark"
      );

      expect(result.settings.theme).toBe("dark");
      expect(mockSettingsStore.theme).toBe("dark");
      expect(mockCommands.imapAppendMessage).toHaveBeenCalledTimes(1);
      expect(mockCommands.imapDeleteMessages).toHaveBeenCalledWith(
        testConfig,
        ".settings/general",
        [300]
      );
    });
  });

  describe("syncGeneralSettings and syncFilterSettings", () => {
    it("syncs general settings from IMAP into local database", async () => {
      mockCommands.imapListFolders.mockResolvedValue([
        { path: ".settings/general", name: "general", raw_path: ".settings/general" },
      ]);
      mockCommands.imapSearchAllUids.mockResolvedValue([1, 2]); // 2 is latest, 1 is duplicate/old
      mockCommands.imapFetchMessages.mockResolvedValue({
        messages: [
          {
            uid: 2,
            body_text: JSON.stringify({
              version: 1,
              updatedAt: 1715000000,
              settings: {
                theme: "rose",
                reading_pane_position: "bottom",
              },
            }),
          },
        ],
      });
      mockCommands.imapGetFolderStatus.mockResolvedValue({
        uidvalidity: 10,
        highest_modseq: 100,
      });

      const synced = await syncGeneralSettings("acc-1", testConfig);
      expect(synced).toEqual({
        theme: "rose",
        reading_pane_position: "bottom",
      });
      expect(mockSettingsStore.theme).toBe("rose");
      expect(mockSettingsStore.reading_pane_position).toBe("bottom");
      // Old UID 1 was deleted
      expect(mockCommands.imapDeleteMessages).toHaveBeenCalledWith(
        testConfig,
        ".settings/general",
        [1]
      );
    });

    it("syncs filters from IMAP into local database", async () => {
      mockCommands.imapListFolders.mockResolvedValue([
        { path: ".settings/filters", name: "filters", raw_path: ".settings/filters" },
      ]);
      mockCommands.imapSearchAllUids.mockResolvedValue([5]);
      mockCommands.imapFetchMessages.mockResolvedValue({
        messages: [
          {
            uid: 5,
            body_text: JSON.stringify({
              version: 1,
              updatedAt: 1715000000,
              filters: [
                {
                  id: "rf-1",
                  name: "Remote Filter",
                  isEnabled: true,
                  criteria: { from: "alerts@service.com" },
                  actions: { star: true },
                },
              ],
            }),
          },
        ],
      });
      mockCommands.imapGetFolderStatus.mockResolvedValue({
        uidvalidity: 20,
        highest_modseq: 200,
      });
      mockDb.select.mockResolvedValue([]); // No local filters to delete

      const synced = await syncFilterSettings("acc-1", testConfig);
      expect(synced).toHaveLength(1);
      expect(synced![0].id).toBe("rf-1");
      expect(mockDb.execute).toHaveBeenCalled();
    });
  });

  describe("account helpers", () => {
    it("uploadFilterSettingsForAccount uploads for IMAP account", async () => {
      mockAccountsStore["acc-imap"] = {
        id: "acc-imap",
        email: "imap@example.com",
        provider: "imap",
        imap_host: "imap.example.com",
      };
      mockFiltersStore["acc-imap"] = [
        {
          id: "f-1",
          name: "Test",
          is_enabled: 1,
          criteria_json: "{}",
          actions_json: "{}",
          sort_order: 0,
          created_at: 1000,
        },
      ];
      mockCommands.imapListFolders.mockResolvedValue([
        { path: ".settings/filters", name: "filters", raw_path: ".settings/filters" },
      ]);
      mockCommands.imapSearchAllUids.mockResolvedValue([]);
      mockCommands.imapAppendMessage.mockResolvedValue(undefined);

      await uploadFilterSettingsForAccount("acc-imap");
      expect(mockCommands.imapAppendMessage).toHaveBeenCalledTimes(1);
    });

    it("syncSettingsForAccount coordinates general and filters sync", async () => {
      mockAccountsStore["acc-imap"] = {
        id: "acc-imap",
        email: "imap@example.com",
        provider: "imap",
        imap_host: "imap.example.com",
      };
      mockCommands.imapListFolders.mockResolvedValue([
        { path: ".settings/general", name: "general", raw_path: ".settings/general" },
        { path: ".settings/filters", name: "filters", raw_path: ".settings/filters" },
      ]);
      mockCommands.imapSearchAllUids.mockResolvedValue([1]);
      mockCommands.imapFetchMessages.mockImplementation((_c, folder) => {
        if (folder.includes("general")) {
          return Promise.resolve({
            messages: [
              {
                uid: 1,
                body_text: JSON.stringify({ version: 1, updatedAt: 100, settings: { theme: "dark" } }),
              },
            ],
          });
        }
        return Promise.resolve({
          messages: [
            {
              uid: 1,
              body_text: JSON.stringify({ version: 1, updatedAt: 100, filters: [] }),
            },
          ],
        });
      });
      mockCommands.imapGetFolderStatus.mockResolvedValue({ uidvalidity: 1, highest_modseq: 1 });
      mockDb.select.mockResolvedValue([]);

      const result = await syncSettingsForAccount("acc-imap");
      expect(result).toEqual({ general: true, filters: true });
      expect(mockSettingsStore.theme).toBe("dark");
    });
  });
});
