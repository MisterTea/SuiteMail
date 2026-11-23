import type { SqlDatabase } from "@/platform";
import { getDb, withTransaction } from "./connection";
import { notifyMailRuleChange, withMailRuleWriteLock, type MailRuleKind } from "./mailRuleChanges";
import { DEFAULT_QUICK_STEPS } from "../quickSteps/defaults";

const ruleTables = {
  smartLabel: {
    table: "smart_label_rules",
    columns: ["label_id", "ai_description", "criteria_json", "is_enabled", "sort_order", "created_at"],
    global: false,
  },
  smartFolder: {
    table: "smart_folders",
    columns: ["name", "query", "icon", "color", "sort_order", "created_at"],
    global: true,
  },
  quickStep: {
    table: "quick_steps",
    columns: ["name", "description", "shortcut", "actions_json", "icon", "is_enabled", "continue_on_error", "sort_order", "created_at"],
    global: false,
  },
} as const;

type RuleField = string | number | null;

export interface MailRuleSnapshotEntry {
  id: string;
  global: boolean;
  fields: Record<string, RuleField>;
}

function getRuleKind(id: string): MailRuleKind {
  const kind = id.split(":", 1)[0];
  if (kind === "smartLabel" || kind === "smartFolder" || kind === "quickStep") return kind;
  throw new Error("Unknown IMAP mail rule kind");
}

const numericFields = new Set(["is_enabled", "continue_on_error", "sort_order", "created_at"]);
const nullableFields = new Set(["criteria_json", "description", "shortcut", "icon", "color"]);

const defaultFolders = {
  "smartFolder:sf-unread": ["Unread", "is:unread", "MailOpen", 0],
  "smartFolder:sf-attachments": ["Has Attachments", "has:attachment", "Paperclip", 1],
  "smartFolder:sf-starred-recent": ["Starred This Week", "is:starred after:__LAST_7_DAYS__", "Star", 2],
} as const;

function getDefaultFolder(id: string) {
  return defaultFolders[id as keyof typeof defaultFolders];
}

export function isUnchangedMailRuleDefault(rule: MailRuleSnapshotEntry): boolean {
  const fields = rule.fields;
  const folder = getDefaultFolder(rule.id);
  if (folder) {
    const [name, query, icon, sortOrder] = folder;
    return fields.name === name && fields.query === query && fields.icon === icon &&
      fields.sort_order === sortOrder && fields.color === null;
  }
  const step = DEFAULT_QUICK_STEPS.find((preset) => rule.id === `quickStep:quick-default:${preset.key}`);
  return !!step && fields.name === step.name && fields.icon === step.icon &&
    fields.actions_json === JSON.stringify(step.actions) && fields.is_enabled === 1 &&
    fields.continue_on_error === 0 && fields.sort_order === 0 && fields.description === null && fields.shortcut === null;
}

export function readMailRuleEntry(value: unknown): MailRuleSnapshotEntry {
  const rule = value as Partial<MailRuleSnapshotEntry> | null;
  if (!rule || typeof rule.id !== "string" || !/^[^:]+:[\w:-]+$/.test(rule.id) ||
      typeof rule.global !== "boolean" || !rule.fields || typeof rule.fields !== "object") {
    throw new Error("Invalid IMAP mail rule");
  }
  const spec = ruleTables[getRuleKind(rule.id)];
  if ((rule.global && !spec.global) || (getDefaultFolder(rule.id) && !rule.global)) {
    throw new Error("Invalid global mail rule");
  }

  const fields = Object.fromEntries(spec.columns.map((column) => {
    const field = rule.fields![column];
    const valid = numericFields.has(column) ? Number.isSafeInteger(field) :
      typeof field === "string" || (field === null && nullableFields.has(column));
    if (!valid) throw new Error("Invalid IMAP mail rule field");
    return [column, field!];
  }));
  if (typeof fields.criteria_json === "string") {
    const criteria: unknown = JSON.parse(fields.criteria_json);
    if (!criteria || typeof criteria !== "object" || Array.isArray(criteria)) throw new Error("Invalid Smart Label criteria");
  }
  if (typeof fields.actions_json === "string" && !Array.isArray(JSON.parse(fields.actions_json))) {
    throw new Error("Invalid Quick Step actions");
  }
  return { id: rule.id, global: rule.global, fields };
}

