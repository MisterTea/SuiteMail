import * as openpgp from "openpgp";
import {
  getAppPgpIdentity,
  upsertAppPgpIdentity,
  type PgpIdentity,
} from "../db/pgpIdentities";
import {
  getContactPgpKeyByEmail,
  upsertContactPgpKey,
  listContactPgpKeys,
  type ContactPgpKey,
} from "../db/contactPgpKeys";
import { getSetting, setSetting } from "../db/settings";

export const PGP_SETTING_PUBLIC_KEY = "pgp_public_key";
export const PGP_SETTING_PRIVATE_KEY = "pgp_private_key";
export const PGP_SETTING_ARMORED_PUBLIC_KEY = "pgp_armored_public_key";
export const PGP_SETTING_ARMORED_PRIVATE_KEY = "pgp_armored_private_key";
export const PGP_SETTING_FINGERPRINT = "pgp_fingerprint";
export const PGP_SETTING_EMAIL = "pgp_email";

/**
 * Save the application's PGP keypair into the global settings.
 */
export async function syncPgpKeysToSettings(identity: PgpIdentity): Promise<void> {
  try {
    await setSetting(PGP_SETTING_PUBLIC_KEY, identity.armored_public_key);
    await setSetting(PGP_SETTING_PRIVATE_KEY, identity.armored_private_key);
    await setSetting(PGP_SETTING_ARMORED_PUBLIC_KEY, identity.armored_public_key);
    await setSetting(PGP_SETTING_ARMORED_PRIVATE_KEY, identity.armored_private_key);
    await setSetting(PGP_SETTING_FINGERPRINT, identity.fingerprint);
    await setSetting(PGP_SETTING_EMAIL, identity.email);
  } catch (err) {
    console.warn("[pgpService] Note on saving PGP keys to global settings:", err);
  }
}

/**
 * Retrieve PGP keys directly from the global settings if present.
 */
export async function getPgpKeysFromSettings(): Promise<{
  publicKey: string | null;
  privateKey: string | null;
  fingerprint: string | null;
  email: string | null;
}> {
  try {
    const publicKey =
      (await getSetting(PGP_SETTING_PUBLIC_KEY)) ||
      (await getSetting(PGP_SETTING_ARMORED_PUBLIC_KEY));
    const privateKey =
      (await getSetting(PGP_SETTING_PRIVATE_KEY)) ||
      (await getSetting(PGP_SETTING_ARMORED_PRIVATE_KEY));
    const fingerprint = await getSetting(PGP_SETTING_FINGERPRINT);
    const email = await getSetting(PGP_SETTING_EMAIL);
    return { publicKey, privateKey, fingerprint, email };
  } catch {
    return { publicKey: null, privateKey: null, fingerprint: null, email: null };
  }
}

/**
 * Restore or synchronize PGP identity from global settings into the local pgp_identities table.
 */
export async function syncPgpKeysFromSettings(): Promise<PgpIdentity | null> {
  try {
    const { publicKey, privateKey, fingerprint: storedFingerprint, email: storedEmail } =
      await getPgpKeysFromSettings();
    if (!publicKey || !privateKey) return null;

    let fingerprint = storedFingerprint;
    if (!fingerprint) {
      const keyObj = await openpgp.readKey({ armoredKey: publicKey });
      fingerprint = keyObj.getFingerprint();
    }
    const email = storedEmail || "user@supermail.local";

    const identity: PgpIdentity = {
      id: "default",
      email,
      armored_public_key: publicKey,
      armored_private_key: privateKey,
      fingerprint,
    };
    await upsertAppPgpIdentity(identity);
    return identity;
  } catch (err) {
    console.warn("[pgpService] Note on restoring PGP keys from settings:", err);
    return null;
  }
}

/**
 * Initialize or retrieve the application's OpenPGP identity.
 * Persists the client's private and public PGP keys both in SQLite
 * and in the app's global settings for cross-client sync.
 */
export async function initAppPgpKey(email?: string): Promise<PgpIdentity> {
  // 1. Check if identity already exists in pgp_identities table
  const existing = await getAppPgpIdentity("default");
  if (existing) {
    await syncPgpKeysToSettings(existing);
    return existing;
  }

  // 2. Check if identity was synced to global settings from another client
  const fromSettings = await syncPgpKeysFromSettings();
  if (fromSettings) {
    return fromSettings;
  }

  // 3. Generate a new keypair
  const userEmail = email?.trim() || "user@supermail.local";
  const { privateKey, publicKey } = await openpgp.generateKey({
    userIDs: [{ name: "SuperMail User", email: userEmail }],
    type: "curve25519",
  });

  const keyObj = await openpgp.readKey({ armoredKey: publicKey });
  const fingerprint = keyObj.getFingerprint();

  const identity: PgpIdentity = {
    id: "default",
    email: userEmail,
    armored_public_key: publicKey,
    armored_private_key: privateKey,
    fingerprint,
  };

  await upsertAppPgpIdentity(identity);
  await syncPgpKeysToSettings(identity);
  return identity;
}

/**
 * Get the current app PGP identity if one has already been created.
 * Falls back to global settings if not found in pgp_identities.
 */
export async function getPgpIdentity(): Promise<PgpIdentity | null> {
  const identity = await getAppPgpIdentity("default");
  if (identity) {
    return identity;
  }
  return syncPgpKeysFromSettings();
}

export interface RecordKeyResult {
  contactKey: ContactPgpKey;
  warning?: string;
  isNew: boolean;
  isMismatch: boolean;
}

