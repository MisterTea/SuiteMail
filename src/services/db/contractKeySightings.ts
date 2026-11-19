import { getDb, selectFirstBy } from "./connection";

export interface ContractKeySighting {
  email: string;
  fingerprint: string;
  armored_public_key: string;
  first_seen_at?: number;
}

export async function getContractKeySighting(
  email: string,
  fingerprint: string,
): Promise<ContractKeySighting | null> {
  return selectFirstBy<ContractKeySighting>(
    "SELECT * FROM contract_key_sightings WHERE email = $1 AND fingerprint = $2",
    [email.toLowerCase().trim(), fingerprint.toLowerCase()],
  );
}

export async function listContractKeySightings(email: string): Promise<ContractKeySighting[]> {
  const db = await getDb();
  return db.select<ContractKeySighting[]>(
    "SELECT * FROM contract_key_sightings WHERE email = $1",
    [email.toLowerCase().trim()],
  );
}

export async function insertContractKeySighting(row: ContractKeySighting): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO contract_key_sightings (email, fingerprint, armored_public_key, first_seen_at)
     VALUES ($1, $2, $3, COALESCE($4, unixepoch()))
     ON CONFLICT(email, fingerprint) DO NOTHING`,
    [
      row.email.toLowerCase().trim(),
      row.fingerprint.toLowerCase(),
      row.armored_public_key,
      row.first_seen_at ?? null,
    ],
  );
}
