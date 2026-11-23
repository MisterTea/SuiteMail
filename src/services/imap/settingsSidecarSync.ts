import {
  imapListFolders,
  imapCreateFolder,
  imapAppendMessage,
  imapSearchAllUids,
  imapFetchMessages,
  imapFetchRawMessage,
  imapDeleteMessages,
  imapGetFolderStatus,
  type ImapConfig,
  type ImapMessage,
} from "./electronCommands";
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
  notifyFilterChange,
  withFilterWriteLock,
  type DbFilterRule,
  type FilterCriteria,
  type FilterActions,
} from "../db/filters";
import { getAccount, getAllAccounts, type DbAccount } from "../db/accounts";
import { buildImapConfig } from "./imapConfigBuilder";
import { ensureFreshToken } from "../oauth/oauthTokenManager";
import { getDb, withTransaction } from "../db/connection";
import { isDeviceSetting, syncableSettings } from "./deviceSettings";
import { addMailRuleChangeListener, withMailRuleWriteLock } from "../db/mailRuleChanges";
import {
  readMailRuleEntry,
  readLocalMailRules,
  readMailRuleSyncState,
  hasQuickStepHistory,
  saveSyncedMailRules,
  isUnchangedMailRuleDefault,
  type MailRuleSnapshotEntry,
} from "../db/mailRuleSyncState";

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
  // Includes deleted rules so concurrent snapshots cannot bring them back.
  revisions?: Record<string, number>;
}

interface MailRulesPayload {
  version: number;
  updatedAt: number;
  rules: MailRuleSnapshotEntry[];
  revisions?: Record<string, number>;
}

type SettingsType = "general" | "filters" | "rules";
type SettingsPayload = GeneralSettingsPayload | FiltersSettingsPayload | MailRulesPayload;

