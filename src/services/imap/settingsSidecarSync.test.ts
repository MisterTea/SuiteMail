// @vitest-environment node
import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import {
  ensureSettingsFolder,
  buildSettingsEmail,
  uploadSettingsReplacement,
  applyGeneralSettingChangeAndUpload,
  uploadGeneralSettings,
  syncGeneralSettings,
  syncFilterSettings,
  syncMailRules,
  uploadGeneralSettingsForAccount,
  syncSettingsForAccount,
  isGeneralSettingsFolder,
  isFiltersSettingsFolder,
  isSettingsFolder,
  SETTINGS_SIDECAR_FOLDER,
  SETTINGS_GENERAL_FOLDER,
  SETTINGS_FILTERS_FOLDER,
  type GeneralSettingsPayload,
  type FiltersSettingsPayload,
} from "./settingsSidecarSync";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { MIGRATIONS } from "../db/migrations";
import { insertSmartFolder, getSmartFolders, updateSmartFolder } from "../db/smartFolders";
import { insertSmartLabelRule, getSmartLabelRulesForAccount, updateSmartLabelRule } from "../db/smartLabelRules";
import { deleteQuickStep, getQuickStepsForAccount, insertQuickStep } from "../db/quickSteps";
import { seedDefaultQuickSteps } from "../quickSteps/defaults";
import { subscribeToSyncedMailRules } from "../db/mailRuleChanges";
import PostalMime from "postal-mime";
import type { ImapConfig } from "./electronCommands";
import { notifyFilterChange } from "../db/filters";

const mockCommands = {
  imapListFolders: vi.fn(),
  imapCreateFolder: vi.fn(),
  imapAppendMessage: vi.fn(),
  imapSearchAllUids: vi.fn(),
  imapFetchMessages: vi.fn(),
  imapFetchRawMessage: vi.fn(),
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
  imapFetchRawMessage: vi.fn((config, folder, uid) => mockCommands.imapFetchRawMessage(config, folder, uid)),
  imapDeleteMessages: vi.fn((config, folder, uids) => mockCommands.imapDeleteMessages(config, folder, uids)),
  imapGetFolderStatus: vi.fn((config, folder) => mockCommands.imapGetFolderStatus(config, folder)),
}));

const mockDb = {
  select: vi.fn(),
  execute: vi.fn(),
};

