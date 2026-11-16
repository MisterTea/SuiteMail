import {
  imapListFolders,
  imapCreateFolder,
  imapAppendMessage,
  imapSearchAllUids,
  imapFetchMessages,
  imapDeleteMessages,
  imapGetFolderStatus,
  type ImapConfig,
} from "./tauriCommands";
import {
  SETTINGS_SIDECAR_FOLDER,
  SETTINGS_GENERAL_FOLDER,
  SETTINGS_FILTERS_FOLDER,
  isSettingsFolder,
} from "./folderMapper";
import { upsertFolderSyncState } from "../db/folderSyncState";
import {
  setSetting,
  getAllSettings,
  addSettingChangeListener,
} from "../db/settings";
import {
  getFiltersForAccount,
  addFilterChangeListener,
  type DbFilterRule,
  type FilterCriteria,
  type FilterActions,
} from "../db/filters";
import { getAccount, getAllAccounts } from "../db/accounts";
import { buildImapConfig } from "./imapConfigBuilder";
import { getDb } from "../db/connection";

export {
  SETTINGS_SIDECAR_FOLDER,
  SETTINGS_GENERAL_FOLDER,
  SETTINGS_FILTERS_FOLDER,
  isSettingsFolder,
};

export interface GeneralSettingsPayload {
  version: number;
  updatedAt: number;
  settings: Record<string, string>;
}

export interface FilterRulePayload {
  id: string;
  name: string;
  isEnabled: boolean;
  criteria: FilterCriteria;
  actions: FilterActions;
  sortOrder?: number;
  createdAt?: number;
}

export interface FiltersSettingsPayload {
  version: number;
  updatedAt: number;
  filters: FilterRulePayload[];
}

/**
 * Check whether a folder path matches the general settings folder.
 */
export function isGeneralSettingsFolder(path: string): boolean {
  const lower = path.toLowerCase().trim();
  return (
    lower === SETTINGS_GENERAL_FOLDER ||
    lower === "settings/general" ||
    lower === ".settings.general" ||
    lower === "settings.general" ||
    lower.endsWith("/" + SETTINGS_GENERAL_FOLDER) ||
    lower.endsWith("/settings/general") ||
    lower.endsWith(".settings.general") ||
    (isSettingsFolder(lower) && (lower.endsWith("/general") || lower.endsWith(".general")))
  );
}

/**
 * Check whether a folder path matches the filters settings folder.
 */
export function isFiltersSettingsFolder(path: string): boolean {
  const lower = path.toLowerCase().trim();
  return (
    lower === SETTINGS_FILTERS_FOLDER ||
    lower === "settings/filters" ||
    lower === ".settings.filters" ||
    lower === "settings.filters" ||
    lower.endsWith("/" + SETTINGS_FILTERS_FOLDER) ||
    lower.endsWith("/settings/filters") ||
    lower.endsWith(".settings.filters") ||
    (isSettingsFolder(lower) && (lower.endsWith("/filters") || lower.endsWith(".filters")))
  );
}

/**
 * Encode a string to URL-safe base64 without padding.
 */
function base64UrlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Ensure the settings folder (or subfolder like .settings/general, .settings/filters) exists on IMAP.
 * Returns the exact folder path string to use for IMAP commands.
 */
export async function ensureSettingsFolder(
  config: ImapConfig,
  subfolder?: "general" | "filters",
): Promise<string> {
  const folders = await imapListFolders(config);

  if (subfolder === "general") {
    const existing = folders.find(
      (f) => isGeneralSettingsFolder(f.path) || isGeneralSettingsFolder(f.name),
    );
    if (existing) return existing.raw_path || existing.path;
  } else if (subfolder === "filters") {
    const existing = folders.find(
      (f) => isFiltersSettingsFolder(f.path) || isFiltersSettingsFolder(f.name),
    );
    if (existing) return existing.raw_path || existing.path;
  } else {
    const existing = folders.find((f) => {
      const lower = f.path.toLowerCase().trim();
      return lower === SETTINGS_SIDECAR_FOLDER || lower === "settings";
    });
    if (existing) return existing.raw_path || existing.path;
  }

  // Ensure parent .settings folder exists first
  const parentFolder = folders.find((f) => {
    const lower = f.path.toLowerCase().trim();
    return lower === SETTINGS_SIDECAR_FOLDER || lower === "settings";
  });
  if (!parentFolder) {
    try {
      await imapCreateFolder(config, SETTINGS_SIDECAR_FOLDER);
    } catch (err) {
      console.warn(`[settingsSidecarSync] Note on creating ${SETTINGS_SIDECAR_FOLDER}:`, err);
    }
  }

  if (!subfolder) {
    return SETTINGS_SIDECAR_FOLDER;
  }

  const delim = parentFolder?.delimiter || folders[0]?.delimiter || "/";
  const targetFolder = `${SETTINGS_SIDECAR_FOLDER}${delim}${subfolder}`;
  try {
    await imapCreateFolder(config, targetFolder);
  } catch (err) {
    console.warn(`[settingsSidecarSync] Note on creating ${targetFolder}:`, err);
  }

  return targetFolder;
}

