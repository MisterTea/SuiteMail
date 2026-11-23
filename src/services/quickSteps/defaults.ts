import type { QuickStepAction } from "./types";
import { withTransaction } from "../db/connection";
import { withMailRuleWriteLock, notifyMailRuleChange } from "../db/mailRuleChanges";

export const DEFAULT_QUICK_STEPS: {
  key: string;
  name: string;
  actions: QuickStepAction[];
  icon: string;
}[] = [
  {
    key: "reply-archive",
    name: "Reply & Archive",
    actions: [{ type: "reply" }, { type: "archive" }],
    icon: "Reply",
  },
  {
    key: "read-archive",
    name: "Mark Read & Archive",
    actions: [{ type: "markRead" }, { type: "archive" }],
    icon: "MailOpen",
  },
  {
    key: "star-pin",
    name: "Star & Pin",
    actions: [{ type: "star" }, { type: "pin" }],
    icon: "Star",
  },
];

/**
 * Seed default quick steps for an account if none exist yet.
 */
export async function seedDefaultQuickSteps(
  accountId: string,
): Promise<void> {
  let seeded = false;
  await withMailRuleWriteLock(() => withTransaction(async (db) => {
    const [state] = await db.select<{ quick_steps_initialized: number }[]>(
      "SELECT quick_steps_initialized FROM mail_rule_sync_state WHERE account_id = $1", [accountId],
    );
    if (state?.quick_steps_initialized) return;

    const existing = await db.select<{ id: string }[]>(
      "SELECT id FROM quick_steps WHERE account_id = $1 LIMIT 1", [accountId],
    );
    if (existing.length === 0) {
      for (const [index, step] of DEFAULT_QUICK_STEPS.entries()) {
        await db.execute(
          "INSERT INTO quick_steps (id, account_id, name, actions_json, icon, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
          [`${accountId}:quick-default:${step.key}`, accountId, step.name, JSON.stringify(step.actions), step.icon, index],
        );
      }
      seeded = true;
    }
    await db.execute(
      `INSERT INTO mail_rule_sync_state (account_id, quick_steps_initialized) VALUES ($1, 1)
       ON CONFLICT(account_id) DO UPDATE SET quick_steps_initialized = 1`,
      [accountId],
    );
  }));
  if (seeded) notifyMailRuleChange({ source: "local", kind: "quickStep" });
}