function isRulesSettingsFolder(path: string): boolean {
  return /(?:^|[/.])\.?settings(?:[/.])rules$/i.test(path.trim());
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
    lower.endsWith(".settings.general") ||
    lower.endsWith("/" + SETTINGS_GENERAL_FOLDER) ||
    lower.endsWith("/settings/general") ||
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
    lower.endsWith(".settings.filters") ||
    lower.endsWith("/" + SETTINGS_FILTERS_FOLDER) ||
    lower.endsWith("/settings/filters") ||
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
  subfolder?: SettingsType,
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
  } else if (subfolder === "rules") {
    const existing = folders.find((f) => isRulesSettingsFolder(f.path));
    if (existing) return existing.raw_path || existing.path;
  } else {
    const existing = folders.find((f) => {
      const lower = f.path.toLowerCase().trim();
      return lower === SETTINGS_SIDECAR_FOLDER || lower === "settings";
    });
    if (existing) return existing.raw_path || existing.path;
  }

  // Use the listed parent path when the server puts it under a namespace.
  const parentFolder = folders.find((f) => {
    const name = f.name.toLowerCase().trim();
    return name === SETTINGS_SIDECAR_FOLDER || name === "settings";
  });
  const delim = parentFolder?.delimiter || folders[0]?.delimiter || "/";
  const parentPath = parentFolder?.raw_path || parentFolder?.path ||
    (delim === "." ? "settings" : SETTINGS_SIDECAR_FOLDER);
  if (!parentFolder) {
    try {
      await imapCreateFolder(config, parentPath);
    } catch (err) {
      console.warn(`[settingsSidecarSync] Note on creating ${parentPath}:`, err);
    }
  }

  if (!subfolder) {
    return parentPath;
  }

  const targetFolder = `${parentPath}${delim}${subfolder}`;
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
  type: SettingsType,
  payload: SettingsPayload,
): string {
  const mailPayload = "settings" in payload ? { ...payload, settings: syncableSettings(payload.settings) } : payload;
  const jsonBody = JSON.stringify(mailPayload, null, 2).replace(/\n/g, "\r\n");
  const lines = [
    `From: <${fromEmail}>`,
    `To: <${fromEmail}>`,
    `Subject: SuperMail-Settings: ${type}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <settings-${type}-${crypto.randomUUID()}@supermail.local>`,
    `X-SuperMail-Sidecar: true`,
    `X-SuperMail-Settings-Type: ${type}`,
    `MIME-Version: 1.0`,
    `Content-Type: ${type === "general" ? "application/json" : "text/plain"}; charset=utf-8`,
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
  type: SettingsType,
  payload: SettingsPayload,
): Promise<void> {
  const folder = await ensureSettingsFolder(config, type);

  // 1. Search for existing UIDs in the settings folder before uploading replacement
  let existingUids: number[] = [];
  try {
    existingUids = await imapSearchAllUids(config, folder);
  } catch (err) {
    console.warn(`[settingsSidecarSync] Error searching UIDs in ${folder}:`, err);
  }

  await appendSettingsReplacement(config, folder, fromEmail, type, payload, existingUids);
}

async function appendSettingsReplacement(
  config: ImapConfig,
  folder: string,
  fromEmail: string,
  type: SettingsType,
  payload: SettingsPayload,
  existingUids: number[],
): Promise<void> {
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
  type: SettingsType,
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
 * Apply a general setting change to the settings message and upload a replacement.
 */
export async function applyGeneralSettingChangeAndUpload(
  config: ImapConfig,
  fromEmail: string,
  key: string,
  value: string,
): Promise<GeneralSettingsPayload> {
  if (isDeviceSetting(key)) {
    await setSetting(key, value);
    return { version: 1, updatedAt: Date.now(), settings: syncableSettings(await getAllSettings()) };
  }

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

  currentSettings = syncableSettings(currentSettings);
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
      const settings = syncableSettings(payload.settings);
      for (const [key, value] of Object.entries(settings)) {
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

      return settings;
    }
  } catch (err) {
    console.warn(`[settingsSidecarSync] Failed to parse general settings payload:`, err);
  }

  return null;
}

async function readFilterSnapshot(
  config: ImapConfig,
  folder: string,
  message: { uid: number; body_text: string | null; body_html: string | null },
): Promise<FiltersSettingsPayload> {
  let body = message.body_text || message.body_html || "";
  if (!body.trim()) {
    // Older clients wrote application/json, which the native mail parser exposes as an attachment.
    const raw = await imapFetchRawMessage(config, folder, message.uid);
    const headersEnd = /\r?\n\r?\n/.exec(raw);
    if (headersEnd && /^X-SuperMail-Settings-Type:[ \t]*filters[ \t]*\r?$/im.test(raw.slice(0, headersEnd.index))) {
      body = raw.slice(headersEnd.index + headersEnd[0].length);
    }
  }

  const payload = JSON.parse(body.trim()) as FiltersSettingsPayload;
  if (
    payload?.version !== 1 || !Number.isFinite(payload.updatedAt) ||
    !Array.isArray(payload.filters) || payload.filters.some((filter) =>
      !filter || typeof filter.id !== "string" || typeof filter.name !== "string")
  ) {
    throw new Error("Invalid IMAP filter settings message");
  }
  validateRevisions(payload.revisions);
  payload.filters = payload.filters.map((filter) => ({
    id: filter.id,
    name: filter.name,
    isEnabled: filter.isEnabled !== false,
    criteria: filter.criteria ?? {},
    actions: filter.actions ?? {},
    sortOrder: filter.sortOrder ?? 0,
    createdAt: filter.createdAt ?? Math.floor(payload.updatedAt / 1000),
  }));
  return payload;
}

type Rule = { id: string };
type RuleMap<T extends Rule> = Map<string, T>;
type FilterMap = RuleMap<FilterRulePayload>;
type RuleSnapshot<T extends Rule> = { rules: T[]; revisions?: Record<string, number> };

function indexRules<T extends Rule>(rules: T[]): RuleMap<T> {
  return new Map(rules.map((rule) => [rule.id, rule]));
}

function sameRule(a?: Rule, b?: Rule): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function validateRevisions(revisions: unknown): void {
  if (revisions === undefined) return;
  if (!revisions || typeof revisions !== "object" || Array.isArray(revisions) ||
      Object.values(revisions).some((rev) => !Number.isSafeInteger(rev) || rev < 0)) {
    throw new Error("Invalid IMAP settings revisions");
  }
}

/** Fold concurrent replacements in UID order. For the same rule and revision, the later UID wins. */
function mergeRuleSnapshots<T extends Rule>(snapshots: RuleSnapshot<T>[]) {
  let rules: RuleMap<T> = new Map();
  let revisions = new Map<string, number>();
  for (const snapshot of snapshots) {
    const incoming = indexRules(snapshot.rules);
    if (!snapshot.revisions) {
      // A message from an older client is a complete replacement.
      rules = incoming;
      revisions = new Map();
      continue;
    }
    const incomingRevisions = new Map(Object.entries(snapshot.revisions));
    for (const id of new Set([...incoming.keys(), ...incomingRevisions.keys()])) {
      const revision = incomingRevisions.get(id) ?? 0;
      if (revision < (revisions.get(id) ?? 0)) continue;
      const rule = incoming.get(id);
      if (rule) rules.set(id, rule);
      else rules.delete(id);
      revisions.set(id, revision);
    }
  }
  return { rules, revisions };
}

async function readLocalFilters(accountId: string): Promise<FilterRulePayload[]> {
  return (await getFiltersForAccount(accountId)).map(dbFilterToPayload);
}

async function saveSyncedFilters(accountId: string, before: FilterMap, synced: FilterMap): Promise<void> {
  let changed = false;
  await withFilterWriteLock(async () => {
    const current = indexRules(await readLocalFilters(accountId));
    await withTransaction(async (db) => {
      for (const id of new Set([...before.keys(), ...synced.keys()])) {
        const old = current.get(id);
        const filter = synced.get(id);
        // A local edit made while APPEND was in flight belongs to the next sync.
        if (!sameRule(old, before.get(id)) || sameRule(old, filter)) continue;
        if (filter) {
          await db.execute(
            `INSERT INTO filter_rules (id, account_id, name, is_enabled, criteria_json, actions_json, sort_order, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name, is_enabled = excluded.is_enabled,
               criteria_json = excluded.criteria_json, actions_json = excluded.actions_json,
               sort_order = excluded.sort_order, created_at = excluded.created_at
             WHERE filter_rules.account_id = excluded.account_id`,
            [id, accountId, filter.name, filter.isEnabled ? 1 : 0, JSON.stringify(filter.criteria),
              JSON.stringify(filter.actions), filter.sortOrder, filter.createdAt],
          );
        } else {
          await db.execute("DELETE FROM filter_rules WHERE account_id = $1 AND id = $2", [accountId, id]);
        }
        changed = true;
      }
      await db.execute(
        `INSERT INTO imap_filter_sync_state (account_id, filters_json) VALUES ($1, $2)
         ON CONFLICT(account_id) DO UPDATE SET filters_json = excluded.filters_json`,
        [accountId, JSON.stringify([...synced.values()])],
      );
    });
  });
  if (changed) notifyFilterChange({ accountId, action: "sync" });
}

interface RuleExchange<T extends Rule> {
  type: "filters" | "rules";
  matchesFolder: (path: string) => boolean;
  decode: (message: ImapMessage, folder: string) => Promise<RuleSnapshot<T>>;
  readLocal: () => Promise<T[]>;
  readBaseline: () => Promise<T[] | null>;
  save: (before: RuleMap<T>, synced: RuleMap<T>, revisions: Map<string, number>) => Promise<void>;
  encode: (rules: T[], revisions: Record<string, number>) => SettingsPayload;
  isDefault?: (rule: T) => boolean;
  needsSave?: (revisions: Map<string, number>) => boolean;
}

async function exchangeRuleSettings<T extends Rule>(
  config: ImapConfig,
  getEmail: () => Promise<string>,
  exchange: RuleExchange<T>,
): Promise<T[] | null> {
  const folders = await imapListFolders(config);
  const folder = folders.find((f) => exchange.matchesFolder(f.path));
  const folderPath = folder && (folder.raw_path || folder.path);
  const uids = folderPath ? (await imapSearchAllUids(config, folderPath)).sort((a, b) => a - b) : [];
  const snapshots: RuleSnapshot<T>[] = [];
  if (folderPath && uids.length > 0) {
    const result = await imapFetchMessages(config, folderPath, uids);
    const messages = new Map(result.messages.map((message) => [message.uid, message]));
    for (const uid of uids) {
      const message = messages.get(uid);
      if (!message) throw new Error("IMAP rules changed during download");
      snapshots.push(await exchange.decode(message, folderPath));
    }
  }

  const { rules, revisions } = mergeRuleSnapshots(snapshots);
  const saved = await exchange.readBaseline();
  const previous = indexRules(saved ?? []);
  const local = indexRules(await exchange.readLocal());
  const revision = 1 + Math.max(0, ...revisions.values());
  let changed = false;
  for (const id of new Set([...previous.keys(), ...local.keys()])) {
    const rule = local.get(id);
    // A rule that has never synced is a local addition unless the server already deleted it.
    if (!saved && revisions.has(id) && !rules.has(id)) continue;
    if (!previous.has(id) && rule && (rules.has(id) || revisions.has(id)) && exchange.isDefault?.(rule)) continue;
    if ((snapshots.length > 0 && sameRule(previous.get(id), rule)) || sameRule(rules.get(id), rule)) continue;
    if (rule) rules.set(id, rule);
    else rules.delete(id);
    revisions.set(id, revision);
    changed = true;
  }

  const entries = [...rules.values()];
  if (changed) {
    const fromEmail = await getEmail();
    const destination = folderPath ?? await ensureSettingsFolder(config, exchange.type);
    await appendSettingsReplacement(config, destination, fromEmail, exchange.type,
      exchange.encode(entries, Object.fromEntries(revisions)), uids);
  }

  if (!changed && snapshots.length === 0) return null;
  if (exchange.needsSave?.(revisions) || JSON.stringify(entries) !== JSON.stringify(saved) || local.size !== rules.size ||
      [...rules].some(([id, rule]) => !sameRule(local.get(id), rule))) {
    await exchange.save(local, rules, revisions);
  }
  return entries;
}

async function exchangeFilterSettings(
  accountId: string,
  config: ImapConfig,
  email?: string,
): Promise<FilterRulePayload[] | null> {
  return exchangeRuleSettings(config, async () => email ?? (await getAccount(accountId))?.email ?? config.username, {
    type: "filters",
    matchesFolder: isFiltersSettingsFolder,
    async decode(message, folder) {
      const snapshot = await readFilterSnapshot(config, folder, message);
      return { rules: snapshot.filters, revisions: snapshot.revisions };
    },
    readLocal: () => withFilterWriteLock(() => readLocalFilters(accountId)),
    async readBaseline() {
      const db = await getDb();
      const [saved] = await db.select<{ filters_json: string }[]>(
        "SELECT filters_json FROM imap_filter_sync_state WHERE account_id = $1", [accountId],
      );
      return saved ? JSON.parse(saved.filters_json) as FilterRulePayload[] : null;
    },
    save: (before, synced) => saveSyncedFilters(accountId, before, synced),
    encode: (filters, revisions) => ({ version: 1, updatedAt: Date.now(), filters, revisions }),
  });
}

let mailRulesSyncQueue = Promise.resolve();

export async function syncMailRules(accountId: string, config: ImapConfig, email: string): Promise<void> {
  // Global Smart Folders are shared by every mailbox on this device.
  let quickStepsInitialized = false;
  const sync = mailRulesSyncQueue.then(() => exchangeRuleSettings(config, async () => email, {
    type: "rules",
    matchesFolder: isRulesSettingsFolder,
    async decode(message) {
      const payload = JSON.parse(message.body_text || message.body_html || "") as MailRulesPayload;
      if (payload?.version !== 1 || !Array.isArray(payload.rules)) throw new Error("Invalid IMAP mail rules message");
      validateRevisions(payload.revisions);
      return { rules: payload.rules.map(readMailRuleEntry), revisions: payload.revisions };
    },
    async readBaseline() {
      const state = await readMailRuleSyncState(accountId);
      quickStepsInitialized = state.quickStepsInitialized;
      return state.rules;
    },
    readLocal: () => withMailRuleWriteLock(() => readLocalMailRules(accountId)),
    save: (before, synced, revisions) => saveSyncedMailRules(accountId, before, synced, revisions),
    encode: (rules, revisions) => ({ version: 1, updatedAt: Date.now(), rules, revisions }),
    isDefault: isUnchangedMailRuleDefault,
    needsSave: (revisions) => !quickStepsInitialized && hasQuickStepHistory(revisions),
  }));
  mailRulesSyncQueue = sync.then(() => undefined, () => undefined);
  await sync;
}

const filterSyncs = new Map<string, Promise<FilterRulePayload[] | null>>();

/** Exchange filters with .settings/filters, including edits made while offline. */
export async function syncFilterSettings(
  accountId: string,
  config: ImapConfig,
  options?: { strict?: boolean; email?: string },
): Promise<FilterRulePayload[] | null> {
  const previous = filterSyncs.get(accountId);
  const sync = (previous ? previous.catch(() => null) : Promise.resolve()).then(
    () => exchangeFilterSettings(accountId, config, options?.email),
  );
  filterSyncs.set(accountId, sync);
  try {
    return await sync;
  } catch (err) {
    if (options?.strict) throw err;
    console.warn("[settingsSidecarSync] Failed to sync filters:", err);
    return null;
  } finally {
    if (filterSyncs.get(accountId) === sync) filterSyncs.delete(accountId);
  }
}

async function getSettingsImapConfig(account: DbAccount): Promise<ImapConfig> {
  const token = account.auth_method === "oauth2" ? await ensureFreshToken(account) : undefined;
  return buildImapConfig(account, token);
}

/**
 * Upload general settings replacement for a specific account.
 */
export async function uploadGeneralSettingsForAccount(
  accountId: string,
  settings?: Record<string, string>,
): Promise<void> {
  const account = await getAccount(accountId);
  if (!account?.imap_host) {
    return;
  }
  const config = await getSettingsImapConfig(account);
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
  if (!account?.imap_host) {
    return { general: false, filters: false };
  }
  const config = await getSettingsImapConfig(account);
  const filtersResult = await syncFilterSettings(accountId, config, { email: account.email });
  try {
    await syncMailRules(accountId, config, account.email);
  } catch (err) {
    console.warn("[settingsSidecarSync] Failed to sync mail rules:", err);
  }
  const generalResult = await syncGeneralSettings(accountId, config);
  return {
    general: generalResult !== null,
    filters: filtersResult !== null,
  };
}

let listenersInitialized = false;
let mailRulesDebounceTimer: ReturnType<typeof setTimeout> | undefined;
let generalDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const filterDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Initialize automatic listeners to sync settings and filters to IMAP sidecars on change.
 */
export function initSettingsSidecarAutoSync(): void {
  if (listenersInitialized) return;
  listenersInitialized = true;

  addFilterChangeListener(({ accountId, action }) => {
    if (action === "sync") return;
    clearTimeout(filterDebounceTimers.get(accountId));
    filterDebounceTimers.set(accountId, setTimeout(async () => {
      filterDebounceTimers.delete(accountId);
      try {
        const account = await getAccount(accountId);
        if (account?.imap_host) {
          const config = await getSettingsImapConfig(account);
          await syncFilterSettings(accountId, config, { strict: true, email: account.email });
        }
      } catch (err) {
        console.warn("[settingsSidecarSync] Failed to auto-sync filter change:", err);
      }
    }, 300));
  });

  addMailRuleChangeListener((change) => {
    if (change.source !== "local") return;
    clearTimeout(mailRulesDebounceTimer);
    mailRulesDebounceTimer = setTimeout(async () => {
      try {
        const accounts = (await getAllAccounts()).filter((account) => account.imap_host);
        for (const account of accounts) {
          try {
            const config = await getSettingsImapConfig(account);
            await syncMailRules(account.id, config, account.email);
          } catch (err) {
            console.warn("[settingsSidecarSync] Failed to upload mail rules for account:", err);
          }
        }
      } catch (err) {
        console.warn("[settingsSidecarSync] Failed to load mail rule sync accounts:", err);
      }
    }, 300);
  });

  addSettingChangeListener(({ key }) => {
    if (isDeviceSetting(key)) return;
    if (generalDebounceTimer) clearTimeout(generalDebounceTimer);
    generalDebounceTimer = setTimeout(async () => {
      try {
        const accounts = await getAllAccounts();
        const imapAccounts = accounts.filter((a) => a.imap_host);
        for (const acc of imapAccounts) {
          await uploadGeneralSettingsForAccount(acc.id);
        }
      } catch (err) {
        console.warn(`[settingsSidecarSync] Failed to auto-sync general setting change:`, err);
      }
    }, 500);
  });
}
