import { getDb, selectFirstBy } from "./connection";

export type CrdtScope = "personal" | "shared" | "local";

function normalizeScope(scope?: CrdtScope): "personal" | "shared" {
  if (scope === "local" || scope === "personal") return "personal";
  return "shared";
}

export interface ThreadCrdtDoc {
  account_id: string;
  thread_id: string;
  scope?: CrdtScope;
  doc_base64: string;
  updated_at?: number;
}

export async function getThreadCrdtDoc(
  accountId: string,
  threadId: string,
  scope: CrdtScope = "shared",
): Promise<ThreadCrdtDoc | null> {
  const normalized = normalizeScope(scope);
  return selectFirstBy<ThreadCrdtDoc>(
    "SELECT * FROM thread_crdt_docs WHERE account_id = $1 AND thread_id = $2 AND scope = $3",
    [accountId, threadId, normalized],
  );
}

export async function upsertThreadCrdtDoc(doc: ThreadCrdtDoc): Promise<void> {
  const db = await getDb();
  const normalized = normalizeScope(doc.scope);
  await db.execute(
    `INSERT INTO thread_crdt_docs (account_id, thread_id, scope, doc_base64, updated_at)
     VALUES ($1, $2, $3, $4, COALESCE($5, unixepoch()))
     ON CONFLICT(account_id, thread_id, scope) DO UPDATE SET
       doc_base64 = $4,
       updated_at = unixepoch()`,
    [doc.account_id, doc.thread_id, normalized, doc.doc_base64, doc.updated_at ?? null],
  );
}