/**
 * Format a settings payload as an RFC 2822 email message.
 */
export function buildSettingsEmail(
  fromEmail: string,
  type: "general" | "filters",
  payload: GeneralSettingsPayload | FiltersSettingsPayload,
): string {
  const jsonBody = JSON.stringify(payload, null, 2);
  const lines = [
    `From: <${fromEmail}>`,
    `To: <${fromEmail}>`,
    `Subject: SuperMail-Settings: ${type}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <settings-${type}-${Date.now()}@supermail.local>`,
    `X-SuperMail-Sidecar: true`,
    `X-SuperMail-Settings-Type: ${type}`,
    `MIME-Version: 1.0`,
    `Content-Type: application/json; charset=utf-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    jsonBody,
  ];
  return lines.join("\r\n");
}

/**
 * Upload a replacement settings message to IMAP.
 * Appends the new message and deletes any prior message(s) in the folder.
 */
export async function uploadSettingsReplacement(
  config: ImapConfig,
  fromEmail: string,
  type: "general" | "filters",
  payload: GeneralSettingsPayload | FiltersSettingsPayload,
): Promise<void> {
  const folder = await ensureSettingsFolder(config, type);

  // 1. Search for existing UIDs in the settings folder before uploading replacement
  let existingUids: number[] = [];
  try {
    existingUids = await imapSearchAllUids(config, folder);
  } catch (err) {
    console.warn(`[settingsSidecarSync] Error searching UIDs in ${folder}:`, err);
  }

  // 2. Format replacement email and append to the IMAP folder
  const rawRfc = buildSettingsEmail(fromEmail, type, payload);
  const base64Url = base64UrlEncode(rawRfc);
  await imapAppendMessage(config, folder, base64Url, "(\\Seen)");

  // 3. Delete previous settings messages so only the replacement message remains
  if (existingUids.length > 0) {
    try {
      await imapDeleteMessages(config, folder, existingUids);
    } catch (err) {
      console.warn(`[settingsSidecarSync] Error deleting replaced settings UIDs in ${folder}:`, err);
    }
  }
}

/**
 * Fetch the current settings message and parsed payload from the settings folder.
 */
export async function fetchCurrentSettingsMessage<T>(
  config: ImapConfig,
  type: "general" | "filters",
): Promise<{ uids: number[]; payload: T | null; folder: string }> {
  const folder = await ensureSettingsFolder(config, type);
  let uids: number[] = [];
  try {
    uids = await imapSearchAllUids(config, folder);
  } catch {
    return { uids: [], payload: null, folder };
  }

  if (uids.length === 0) {
    return { uids: [], payload: null, folder };
  }

  const latestUid = Math.max(...uids);
  try {
    const res = await imapFetchMessages(config, folder, [latestUid]);
    const msg = res.messages[0];
    if (!msg) {
      return { uids, payload: null, folder };
    }
    const rawText = msg.body_text || msg.body_html || "";
    if (!rawText.trim()) {
      return { uids, payload: null, folder };
    }
    const payload = JSON.parse(rawText.trim()) as T;
    return { uids, payload, folder };
  } catch {
    return { uids, payload: null, folder };
  }
}

/**
 * Convert a DB filter rule to FilterRulePayload.
 */
export function dbFilterToPayload(f: DbFilterRule): FilterRulePayload {
  let criteria: FilterCriteria = {};
  let actions: FilterActions = {};
  try {
    criteria = JSON.parse(f.criteria_json);
  } catch {}
  try {
    actions = JSON.parse(f.actions_json);
  } catch {}
  return {
    id: f.id,
    name: f.name,
    isEnabled: f.is_enabled === 1,
    criteria,
    actions,
    sortOrder: f.sort_order,
    createdAt: f.created_at,
  };
}

/**
 * Reconcile remote filters from .settings/filters into the local SQLite database.
 */
export async function reconcileFiltersToDb(
  accountId: string,
  remoteFilters: FilterRulePayload[],
): Promise<void> {
  const db = await getDb();
  const remoteIds = new Set(remoteFilters.map((f) => f.id));

  // Remove local filters not present in the remote settings message
  const localFilters = await getFiltersForAccount(accountId);
  for (const lf of localFilters) {
    if (!remoteIds.has(lf.id)) {
      await db.execute("DELETE FROM filter_rules WHERE id = $1", [lf.id]);
    }
  }

  // Upsert all remote filters
  for (const rf of remoteFilters) {
    const isEnabled = rf.isEnabled !== false ? 1 : 0;
    const criteriaJson = JSON.stringify(rf.criteria || {});
    const actionsJson = JSON.stringify(rf.actions || {});
    const sortOrder = rf.sortOrder ?? 0;
    const createdAt = rf.createdAt ?? Math.floor(Date.now() / 1000);

    await db.execute(
      `INSERT INTO filter_rules (id, account_id, name, is_enabled, criteria_json, actions_json, sort_order, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT(id) DO UPDATE SET
         name = $3,
         is_enabled = $4,
         criteria_json = $5,
         actions_json = $6,
         sort_order = $7,
         created_at = $8`,
      [rf.id, accountId, rf.name, isEnabled, criteriaJson, actionsJson, sortOrder, createdAt],
    );
  }
}

/**
 * Apply a filter change (add, update, delete) to the settings message and upload a replacement.
 */
export async function applyFilterChangeAndUpload(
  config: ImapConfig,
  fromEmail: string,
  change: {
    action: "add" | "update" | "delete";
    filter: FilterRulePayload | { id: string };
  },
  accountId?: string,
): Promise<FiltersSettingsPayload> {
  const { payload: remotePayload } = await fetchCurrentSettingsMessage<FiltersSettingsPayload>(
    config,
    "filters",
  );

  let currentFilters: FilterRulePayload[] = [];
  if (remotePayload && Array.isArray(remotePayload.filters)) {
    currentFilters = [...remotePayload.filters];
  } else if (accountId) {
    const local = await getFiltersForAccount(accountId);
    currentFilters = local.map(dbFilterToPayload);
  }

  if (change.action === "add") {
    const newFilter = change.filter as FilterRulePayload;
    currentFilters = currentFilters.filter((f) => f.id !== newFilter.id);
    currentFilters.push(newFilter);
  } else if (change.action === "update") {
    const updatedFilter = change.filter as FilterRulePayload;
    const index = currentFilters.findIndex((f) => f.id === updatedFilter.id);
    if (index >= 0) {
      currentFilters[index] = { ...currentFilters[index], ...updatedFilter };
    } else {
      currentFilters.push(updatedFilter);
    }
  } else if (change.action === "delete") {
    currentFilters = currentFilters.filter((f) => f.id !== change.filter.id);
  }

  const newPayload: FiltersSettingsPayload = {
    version: 1,
    updatedAt: Date.now(),
    filters: currentFilters,
  };

  await uploadSettingsReplacement(config, fromEmail, "filters", newPayload);

  if (accountId) {
    await reconcileFiltersToDb(accountId, currentFilters);
  }

  return newPayload;
}

/**
 * Apply a general setting change to the settings message and upload a replacement.
 */
export async function applyGeneralSettingChangeAndUpload(
  config: ImapConfig,
  fromEmail: string,
  key: string,
  value: string,
): Promise<GeneralSettingsPayload> {
  const { payload: remotePayload } = await fetchCurrentSettingsMessage<GeneralSettingsPayload>(
    config,
    "general",
  );

  let currentSettings: Record<string, string> = {};
  if (remotePayload && remotePayload.settings) {
    currentSettings = { ...remotePayload.settings };
  } else {
    currentSettings = await getAllSettings();
  }

  currentSettings[key] = value;

  const newPayload: GeneralSettingsPayload = {
    version: 1,
    updatedAt: Date.now(),
    settings: currentSettings,
  };

  await uploadSettingsReplacement(config, fromEmail, "general", newPayload);
  await setSetting(key, value, { skipNotify: true });

  return newPayload;
}

/**
 * Upload all filters as a replacement settings message to .settings/filters.
 */
export async function uploadFilterSettings(
  config: ImapConfig,
  fromEmail: string,
  filters: (DbFilterRule | FilterRulePayload)[],
): Promise<void> {
  const payload: FiltersSettingsPayload = {
    version: 1,
    updatedAt: Date.now(),
    filters: filters.map((f) => ("criteria_json" in f ? dbFilterToPayload(f) : f)),
  };
  await uploadSettingsReplacement(config, fromEmail, "filters", payload);
}

/**
 * Upload all general settings as a replacement settings message to .settings/general.
 */
export async function uploadGeneralSettings(
  config: ImapConfig,
  fromEmail: string,
  settings: Record<string, string>,
): Promise<void> {
  const payload: GeneralSettingsPayload = {
    version: 1,
    updatedAt: Date.now(),
    settings,
  };
  await uploadSettingsReplacement(config, fromEmail, "general", payload);
}

/**
 * Pull and apply general settings from .settings/general.
 */
export async function syncGeneralSettings(
  accountId: string,
  config: ImapConfig,
): Promise<Record<string, string> | null> {
  const folders = await imapListFolders(config);
  const generalFolder = folders.find(
    (f) => isGeneralSettingsFolder(f.path) || isGeneralSettingsFolder(f.name),
  );
  if (!generalFolder) return null;

  const folderPath = generalFolder.raw_path || generalFolder.path;
  const uids = await imapSearchAllUids(config, folderPath);
  if (uids.length === 0) return null;

  const latestUid = Math.max(...uids);
  const fetchResult = await imapFetchMessages(config, folderPath, [latestUid]);
  const msg = fetchResult.messages[0];
  if (!msg) return null;

  const rawText = msg.body_text || msg.body_html || "";
  if (!rawText.trim()) return null;

  try {
    const payload = JSON.parse(rawText.trim()) as GeneralSettingsPayload;
    if (payload && payload.settings) {
      for (const [key, value] of Object.entries(payload.settings)) {
        await setSetting(key, value, { skipNotify: true });
      }

      // If PGP keys were in the synced settings, ensure local pgp_identities is updated
      if (
        (payload.settings.pgp_public_key || payload.settings.pgp_armored_public_key) &&
        (payload.settings.pgp_private_key || payload.settings.pgp_armored_private_key)
      ) {
        try {
          const { syncPgpKeysFromSettings } = await import("../crypto/pgpService");
          await syncPgpKeysFromSettings();
        } catch (e) {
          console.warn("[settingsSidecarSync] Note on syncing PGP keys from settings:", e);
        }
      }

      // Clean up any old duplicate messages
      const oldUids = uids.filter((u) => u !== latestUid);
      if (oldUids.length > 0) {
        try {
          await imapDeleteMessages(config, folderPath, oldUids);
        } catch {
          // best effort
        }
      }

      const status = await imapGetFolderStatus(config, folderPath);
      await upsertFolderSyncState({
        account_id: accountId,
        folder_path: folderPath,
        uidvalidity: status.uidvalidity,
        last_uid: latestUid,
        modseq: status.highest_modseq,
        last_sync_at: Date.now(),
      });

      return payload.settings;
    }
  } catch (err) {
    console.warn(`[settingsSidecarSync] Failed to parse general settings payload:`, err);
  }

  return null;
}

/**
 * Pull and apply filters from .settings/filters.
 */
export async function syncFilterSettings(
  accountId: string,
  config: ImapConfig,
): Promise<FilterRulePayload[] | null> {
  const folders = await imapListFolders(config);
  const filtersFolder = folders.find(
    (f) => isFiltersSettingsFolder(f.path) || isFiltersSettingsFolder(f.name),
  );
  if (!filtersFolder) return null;

  const folderPath = filtersFolder.raw_path || filtersFolder.path;
  const uids = await imapSearchAllUids(config, folderPath);
  if (uids.length === 0) return null;

  const latestUid = Math.max(...uids);
  const fetchResult = await imapFetchMessages(config, folderPath, [latestUid]);
  const msg = fetchResult.messages[0];
  if (!msg) return null;

  const rawText = msg.body_text || msg.body_html || "";
  if (!rawText.trim()) return null;

  try {
    const payload = JSON.parse(rawText.trim()) as FiltersSettingsPayload;
    if (payload && Array.isArray(payload.filters)) {
      await reconcileFiltersToDb(accountId, payload.filters);

      // Clean up any old duplicate messages
      const oldUids = uids.filter((u) => u !== latestUid);
      if (oldUids.length > 0) {
        try {
          await imapDeleteMessages(config, folderPath, oldUids);
        } catch {
          // best effort
        }
      }

      const status = await imapGetFolderStatus(config, folderPath);
      await upsertFolderSyncState({
        account_id: accountId,
        folder_path: folderPath,
        uidvalidity: status.uidvalidity,
        last_uid: latestUid,
        modseq: status.highest_modseq,
        last_sync_at: Date.now(),
      });

      return payload.filters;
    }
  } catch (err) {
    console.warn(`[settingsSidecarSync] Failed to parse filters settings payload:`, err);
  }

  return null;
}

/**
 * Upload filter settings replacement for a specific account.
 */
export async function uploadFilterSettingsForAccount(accountId: string): Promise<void> {
  const account = await getAccount(accountId);
  if (!account || (account.provider !== "imap" && !account.imap_host)) {
    return;
  }
  const config = buildImapConfig(account);
  const filters = await getFiltersForAccount(accountId);
  await uploadFilterSettings(config, account.email, filters);
}

/**
 * Upload a specific filter change (add, update, delete) as a replacement for an account.
 */
export async function uploadFilterChangeForAccount(
  accountId: string,
  change: {
    action: "add" | "update" | "delete";
    filter: FilterRulePayload | { id: string };
  },
): Promise<FiltersSettingsPayload | null> {
  const account = await getAccount(accountId);
  if (!account || (account.provider !== "imap" && !account.imap_host)) {
    return null;
  }
  const config = buildImapConfig(account);
  return applyFilterChangeAndUpload(config, account.email, change, accountId);
}

/**
 * Upload general settings replacement for a specific account.
 */
export async function uploadGeneralSettingsForAccount(
  accountId: string,
  settings?: Record<string, string>,
): Promise<void> {
  const account = await getAccount(accountId);
  if (!account || (account.provider !== "imap" && !account.imap_host)) {
    return;
  }
  const config = buildImapConfig(account);
  const toUpload = settings || (await getAllSettings());
  await uploadGeneralSettings(config, account.email, toUpload);
}

/**
 * Sync both general settings and filter settings for an account.
 */
export async function syncSettingsForAccount(
  accountId: string,
): Promise<{ general: boolean; filters: boolean }> {
  const account = await getAccount(accountId);
  if (!account || (account.provider !== "imap" && !account.imap_host)) {
    return { general: false, filters: false };
  }
  const config = buildImapConfig(account);
  const generalResult = await syncGeneralSettings(accountId, config);
  const filtersResult = await syncFilterSettings(accountId, config);
  return {
    general: generalResult !== null,
    filters: filtersResult !== null,
  };
}

let listenersInitialized = false;
let generalDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let filterDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Initialize automatic listeners to sync settings and filters to IMAP sidecars on change.
 */
export function initSettingsSidecarAutoSync(): void {
  if (listenersInitialized) return;
  listenersInitialized = true;

  addFilterChangeListener((event) => {
    if (filterDebounceTimer) clearTimeout(filterDebounceTimer);
    filterDebounceTimer = setTimeout(async () => {
      try {
        await uploadFilterSettingsForAccount(event.accountId);
      } catch (err) {
        console.warn(`[settingsSidecarSync] Failed to auto-sync filter change:`, err);
      }
    }, 300);
  });

  addSettingChangeListener(() => {
    if (generalDebounceTimer) clearTimeout(generalDebounceTimer);
    generalDebounceTimer = setTimeout(async () => {
      try {
        const accounts = await getAllAccounts();
        const imapAccounts = accounts.filter((a) => a.provider === "imap" || a.imap_host);
        for (const acc of imapAccounts) {
          await uploadGeneralSettingsForAccount(acc.id);
        }
      } catch (err) {
        console.warn(`[settingsSidecarSync] Failed to auto-sync general setting change:`, err);
      }
    }, 500);
  });
}
