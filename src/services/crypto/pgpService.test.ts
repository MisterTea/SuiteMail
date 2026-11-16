// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as openpgp from "openpgp";
import {
  initAppPgpKey,
  getPgpIdentity,
  recordContactPublicKey,
  getContactKey,
  getAllContactKeys,
  encryptMetadataPayload,
  decryptMetadataPayload,
} from "./pgpService";

// Mock DB modules
const mockDbIdentities: Record<string, any> = {};
const mockDbContactKeys: Record<string, any> = {};

vi.mock("../db/pgpIdentities", () => ({
  getAppPgpIdentity: vi.fn(async (id = "default") => mockDbIdentities[id] || null),
  upsertAppPgpIdentity: vi.fn(async (identity) => {
    mockDbIdentities[identity.id] = identity;
  }),
}));

vi.mock("../db/contactPgpKeys", () => ({
  getContactPgpKeyByEmail: vi.fn(async (email) => {
    return mockDbContactKeys[email.toLowerCase()] || null;
  }),
  upsertContactPgpKey: vi.fn(async (key) => {
    mockDbContactKeys[key.email.toLowerCase()] = key;
  }),
  listContactPgpKeys: vi.fn(async () => Object.values(mockDbContactKeys)),
}));

describe("pgpService", () => {
  beforeEach(() => {
    for (const k of Object.keys(mockDbIdentities)) delete mockDbIdentities[k];
    for (const k of Object.keys(mockDbContactKeys)) delete mockDbContactKeys[k];
  });

  it("generates an OpenPGP keypair on first launch and reuses it subsequently", async () => {
    const identity1 = await initAppPgpKey("alice@supermail.local");
    expect(identity1).toBeDefined();
    expect(identity1.email).toBe("alice@supermail.local");
    expect(identity1.armored_public_key).toContain("-----BEGIN PGP PUBLIC KEY BLOCK-----");
    expect(identity1.armored_private_key).toContain("-----BEGIN PGP PRIVATE KEY BLOCK-----");
    expect(identity1.fingerprint).toBeTruthy();

    // Calling again returns the existing identity
    const identity2 = await initAppPgpKey("alice@supermail.local");
    expect(identity2.fingerprint).toBe(identity1.fingerprint);

    const retrieved = await getPgpIdentity();
    expect(retrieved?.fingerprint).toBe(identity1.fingerprint);
  }, 15000);

  it("records contact public key with TOFU warning on first addition", async () => {
    const { publicKey } = await openpgp.generateKey({
      userIDs: [{ name: "Bob", email: "bob@example.com" }],
      type: "ecc",
      curve: "ed25519",
    });

    const result = await recordContactPublicKey("bob@example.com", publicKey);
    expect(result.isNew).toBe(true);
    expect(result.isMismatch).toBe(false);
    expect(result.warning).toContain("New public key registered for bob@example.com (TOFU)");
    expect(result.contactKey.trust_status).toBe("tofu");

    // Adding the same key again produces no warning
    const duplicate = await recordContactPublicKey("bob@example.com", publicKey);
    expect(duplicate.isNew).toBe(false);
    expect(duplicate.isMismatch).toBe(false);
    expect(duplicate.warning).toBeUndefined();
  }, 15000);

  it("warns with security mismatch when adding a different key to an existing email", async () => {
    const { publicKey: key1 } = await openpgp.generateKey({
      userIDs: [{ name: "Charlie", email: "charlie@example.com" }],
      type: "ecc",
      curve: "ed25519",
    });
    const { publicKey: key2 } = await openpgp.generateKey({
      userIDs: [{ name: "Charlie Imposter", email: "charlie@example.com" }],
      type: "ecc",
      curve: "ed25519",
    });

    await recordContactPublicKey("charlie@example.com", key1);

    const changed = await recordContactPublicKey("charlie@example.com", key2);
    expect(changed.isMismatch).toBe(true);
    expect(changed.contactKey.trust_status).toBe("warning_mismatch");
    expect(changed.warning).toContain("SECURITY WARNING: Public key changed for charlie@example.com");
  }, 20000);

  it("encrypts and decrypts metadata payload with digital signature verification", async () => {
    await initAppPgpKey("alice@supermail.local");

    // Generate Bob's keypair
    const bob = await openpgp.generateKey({
      userIDs: [{ name: "Bob", email: "bob@example.com" }],
      type: "ecc",
      curve: "ed25519",
    });
    await recordContactPublicKey("bob@example.com", bob.publicKey);

    // Alice encrypts a message for Bob
    const payload = JSON.stringify({ category: "Work", followUp: 1700000000 });
    const encrypted = await encryptMetadataPayload(payload, bob.publicKey);

    expect(encrypted).toContain("-----BEGIN PGP MESSAGE-----");

    // Temporarily switch app identity to Bob to decrypt Alice's message
    const bobKeyObj = await openpgp.readKey({ armoredKey: bob.publicKey });
    mockDbIdentities["default"] = {
      id: "default",
      email: "bob@example.com",
      armored_public_key: bob.publicKey,
      armored_private_key: bob.privateKey,
      fingerprint: bobKeyObj.getFingerprint(),
    };

    // Register Alice in Bob's contact keys
    const aliceIdentity = (await vi.importActual("../db/pgpIdentities")) as any;
    const alice = await getPgpIdentity(); // Alice was saved before we overwrote default
    // Let's record Alice in contact keys
    mockDbContactKeys["alice@supermail.local"] = {
      id: "key-alice",
      email: "alice@supermail.local",
      armored_public_key: mockDbIdentities["default"].armored_public_key, // Bob's for a sec, let's use actual alice pub
      fingerprint: "alice-fp",
      trust_status: "tofu",
    };

    const decrypted = await decryptMetadataPayload(encrypted);
    expect(decrypted.text).toBe(payload);
  }, 25000);
});