export async function readLocalMailRules(accountId: string): Promise<MailRuleSnapshotEntry[]> {
  const db = await getDb();
  const rules: MailRuleSnapshotEntry[] = [];
  for (const kind of Object.keys(ruleTables) as MailRuleKind[]) {
    const spec = ruleTables[kind];
    const scope = spec.global ? "account_id = $1 OR account_id IS NULL" : "account_id = $1";
    const rows = await db.select<(Record<string, RuleField> & { id: string; account_id: string | null })[]>(
      `SELECT id, account_id, ${spec.columns.join(", ")} FROM ${spec.table} WHERE ${scope} ORDER BY id`,
      [accountId],
    );
    for (const row of rows) {
      const id = kind === "quickStep" && row.id.startsWith(`${accountId}:quick-default:`)
        ? row.id.slice(accountId.length + 1) : row.id;
      const ruleId = `${kind}:${id}`;
      const fields = Object.fromEntries(spec.columns.map((column) => [column, row[column]!]));
      if (getDefaultFolder(ruleId)) fields.created_at = 0;
      rules.push({
        id: ruleId,
        global: row.account_id === null,
        fields,
      });
    }
  }
  return rules;
}

export async function readMailRuleSyncState(accountId: string) {
  const db = await getDb();
  const [state] = await db.select<{ rules_json: string | null; quick_steps_initialized: number }[]>(
    "SELECT rules_json, quick_steps_initialized FROM mail_rule_sync_state WHERE account_id = $1", [accountId],
  );
  return {
    rules: state?.rules_json ? JSON.parse(state.rules_json) as MailRuleSnapshotEntry[] : null,
    quickStepsInitialized: state?.quick_steps_initialized === 1,
  };
}

export function hasQuickStepHistory(revisions: Map<string, number>): boolean {
  return [...revisions.keys()].some((id) => id.startsWith("quickStep:"));
}

async function writeRule(db: SqlDatabase, accountId: string, rule: MailRuleSnapshotEntry, remove: boolean) {
  const kind = getRuleKind(rule.id);
  const spec = ruleTables[kind];
  const wireId = rule.id.slice(kind.length + 1);
  const id = kind === "quickStep" && wireId.startsWith("quick-default:") ? `${accountId}:${wireId}` : wireId;
  const scope = rule.global ? null : accountId;
  const defaultFolder = getDefaultFolder(rule.id);
  const folderScope = spec.global ? ` AND ${spec.table}.is_default = ${defaultFolder ? 1 : 0}` : "";

  if (remove) {
    if (!defaultFolder) await db.execute(`DELETE FROM ${spec.table} WHERE id = $1 AND account_id IS $2${folderScope}`, [id, scope]);
    return;
  }

  const values = spec.columns.map((column) => rule.fields[column]);
  const parameters = [id, scope, ...values];
  const placeholders = parameters.map((_, index) => `$${index + 1}`).join(", ");
  const updates = spec.columns.map((column) => `${column} = excluded.${column}`).join(", ");
  await db.execute(
    `INSERT INTO ${spec.table} (id, account_id, ${spec.columns.join(", ")}${defaultFolder ? ", is_default" : ""})
     VALUES (${placeholders}${defaultFolder ? ", 1" : ""})
     ON CONFLICT(id) DO UPDATE SET ${updates}
     WHERE ${spec.table}.account_id IS excluded.account_id${folderScope}`,
    parameters,
  );
}

export async function saveSyncedMailRules(
  accountId: string,
  before: Map<string, MailRuleSnapshotEntry>,
  synced: Map<string, MailRuleSnapshotEntry>,
  revisions: Map<string, number>,
): Promise<void> {
  const kinds = new Set<MailRuleKind>();
  let globalFolders = false;
  await withMailRuleWriteLock(async () => {
    const current = new Map((await readLocalMailRules(accountId)).map((rule) => [rule.id, rule]));
    await withTransaction(async (db) => {
      for (const id of new Set([...before.keys(), ...synced.keys()])) {
        const old = current.get(id);
        const next = synced.get(id);
        if (JSON.stringify(old) !== JSON.stringify(before.get(id)) || JSON.stringify(old) === JSON.stringify(next)) continue;
        const rule = (next ?? old)!;
        await writeRule(db, accountId, rule, !next);
        kinds.add(getRuleKind(id));
        globalFolders ||= rule.global;
      }
      const initialized = hasQuickStepHistory(revisions) || [...synced.keys()].some((id) => id.startsWith("quickStep:"));
      await db.execute(
        `INSERT INTO mail_rule_sync_state (account_id, rules_json, quick_steps_initialized) VALUES ($1, $2, $3)
         ON CONFLICT(account_id) DO UPDATE SET rules_json = excluded.rules_json,
           quick_steps_initialized = MAX(mail_rule_sync_state.quick_steps_initialized, excluded.quick_steps_initialized)`,
        [accountId, JSON.stringify([...synced.values()]), initialized ? 1 : 0],
      );
    });
  });
  if (kinds.size) notifyMailRuleChange({ source: "imap", kinds, accountId, globalFolders });
}