/**
 * Register or update a public key for a given email address.
 * Warns on first addition (TOFU) or if the public key has changed (mismatch warning).
 */
export async function recordContactPublicKey(
  email: string,
  armoredPublicKey: string,
): Promise<RecordKeyResult> {
  const normalizedEmail = email.toLowerCase().trim();
  const keyObj = await openpgp.readKey({ armoredKey: armoredPublicKey });
  const fingerprint = keyObj.getFingerprint();

  const existing = await getContactPgpKeyByEmail(normalizedEmail);

  if (!existing) {
    const newKey: ContactPgpKey = {
      id: `key-${normalizedEmail}-${fingerprint.slice(0, 16)}`,
      email: normalizedEmail,
      armored_public_key: armoredPublicKey,
      fingerprint,
      trust_status: "tofu",
    };
    await upsertContactPgpKey(newKey);
    return {
      contactKey: newKey,
      warning: `New public key registered for ${normalizedEmail} (TOFU). Fingerprint: ${fingerprint}`,
      isNew: true,
      isMismatch: false,
    };
  }

  if (existing.fingerprint.toLowerCase() === fingerprint.toLowerCase()) {
    return {
      contactKey: existing,
      isNew: false,
      isMismatch: false,
    };
  }

  // Key has changed!
  const updatedKey: ContactPgpKey = {
    ...existing,
    armored_public_key: armoredPublicKey,
    fingerprint,
    trust_status: "warning_mismatch",
  };
  await upsertContactPgpKey(updatedKey);

  return {
    contactKey: updatedKey,
    warning: `SECURITY WARNING: Public key changed for ${normalizedEmail}! Previous fingerprint was ${existing.fingerprint}, but received ${fingerprint}.`,
    isNew: false,
    isMismatch: true,
  };
}

/**
 * Retrieve public key for a contact email.
 */
export async function getContactKey(email: string): Promise<ContactPgpKey | null> {
  return getContactPgpKeyByEmail(email);
}

/**
 * Retrieve all registered contact public keys.
 */
export async function getAllContactKeys(): Promise<ContactPgpKey[]> {
  return listContactPgpKeys();
}

/**
 * Encrypt a plaintext or JSON payload for a recipient using their public key.
 * If the sender has a local identity, also signs the payload.
 */
export async function encryptMetadataPayload(
  payload: string,
  recipientArmoredPublicKey: string,
): Promise<string> {
  const recipientKey = await openpgp.readKey({ armoredKey: recipientArmoredPublicKey });
  const message = await openpgp.createMessage({ text: payload });

  const identity = await getPgpIdentity();
  let signingKeys: openpgp.PrivateKey | undefined;
  if (identity) {
    signingKeys = await openpgp.readPrivateKey({
      armoredKey: identity.armored_private_key,
    });
  }

  return await openpgp.encrypt({
    message,
    encryptionKeys: recipientKey,
    signingKeys,
  });
}

/**
 * Encrypt and sign a payload for multiple recipients (e.g. for reply-all).
 */
export async function encryptSignedMetadataPayloadForRecipients(
  payload: string,
  recipientArmoredPublicKeys: string[],
): Promise<string> {
  const recipientKeys = await Promise.all(
    recipientArmoredPublicKeys.map((armoredKey) => openpgp.readKey({ armoredKey })),
  );
  const message = await openpgp.createMessage({ text: payload });

  const identity = await getPgpIdentity();
  let signingKeys: openpgp.PrivateKey | undefined;
  if (identity) {
    signingKeys = await openpgp.readPrivateKey({
      armoredKey: identity.armored_private_key,
    });
  }

  return await openpgp.encrypt({
    message,
    encryptionKeys: recipientKeys,
    signingKeys,
  });
}

export interface DecryptResult {
  text: string;
  verified: boolean;
  senderFingerprint?: string;
  senderEmail?: string;
  warning?: string;
}

/**
 * Decrypt an armored PGP message using the local application private key.
 * If senderEmail is provided, verifies against the sender's known public key.
 */
export async function decryptMetadataPayload(
  armoredMessage: string,
  senderEmail?: string,
): Promise<DecryptResult> {
  const identity = await getPgpIdentity();
  if (!identity) {
    throw new Error("No PGP private key available for decryption");
  }

  const privateKey = await openpgp.readPrivateKey({
    armoredKey: identity.armored_private_key,
  });
  const message = await openpgp.readMessage({ armoredMessage });

  let verificationKeys: openpgp.PublicKey | undefined;
  let senderKeyRecord: ContactPgpKey | null = null;
  if (senderEmail) {
    senderKeyRecord = await getContactPgpKeyByEmail(senderEmail);
    if (senderKeyRecord) {
      verificationKeys = await openpgp.readKey({
        armoredKey: senderKeyRecord.armored_public_key,
      });
    }
  }

  const { data, signatures } = await openpgp.decrypt({
    message,
    decryptionKeys: privateKey,
    verificationKeys,
  });

  let verified = false;
  let senderFingerprint: string | undefined;

  if (signatures && signatures.length > 0) {
    try {
      const sig = signatures[0];
      if (sig) {
        verified = await sig.verified;
        senderFingerprint = sig.keyID?.toHex();
      }
    } catch {
      verified = false;
    }
  }

  return {
    text: data as string,
    verified,
    senderFingerprint,
    senderEmail,
    warning: senderKeyRecord?.trust_status === "warning_mismatch"
      ? `Public key for ${senderEmail} is flagged with a mismatch warning!`
      : undefined,
  };
}
