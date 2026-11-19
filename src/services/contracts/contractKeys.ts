import {
  getContractKeySighting,
  insertContractKeySighting,
  listContractKeySightings,
} from "../db/contractKeySightings";

export interface ContractKeyObservation {
  isNew: boolean;
  /** True when this address was already seen with a different public key. */
  keyChanged: boolean;
  fingerprint: string;
}

/**
 * Alerts that have been recorded but not yet displayed.
 * React remounts the card once before the first paint; this keeps that
 * first observation visible until the card actually shows it.
 */
const pendingAlerts = new Map<string, ContractKeyObservation>();

function alertKey(email: string, fingerprint: string): string {
  return `${email.toLowerCase().trim()}\n${fingerprint.toLowerCase()}`;
}

/**
 * Look up an email/public-key pair.
 * The pair is stored only after the alert is shown, so leaving the message
 * early does not hide the warning.
 */
export async function observeContractKey(
  email: string,
  armoredPublicKey: string,
): Promise<ContractKeyObservation> {
  const openpgp = await import("openpgp");
  const key = await openpgp.readKey({ armoredKey: armoredPublicKey });
  const fingerprint = key.getFingerprint().toLowerCase();
  const normalized = email.toLowerCase().trim();
  const id = alertKey(normalized, fingerprint);

  const existing = await getContractKeySighting(normalized, fingerprint);
  if (existing) {
    return pendingAlerts.get(id) ?? {
      isNew: false,
      keyChanged: false,
      fingerprint,
    };
  }

  const remembered = pendingAlerts.get(id);
  if (remembered) return remembered;

  const prior = await listContractKeySightings(normalized);
  const observation: ContractKeyObservation = {
    isNew: true,
    keyChanged: prior.length > 0,
    fingerprint,
  };
  pendingAlerts.set(id, observation);
  return observation;
}

/** Call once the new-key alert has been shown, so the next open stays quiet. */
export async function acknowledgeContractKeyShown(
  email: string,
  fingerprint: string,
  armoredPublicKey: string,
): Promise<void> {
  const normalized = email.toLowerCase().trim();
  const id = alertKey(normalized, fingerprint);
  await insertContractKeySighting({
    email: normalized,
    fingerprint: fingerprint.toLowerCase(),
    armored_public_key: armoredPublicKey,
  });
  pendingAlerts.delete(id);
}
