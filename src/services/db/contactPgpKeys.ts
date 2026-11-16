import { getDb, selectFirstBy } from "./connection";

export type PgpTrustStatus = "tofu" | "trusted" | "warning_mismatch";

export interface ContactPgpKey {
  id: string;
  email: string;
  armored_public_key: string;
  fingerprint: string;
  trust_status: PgpTrustStatus;
  created_at?: number;
  updated_at?: number;
}

export async function getContactPgpKeyByEmail(
  email: string,
): Promise<ContactPgpKey | null> {
  const normalized = email.toLowerCase().trim();
  return selectFirstBy<ContactPgpKey>(
    "SELECT * FROM contact_pgp_keys WHERE lower(email) = $1",
    [normalized],
  );
}

export async function upsertContactPgpKey(
  contactKey: ContactPgpKey,
): Promise<void> {
  const db = await getDb();
  const normalized = contactKey.email.toLowerCase().trim();
  await db.execute(
    `INSERT INTO contact_pgp_keys (id, email, armored_public_key, fingerprint, trust_status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, unixepoch()), unixepoch())
     ON CONFLICT(id) DO UPDATE SET
       email = $2,
       armored_public_key = $3,
       fingerprint = $4,
       trust_status = $5,
       updated_at = unixepoch()`,
    [
      contactKey.id,
      normalized,
      contactKey.armored_public_key,
      contactKey.fingerprint,
      contactKey.trust_status,
      contactKey.created_at ?? null,
    ],
  );
}

export async function listContactPgpKeys(): Promise<ContactPgpKey[]> {
  const db = await getDb();
  return db.select<ContactPgpKey[]>(
    "SELECT * FROM contact_pgp_keys ORDER BY updated_at DESC",
  );
}
