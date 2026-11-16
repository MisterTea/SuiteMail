import { getDb, selectFirstBy } from "./connection";

export interface PgpIdentity {
  id: string;
  email: string;
  armored_public_key: string;
  armored_private_key: string;
  fingerprint: string;
  created_at?: number;
}

export async function getAppPgpIdentity(id = "default"): Promise<PgpIdentity | null> {
  return selectFirstBy<PgpIdentity>(
    "SELECT * FROM pgp_identities WHERE id = $1",
    [id],
  );
}

export async function upsertAppPgpIdentity(identity: PgpIdentity): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO pgp_identities (id, email, armored_public_key, armored_private_key, fingerprint, created_at)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, unixepoch()))
     ON CONFLICT(id) DO UPDATE SET
       email = $2,
       armored_public_key = $3,
       armored_private_key = $4,
       fingerprint = $5`,
    [
      identity.id,
      identity.email,
      identity.armored_public_key,
      identity.armored_private_key,
      identity.fingerprint,
      identity.created_at ?? null,
    ],
  );
}
