// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as openpgp from "openpgp";
import {
  prepareMetadataReply,
  prepareSharedMetadataReplyAll,
  processIncomingMetadataReply,
  processIncomingSharedMetadataReply,
  METADATA_REPLY_TAG,
  SHARED_METADATA_REPLY_TAG,
  METADATA_REPLY_HEADER,
} from "./collaborativeMetadataReply";
import { initAppPgpKey } from "../crypto/pgpService";

// Mock DB modules
const mockDbIdentities: Record<string, any> = {};
const mockDbContactKeys: Record<string, any> = {};
const mockThreadDocs: Record<string, any> = {};
const mockCategories: Record<string, any> = {};
const mockReminders: Record<string, any> = {};

vi.mock("../db/pgpIdentities", () => ({
  getAppPgpIdentity: vi.fn(async (id = "default") => mockDbIdentities[id] || null),
  upsertAppPgpIdentity: vi.fn(async (identity) => {
    mockDbIdentities[identity.id] = identity;
  }),
}));

vi.mock("../db/settings", () => ({
  getSetting: vi.fn(async () => null),
  setSetting: vi.fn(async () => {}),
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

vi.mock("../db/threadCrdtDocs", () => ({
  getThreadCrdtDoc: vi.fn(async (accountId, threadId, scope = "shared") => {
    return mockThreadDocs[`${accountId}:${threadId}:${scope}`] || null;
  }),
  upsertThreadCrdtDoc: vi.fn(async (record) => {
    const scope = record.scope || "shared";
    mockThreadDocs[`${record.account_id}:${record.thread_id}:${scope}`] = record;
  }),
}));

vi.mock("../db/threadCategories", () => ({
  setThreadCategory: vi.fn(async (accountId, threadId, category, isManual) => {
    mockCategories[threadId] = { accountId, threadId, category, isManual };
  }),
}));

vi.mock("../db/followUpReminders", () => ({
  insertFollowUpReminder: vi.fn(async (accountId, threadId, messageId, remindAt) => {
    mockReminders[threadId] = { accountId, threadId, messageId, remindAt };
  }),
  cancelFollowUpForThread: vi.fn(async (_accountId, threadId) => {
    delete mockReminders[threadId];
  }),
}));

vi.mock("../db/threads", () => ({
  setThreadLabels: vi.fn(async () => {}),
}));

describe("collaborativeMetadataReply", () => {
  beforeEach(() => {
    for (const k of Object.keys(mockDbIdentities)) delete mockDbIdentities[k];
    for (const k of Object.keys(mockDbContactKeys)) delete mockDbContactKeys[k];
    for (const k of Object.keys(mockThreadDocs)) delete mockThreadDocs[k];
    for (const k of Object.keys(mockCategories)) delete mockCategories[k];
    for (const k of Object.keys(mockReminders)) delete mockReminders[k];
  });

  it("prepares an encrypted reply with Automerge CRDT metadata updates", async () => {
    // Alice setup
    await initAppPgpKey("alice@supermail.local");

    // Bob key generation & contact registration
    const bob = await openpgp.generateKey({
      userIDs: [{ name: "Bob", email: "bob@example.com" }],
      type: "ecc",
      curve: "ed25519",
    });
    mockDbContactKeys["bob@example.com"] = {
      id: "key-bob",
      email: "bob@example.com",
      armored_public_key: bob.publicKey,
      fingerprint: "bob-fp",
      trust_status: "tofu",
    };

    const reply = await prepareMetadataReply({
      accountId: "acc-alice",
      threadId: "thread-100",
      recipientEmail: "bob@example.com",
      updates: {
        categories: ["Finance"],
        followUpAt: 1780000000,
        notes: "Shared collaborative note",
      },
    });

    expect(reply.body).toContain(SHARED_METADATA_REPLY_TAG);
    expect(reply.body).toContain("-----BEGIN PGP MESSAGE-----");
    expect(reply.headers[METADATA_REPLY_HEADER]).toBe("shared-crdt-v1");
    expect(reply.headers["X-SuperMail-Conversation-Id"]).toBe("thread-100");
  });

  it("prepares a reply-all payload with signed Automerge shared metadata encrypted for multiple participants", async () => {
    await initAppPgpKey("alice@supermail.local");

    // Register Bob and Charlie public keys
    const bob = await openpgp.generateKey({
      userIDs: [{ name: "Bob", email: "bob@example.com" }],
      type: "curve25519",
    });
    const charlie = await openpgp.generateKey({
      userIDs: [{ name: "Charlie", email: "charlie@example.com" }],
      type: "curve25519",
    });

    mockDbContactKeys["bob@example.com"] = {
      id: "key-bob",
      email: "bob@example.com",
      armored_public_key: bob.publicKey,
      fingerprint: "bob-fp",
      trust_status: "tofu",
    };
    mockDbContactKeys["charlie@example.com"] = {
      id: "key-charlie",
      email: "charlie@example.com",
      armored_public_key: charlie.publicKey,
      fingerprint: "charlie-fp",
      trust_status: "tofu",
    };

    const replyAll = await prepareSharedMetadataReplyAll({
      accountId: "acc-alice",
      threadId: "thread-multi-100",
      recipientEmails: ["bob@example.com", "charlie@example.com"],
      sharedUpdates: {
        sharedCategories: ["Q3-Planning"],
        sharedNotes: "Roadmap aligned with team",
        sharedStatus: "In-Progress",
      },
      authorEmail: "alice@supermail.local",
    });

    expect(replyAll.body).toContain(SHARED_METADATA_REPLY_TAG);
    expect(replyAll.body).toContain("-----BEGIN PGP MESSAGE-----");
    expect(replyAll.headers["X-SuperMail-Metadata"]).toBe("shared-crdt-v1");
    expect(replyAll.headers["X-SuperMail-Metadata-Scope"]).toBe("shared");
    expect(replyAll.recipients).toEqual(["bob@example.com", "charlie@example.com"]);

    // Verify Bob can decrypt it
    const bobPriv = await openpgp.readPrivateKey({ armoredKey: bob.privateKey });
    const bobDecrypted = await openpgp.decrypt({
      message: await openpgp.readMessage({ armoredMessage: replyAll.encryptedPayload }),
      decryptionKeys: bobPriv,
    });
    const bobParsed = JSON.parse(bobDecrypted.data as string);
    expect(bobParsed.scope).toBe("shared");
    expect(bobParsed.threadId).toBe("thread-multi-100");

    // Verify Charlie can also decrypt it
    const charliePriv = await openpgp.readPrivateKey({ armoredKey: charlie.privateKey });
    const charlieDecrypted = await openpgp.decrypt({
      message: await openpgp.readMessage({ armoredMessage: replyAll.encryptedPayload }),
      decryptionKeys: charliePriv,
    });
    const charlieParsed = JSON.parse(charlieDecrypted.data as string);
    expect(charlieParsed.scope).toBe("shared");
    expect(charlieParsed.threadId).toBe("thread-multi-100");
  });

  it("processes an incoming email reply containing encrypted Automerge metadata and updates local DB", async () => {
    // Generate Alice & Bob keys
    const alice = await openpgp.generateKey({
      userIDs: [{ name: "Alice", email: "alice@example.com" }],
      type: "ecc",
      curve: "ed25519",
    });
    const bob = await openpgp.generateKey({
      userIDs: [{ name: "Bob", email: "bob@supermail.local" }],
      type: "ecc",
      curve: "ed25519",
    });

    // App identity is Bob
    const bobKeyObj = await openpgp.readKey({ armoredKey: bob.publicKey });
    mockDbIdentities["default"] = {
      id: "default",
      email: "bob@supermail.local",
      armored_public_key: bob.publicKey,
      armored_private_key: bob.privateKey,
      fingerprint: bobKeyObj.getFingerprint(),
    };

    // Alice is in Bob's contact keyring
    mockDbContactKeys["alice@example.com"] = {
      id: "key-alice",
      email: "alice@example.com",
      armored_public_key: alice.publicKey,
      fingerprint: "alice-fp",
      trust_status: "tofu",
    };

    // Alice encrypts a metadata reply for Bob
    const alicePriv = await openpgp.readPrivateKey({ armoredKey: alice.privateKey });
    const bobPub = await openpgp.readKey({ armoredKey: bob.publicKey });

    const payload = JSON.stringify({
      threadId: "thread-200",
      conversationId: "thread-200",
      scope: "shared",
      docBase64: (await vi.importActual("./metadataCrdt") as any).serializeMetadataDoc(
        (await vi.importActual("./metadataCrdt") as any).createSharedMetadataDoc({
          conversationId: "thread-200",
          sharedCategories: ["Urgent"],
          sharedNotes: "Alice updated this thread",
        })
      ),
      timestamp: Date.now(),
    });

    const encryptedMsg = await openpgp.encrypt({
      message: await openpgp.createMessage({ text: payload }),
      encryptionKeys: bobPub,
      signingKeys: alicePriv,
    });

    const emailBody = `Hey Bob, here is the updated thread metadata.\r\n\r\n${METADATA_REPLY_TAG}\r\n\r\n${encryptedMsg}\r\n`;

    // Bob processes incoming email
    const result = await processIncomingMetadataReply(
      "acc-bob",
      "alice@example.com",
      emailBody,
      "thread-200",
    );

    expect(result.processed).toBe(true);
    expect(result.threadId).toBe("thread-200");
    expect(result.mergedState?.categories).toContain("Urgent");
    expect(result.mergedState?.notes).toBe("Alice updated this thread");

    // Check DB updates: shared category is applied, local reminders are not affected
    expect(mockCategories["thread-200"]?.category).toBe("Urgent");
    expect(mockReminders["thread-200"]).toBeUndefined();
  });
});