vi.mock("../db/connection", async (importOriginal) => ({
  ...await importOriginal<typeof import("../db/connection")>(),
  getDb: vi.fn(async () => mockDb),
  withTransaction: vi.fn(async (fn) => fn(mockDb)),
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
  withFilterWriteLock: vi.fn(async (write) => write()),
  notifyFilterChange: vi.fn(),
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
    mockDb.select.mockReset().mockResolvedValue([]);
    mockDb.execute.mockReset().mockResolvedValue({ rowsAffected: 0 });
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
        settings: {
          theme: "dark", reading_pane_position: "bottom", sidebar_nav_config: "[]",
          notifications_enabled: "false", smart_notifications: "true", notify_categories: "Primary",
          "mail_notification_schedule:acc-id": "{}",
          undo_send_delay_seconds: "10",
        },
      };

      const email = buildSettingsEmail("user@example.com", "general", payload);
      expect(email).toContain("From: <user@example.com>");
      expect(email).toContain("To: <user@example.com>");
      expect(email).toContain("Subject: SuperMail-Settings: general");
      expect(email).toContain("X-SuperMail-Sidecar: true");
      expect(email).toContain("X-SuperMail-Settings-Type: general");
      expect(JSON.parse(email.split("\r\n\r\n")[1]!)).toEqual({
        version: 1, updatedAt: 1710000000, settings: { undo_send_delay_seconds: "10" },
      });
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
              settings: { theme: "system", undo_send_delay_seconds: "5" },
            }),
          },
        ],
      });
      mockCommands.imapAppendMessage.mockResolvedValue(undefined);
      mockCommands.imapDeleteMessages.mockResolvedValue(undefined);

      const result = await applyGeneralSettingChangeAndUpload(
        testConfig,
        "user@example.com",
        "undo_send_delay_seconds",
        "10"
      );

      expect(result.settings).toEqual({ undo_send_delay_seconds: "10" });
      expect(mockSettingsStore.undo_send_delay_seconds).toBe("10");
      expect(mockCommands.imapAppendMessage).toHaveBeenCalledTimes(1);
      expect(mockCommands.imapDeleteMessages).toHaveBeenCalledWith(
        testConfig,
        ".settings/general",
        [300]
      );
    });
    it("saves a notification preference locally without touching IMAP", async () => {
      await applyGeneralSettingChangeAndUpload(testConfig, testConfig.username, "notifications_enabled", "false");
      expect(mockSettingsStore.notifications_enabled).toBe("false");
      expect(mockCommands.imapListFolders).not.toHaveBeenCalled();
      expect(mockCommands.imapAppendMessage).not.toHaveBeenCalled();
    });
  });

  describe("syncGeneralSettings and syncFilterSettings", () => {
    it("imports general settings without overwriting local appearance or notifications", async () => {
      Object.assign(mockSettingsStore, { theme: "dark", notifications_enabled: "true" });
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
                notifications_enabled: "false",
                "mail_notification_schedule:acc-id": "{}",
                undo_send_delay_seconds: "10",
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
      expect(synced).toEqual({ undo_send_delay_seconds: "10" });
      expect(mockSettingsStore).toEqual({
        theme: "dark", notifications_enabled: "true", undo_send_delay_seconds: "10",
      });
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

  describe("filter exchange across devices", () => {
    const folder = ".settings/filters";
    const laptop = "laptop-local-account";
    const phone = "android-local-account";
    const rule = {
      id: "same-rule-id",
      name: "Filtres — café",
      isEnabled: false,
      criteria: { from: "alerts@example.com" },
      actions: { applyLabel: "folder-Alerts" },
      sortOrder: -3,
      createdAt: 1000,
    };
    const mail = new Map<number, string>();
    const baselines = new Map<string, string>();
    let nextUid: number;

    function localRule(accountId: string, filter = rule) {
      return {
        id: filter.id,
        account_id: accountId,
        name: filter.name,
        is_enabled: Number(filter.isEnabled),
        criteria_json: JSON.stringify(filter.criteria),
        actions_json: JSON.stringify(filter.actions),
        sort_order: filter.sortOrder,
        created_at: filter.createdAt,
      };
    }

    beforeEach(() => {
      mail.clear();
      baselines.clear();
      nextUid = 1;
      mockCommands.imapListFolders.mockResolvedValue([{ path: folder, raw_path: folder }]);
      mockCommands.imapSearchAllUids.mockImplementation(async () => [...mail.keys()]);
      mockCommands.imapAppendMessage.mockImplementation(async (_config, _folder, raw) => {
        mail.set(nextUid++, Buffer.from(raw, "base64url").toString("utf8"));
      });
      mockCommands.imapDeleteMessages.mockImplementation(async (_config, _folder, uids) => {
        for (const uid of uids) mail.delete(uid);
      });
      mockCommands.imapFetchMessages.mockImplementation(async (_config, _folder, uids) => ({
        messages: await Promise.all(uids.filter((uid: number) => mail.has(uid)).map(async (uid: number) => {
          const decoded = await PostalMime.parse(mail.get(uid)!);
          return { uid, body_text: decoded.text, body_html: decoded.html };
        })),
      }));
      mockCommands.imapFetchRawMessage.mockImplementation(async (_config, _folder, uid) => mail.get(uid));
      mockDb.select.mockImplementation(async (_sql, [accountId]) => {
        const filters_json = baselines.get(accountId);
        return filters_json === undefined ? [] : [{ filters_json }];
      });
      mockDb.execute.mockImplementation(async (sql, params) => {
        if (sql.startsWith("INSERT INTO imap_filter_sync_state")) baselines.set(params[0], params[1]);
        if (sql.startsWith("INSERT INTO filter_rules")) {
          const [id, account_id, name, is_enabled, criteria_json, actions_json, sort_order, created_at] = params;
          const filters = (mockFiltersStore[account_id] ?? []).filter((f) => f.id !== id);
          mockFiltersStore[account_id] = [...filters, { id, account_id, name, is_enabled, criteria_json, actions_json, sort_order, created_at }];
        }
        if (sql.startsWith("DELETE FROM filter_rules")) {
          mockFiltersStore[params[0]] = mockFiltersStore[params[0]].filter((f) => f.id !== params[1]);
        }
      });
    });

    it("publishes an existing laptop rule and imports it on Android without re-uploading it", async () => {
      mockFiltersStore[laptop] = [localRule(laptop)];
      mockCommands.imapListFolders.mockResolvedValueOnce([{ path: "INBOX", name: "INBOX", delimiter: "/" }]);
      mockCommands.imapListFolders.mockResolvedValueOnce([{ path: "INBOX", name: "INBOX", delimiter: "/" }]);

      await syncFilterSettings(laptop, testConfig, { strict: true });
      expect(await syncFilterSettings(phone, testConfig, { strict: true })).toEqual([rule]);
      expect(mockFiltersStore[phone]).toEqual([localRule(phone)]);
      expect(notifyFilterChange).toHaveBeenCalledWith({ accountId: phone, action: "sync" });
      expect(mockCommands.imapCreateFolder).toHaveBeenCalledWith(testConfig, folder);
      expect(mockCommands.imapAppendMessage).toHaveBeenCalledTimes(1);
      expect(mail.get(1)).toContain("Content-Type: text/plain; charset=utf-8");
    });

    it("reads previously uploaded application/json messages through the raw IMAP fetch", async () => {
      mail.set(nextUid++, buildSettingsEmail(testConfig.username, "filters", {
        version: 1, updatedAt: 1000, filters: [rule],
      }).replace("text/plain", "application/json"));

      expect(await syncFilterSettings(phone, testConfig, { strict: true })).toEqual([rule]);
      expect(mockCommands.imapFetchRawMessage).toHaveBeenCalledWith(testConfig, folder, 1);
      expect(mockCommands.imapAppendMessage).not.toHaveBeenCalled();
    });

    it("retries a failed offline deletion and applies both the deletion and a new rule across devices", async () => {
      mockFiltersStore[laptop] = [localRule(laptop)];
      await syncFilterSettings(laptop, testConfig, { strict: true });
      await syncFilterSettings(phone, testConfig, { strict: true });

      mockFiltersStore[phone] = [];
      mockCommands.imapAppendMessage.mockRejectedValueOnce(new Error("Offline"));
      await expect(syncFilterSettings(phone, testConfig, { strict: true })).rejects.toThrow("Offline");
      expect(mockFiltersStore[phone]).toEqual([]);

      const unrelated = { ...rule, id: "new-rule", name: "New rule" };
      mockFiltersStore[laptop].push(localRule(laptop, unrelated));
      await syncFilterSettings(laptop, testConfig, { strict: true });
      expect(await syncFilterSettings(phone, testConfig, { strict: true })).toEqual([unrelated]);
      expect(await syncFilterSettings(laptop, testConfig, { strict: true })).toEqual([unrelated]);
      expect(mockFiltersStore[laptop]).toEqual([localRule(laptop, unrelated)]);
    });

    it("merges simultaneous snapshots from two devices", async () => {
      const extra = { ...rule, id: "other-rule", name: "Other rule" };
      mockFiltersStore[laptop] = [localRule(laptop)];
      mockFiltersStore[phone] = [localRule(phone, extra)];

      let releaseFirstAppend!: () => void;
      const firstAppendBlocked = new Promise<void>((resolve) => { releaseFirstAppend = resolve; });
      let startSecondSync!: () => void;
      const firstAppendReached = new Promise<void>((resolve) => { startSecondSync = resolve; });
      mockCommands.imapAppendMessage.mockImplementationOnce(async (_config, _folder, raw) => {
        startSecondSync();
        await firstAppendBlocked;
        mail.set(nextUid++, Buffer.from(raw, "base64url").toString("utf8"));
      });

      const laptopSync = syncFilterSettings(laptop, testConfig, { strict: true });
      await firstAppendReached;
      try {
        await syncFilterSettings(phone, testConfig, { strict: true });
      } finally {
        releaseFirstAppend();
      }
      await laptopSync;

      for (const device of [laptop, phone]) {
        expect(await syncFilterSettings(device, testConfig, { strict: true }))
          .toEqual(expect.arrayContaining([rule, extra]));
        expect(mockFiltersStore[device]).toHaveLength(2);
      }
      expect(mockCommands.imapAppendMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe("mail rules exchange with two SQLite databases and one IMAP folder", () => {
    const folder = "INBOX.settings.rules";
    const laptop = "laptop";
    const phone = "phone";
    const otherAccount = "other-account";
    let devices: Record<string, DatabaseSync>;
    let activeDb: DatabaseSync;
    let messages: Map<number, string>;
    let nextUid: number;

    function database(accountId: string) {
      const db = new DatabaseSync(":memory:");
      for (const migration of MIGRATIONS.filter(({ version }) => [1, 8, 12, 22, 36].includes(version))) {
        db.exec(migration.sql);
      }
      db.prepare("INSERT INTO accounts (id, email) VALUES (?, ?)").run(accountId, testConfig.username);
      db.prepare("INSERT INTO accounts (id, email) VALUES (?, ?)").run(otherAccount, "other@example.org");
      return db;
    }

    function sync(accountId: string) {
      activeDb = devices[accountId]!;
      return syncMailRules(accountId, testConfig, testConfig.username);
    }

    beforeEach(() => {
      devices = { [laptop]: database(laptop), [phone]: database(phone) };
      activeDb = devices[laptop]!;
      messages = new Map();
      nextUid = 1;
      const params = (values: SQLInputValue[]) =>
        Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]));
      mockDb.select.mockImplementation(async (sql, values = []) => activeDb.prepare(sql).all(params(values)));
      mockDb.execute.mockImplementation(async (sql, values = []) => {
        const result = activeDb.prepare(sql).run(params(values));
        return { rowsAffected: Number(result.changes) };
      });
      mockCommands.imapListFolders.mockImplementation(async () => messages.size
        ? [{ path: folder, name: "rules", raw_path: folder, delimiter: "." }]
        : [{ path: "INBOX.settings", name: "settings", raw_path: "INBOX.settings", delimiter: "." }]);
      mockCommands.imapSearchAllUids.mockImplementation(async () => [...messages.keys()]);
      mockCommands.imapFetchMessages.mockImplementation(async (_config, _folder, uids: number[]) => ({
        messages: await Promise.all(uids.map(async (uid) => {
          const decoded = await PostalMime.parse(messages.get(uid)!);
          return { uid, body_text: decoded.text };
        })),
      }));
      mockCommands.imapAppendMessage.mockImplementation(async (_config, destination, wire) => {
        expect(destination).toBe(folder);
        messages.set(nextUid++, Buffer.from(wire, "base64url").toString("utf8"));
      });
      mockCommands.imapDeleteMessages.mockImplementation(async (_config, _folder, uids: number[]) => {
        for (const uid of uids) messages.delete(uid);
      });
    });

    afterEach(() => Object.values(devices).forEach((db) => db.close()));

    it("syncs existing Smart Labels, scoped and global Smart Folders, and Quick Steps in both directions", async () => {
      const label = await insertSmartLabelRule({
        accountId: laptop, labelId: "folder-Alerts", aiDescription: "Delivery alerts", isEnabled: false,
      });
      const savedSearch = await insertSmartFolder({ accountId: laptop, name: "Orders", query: "subject:orders" });
      const globalSearch = await insertSmartFolder({ name: "Everywhere", query: "has:attachment" });
      await updateSmartFolder("sf-unread", { name: "My unread" });
      await insertSmartFolder({ accountId: otherAccount, name: "Other mailbox", query: "subject:private" });
      const step = await insertQuickStep({
        accountId: laptop, name: "Triage", actions: [{ type: "archive" }, { type: "star" }], shortcut: "Ctrl+8",
      });

      await sync(laptop);
      expect(mockCommands.imapCreateFolder).toHaveBeenCalledWith(testConfig, folder);
      expect(isSettingsFolder(folder)).toBe(true);
      const refresh = vi.fn();
      const unsubscribe = subscribeToSyncedMailRules("smartFolder", phone, refresh);
      try {
        await sync(phone);
      } finally {
        unsubscribe();
      }
      expect(refresh).toHaveBeenCalledOnce();
      expect(await getSmartLabelRulesForAccount(phone)).toMatchObject([{ id: label, account_id: phone, is_enabled: 0 }]);
      expect(await getSmartFolders(phone)).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: savedSearch, account_id: phone, query: "subject:orders" }),
        expect.objectContaining({ id: globalSearch, account_id: null }),
        expect.objectContaining({ id: "sf-unread", name: "My unread", is_default: 1 }),
      ]));
      expect((await getSmartFolders(phone)).some((entry) => entry.name === "Other mailbox")).toBe(false);
      expect(await getQuickStepsForAccount(phone)).toMatchObject([{ id: step, account_id: phone, shortcut: "Ctrl+8" }]);
      expect(mockCommands.imapAppendMessage).toHaveBeenCalledTimes(1);

      await deleteQuickStep(step);
      await updateSmartLabelRule(label, { isEnabled: true });
      mockCommands.imapAppendMessage.mockRejectedValueOnce(new Error("Offline"));
      await expect(sync(phone)).rejects.toThrow("Offline");
      await sync(phone);
      await sync(laptop);
      expect(await getQuickStepsForAccount(laptop)).toEqual([]);
      await seedDefaultQuickSteps(laptop);
      expect(await getQuickStepsForAccount(laptop)).toEqual([]);
      expect(await getSmartLabelRulesForAccount(laptop)).toMatchObject([{ id: label, is_enabled: 1 }]);
    });

    it("uses matching identities for separately initialized Quick Step presets", async () => {
      await seedDefaultQuickSteps(laptop);
      await sync(laptop);
      activeDb = devices[phone]!;
      await seedDefaultQuickSteps(phone);
      await sync(phone);
      expect(await getQuickStepsForAccount(phone)).toHaveLength(3);
      expect(mockCommands.imapAppendMessage).toHaveBeenCalledTimes(1);
    });

    it("does not seed Quick Steps after downloading their deletions on a device that never used them", async () => {
      await sync(laptop);
      await sync(phone);
      activeDb = devices[laptop]!;
      await seedDefaultQuickSteps(laptop);
      await sync(laptop);
      for (const step of await getQuickStepsForAccount(laptop)) await deleteQuickStep(step.id);
      await sync(laptop);
      await sync(phone);
      await seedDefaultQuickSteps(phone);
      expect(await getQuickStepsForAccount(phone)).toEqual([]);
    });
  });

  describe("account helpers", () => {
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
                body_text: JSON.stringify({ version: 1, updatedAt: 100, settings: { undo_send_delay_seconds: "10" } }),
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
      expect(mockSettingsStore.undo_send_delay_seconds).toBe("10");
    });
  });
});
