import { getDb, buildDynamicUpdate, boolToInt } from "./connection";

export interface FilterCriteria {
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  hasAttachment?: boolean;
}

export interface FilterActions {
  applyLabel?: string;
  archive?: boolean;
  star?: boolean;
  markRead?: boolean;
  trash?: boolean;
}

export interface DbFilterRule {
  id: string;
  account_id: string;
  name: string;
  is_enabled: number;
  criteria_json: string;
  actions_json: string;
  sort_order: number;
  created_at: number;
}

export async function getFiltersForAccount(
  accountId: string,
): Promise<DbFilterRule[]> {
  const db = await getDb();
  return db.select<DbFilterRule[]>(
    "SELECT * FROM filter_rules WHERE account_id = $1 ORDER BY sort_order, created_at",
    [accountId],
  );
}

export async function getEnabledFiltersForAccount(
  accountId: string,
): Promise<DbFilterRule[]> {
  const db = await getDb();
  return db.select<DbFilterRule[]>(
    "SELECT * FROM filter_rules WHERE account_id = $1 AND is_enabled = 1 ORDER BY sort_order, created_at",
    [accountId],
  );
}

export type FilterChangeEvent =
  | { action: "insert" | "update" | "delete"; accountId: string; filterId: string }
  | { action: "sync"; accountId: string };

export type FilterChangeListener = (event: FilterChangeEvent) => void;

const filterChangeListeners = new Set<FilterChangeListener>();

export function addFilterChangeListener(listener: FilterChangeListener): () => void {
  filterChangeListeners.add(listener);
  return () => {
    filterChangeListeners.delete(listener);
  };
}

export function notifyFilterChange(event: FilterChangeEvent) {
  for (const listener of filterChangeListeners) {
    try {
      listener(event);
    } catch (e) {
      console.warn("[filters] Error in filter change listener:", e);
    }
  }
}

let filterWriteQueue = Promise.resolve();

export function withFilterWriteLock<T>(write: () => Promise<T>): Promise<T> {
  const result = filterWriteQueue.then(write);
  filterWriteQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function insertFilter(filter: {
  accountId: string;
  name: string;
  criteria: FilterCriteria;
  actions: FilterActions;
  isEnabled?: boolean;
  highestPriority?: boolean;
  sortOrder?: number;
}): Promise<string> {
  return withFilterWriteLock(() => insertFilterLocally(filter));
}

async function insertFilterLocally(filter: Parameters<typeof insertFilter>[0]): Promise<string> {
  const db = await getDb();
  let sortOrder = filter.sortOrder ?? 0;
  if (filter.highestPriority) {
    try {
      const minRows = await db.select<{ min_order: number | null }[]>(
        "SELECT MIN(sort_order) AS min_order FROM filter_rules WHERE account_id = $1",
        [filter.accountId],
      );
      const minOrder = minRows[0]?.min_order;
      sortOrder = typeof minOrder === "number" ? minOrder - 1 : -1;
    } catch {
      sortOrder = -1;
    }
  }

  const id = crypto.randomUUID();
  await db.execute(
    "INSERT INTO filter_rules (id, account_id, name, is_enabled, criteria_json, actions_json, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [
      id,
      filter.accountId,
      filter.name,
      boolToInt(filter.isEnabled !== false),
      JSON.stringify(filter.criteria),
      JSON.stringify(filter.actions),
      sortOrder,
    ],
  );
  notifyFilterChange({
    action: "insert",
    accountId: filter.accountId,
    filterId: id,
  });
  return id;
}

export async function updateFilter(
  id: string,
  updates: {
    name?: string;
    criteria?: FilterCriteria;
    actions?: FilterActions;
    isEnabled?: boolean;
  },
): Promise<void> {
  return withFilterWriteLock(() => updateFilterLocally(id, updates));
}

async function updateFilterLocally(id: string, updates: Parameters<typeof updateFilter>[1]): Promise<void> {
  const db = await getDb();
  let accountId: string | undefined;
  try {
    const rows = await db.select<{ account_id: string }[]>(
      "SELECT account_id FROM filter_rules WHERE id = $1",
      [id],
    );
    accountId = rows[0]?.account_id;
  } catch {
    // best effort
  }

  const fields: [string, unknown][] = [];
  if (updates.name !== undefined) fields.push(["name", updates.name]);
  if (updates.criteria !== undefined) fields.push(["criteria_json", JSON.stringify(updates.criteria)]);
  if (updates.actions !== undefined) fields.push(["actions_json", JSON.stringify(updates.actions)]);
  if (updates.isEnabled !== undefined) fields.push(["is_enabled", boolToInt(updates.isEnabled)]);

  const query = buildDynamicUpdate("filter_rules", "id", id, fields);
  if (query) {
    await db.execute(query.sql, query.params);
  }

  if (accountId) {
    notifyFilterChange({
      action: "update",
      accountId,
      filterId: id,
    });
  }
}

export async function deleteFilter(id: string): Promise<void> {
  return withFilterWriteLock(() => deleteFilterLocally(id));
}

async function deleteFilterLocally(id: string): Promise<void> {
  const db = await getDb();
  let accountId: string | undefined;
  try {
    const rows = await db.select<{ account_id: string }[]>(
      "SELECT account_id FROM filter_rules WHERE id = $1",
      [id],
    );
    accountId = rows[0]?.account_id;
  } catch {
    // best effort
  }

  await db.execute("DELETE FROM filter_rules WHERE id = $1", [id]);

  if (accountId) {
    notifyFilterChange({
      action: "delete",
      accountId,
      filterId: id,
    });
  }
}
