// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMetadataDoc,
  updateMetadataDoc,
  serializeMetadataDoc,
  deserializeMetadataDoc,
  mergeMetadataDocs,
  getOrInitThreadCrdtDoc,
  saveThreadCrdtDoc,
  reconcileCrdtToLocalDb,
  createLocalMetadataDoc,
  updateLocalMetadataDoc,
  createPersonalMetadataDoc,
  updatePersonalMetadataDoc,
  createSharedMetadataDoc,
  updateSharedMetadataDoc,
  getOrInitLocalMetadataDoc,
  saveLocalMetadataDoc,
  getOrInitPersonalMetadataDoc,
  savePersonalMetadataDoc,
  getOrInitSharedMetadataDoc,
  saveSharedMetadataDoc,
  reconcileLocalMetadataToDb,
  reconcilePersonalMetadataToDb,
  reconcileSharedMetadataToDb,
  isEmailFiltered,
  markEmailFiltered,
  getPersonalMetadata,
  setConversationMetadataLabels,
  getConversationMetadataLabels,
  getConversationMetadata,
} from "./metadataCrdt";

const mockCrdtDocs: Record<string, any> = {};
const mockCategories: Record<string, any> = {};
const mockReminders: Record<string, any> = {};

vi.mock("../db/threadCrdtDocs", () => ({
  getThreadCrdtDoc: vi.fn(async (accountId, threadId, scope = "shared") => {
    return mockCrdtDocs[`${accountId}:${threadId}:${scope}`] || null;
  }),
  upsertThreadCrdtDoc: vi.fn(async (record) => {
    const scope = record.scope || "shared";
    mockCrdtDocs[`${record.account_id}:${record.thread_id}:${scope}`] = record;
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

vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => ({
    execute: vi.fn(async () => {}),
    select: vi.fn(async () => []),
  })),
}));

describe("metadataCrdt", () => {
  beforeEach(() => {
    for (const k of Object.keys(mockCrdtDocs)) delete mockCrdtDocs[k];
    for (const k of Object.keys(mockCategories)) delete mockCategories[k];
    for (const k of Object.keys(mockReminders)) delete mockReminders[k];
  });

  it("creates, updates, serializes and deserializes Automerge documents", () => {
    const doc = createMetadataDoc({
      categories: ["Work"],
      labels: ["INBOX"],
      notes: "Important project email",
    });

    expect(doc.categories).toEqual(["Work"]);
    expect(doc.labels).toEqual(["INBOX"]);
    expect(doc.notes).toBe("Important project email");

    const updated = updateMetadataDoc(doc, {
      categories: ["Work", "Urgent"],
      isStarred: true,
      followUpAt: 1720000000,
    });

    expect(updated.categories).toEqual(["Work", "Urgent"]);
    expect(updated.isStarred).toBe(true);
    expect(updated.followUpAt).toBe(1720000000);

    const b64 = serializeMetadataDoc(updated);
    expect(typeof b64).toBe("string");

    const reloaded = deserializeMetadataDoc(b64);
    expect(reloaded.categories).toEqual(["Work", "Urgent"]);
    expect(reloaded.isStarred).toBe(true);
    expect(reloaded.followUpAt).toBe(1720000000);
  });

  it("converges concurrent modifications across two devices using mergeMetadataDocs", () => {
    // Device A creates initial doc
    const initialDoc = createMetadataDoc({
      categories: ["Personal"],
      labels: ["INBOX"],
    });

    // Save and send state to Device B
    const serialized = serializeMetadataDoc(initialDoc);
    let deviceADoc = deserializeMetadataDoc(serialized);
    let deviceBDoc = deserializeMetadataDoc(serialized);

    // Device A adds a note
    deviceADoc = updateMetadataDoc(deviceADoc, {
      notes: "Note added by Device A",
      isStarred: true,
    });

    // Device B concurrently sets a follow-up date and category
    deviceBDoc = updateMetadataDoc(deviceBDoc, {
      followUpAt: 1750000000,
      categories: ["Personal", "Finance"],
    });

    // Merge Device B changes into Device A
    const mergedA = mergeMetadataDocs(deviceADoc, deviceBDoc);
    // Merge Device A changes into Device B
    const mergedB = mergeMetadataDocs(deviceBDoc, deviceADoc);

    // Both devices converge to identical state
    expect(mergedA.notes).toBe("Note added by Device A");
    expect(mergedA.followUpAt).toBe(1750000000);
    expect(mergedB.notes).toBe("Note added by Device A");
    expect(mergedB.followUpAt).toBe(1750000000);
  });

  it("supports multi-party collaboration on conversation metadata tracking collaborators", () => {
    // Alice starts conversation metadata
    let doc = createMetadataDoc({
      conversationId: "conv-shared-1",
      categories: ["Project-Phoenix"],
    });
    doc = updateMetadataDoc(doc, { notes: "Draft plan started" }, "alice@example.com");

    // Bob receives and collaborates
    let bobDoc = deserializeMetadataDoc(serializeMetadataDoc(doc));
    bobDoc = updateMetadataDoc(bobDoc, { followUpAt: 1760000000 }, "bob@example.com");

    // Charlie receives and collaborates
    let charlieDoc = deserializeMetadataDoc(serializeMetadataDoc(doc));
    charlieDoc = updateMetadataDoc(charlieDoc, { categories: ["Project-Phoenix", "Signed-Off"] }, "charlie@example.com");

    // Merge all three
    let merged = mergeMetadataDocs(doc, bobDoc);
    merged = mergeMetadataDocs(merged, charlieDoc);

    expect(merged.conversationId).toBe("conv-shared-1");
    expect(merged.followUpAt).toBe(1760000000);
    expect(merged.notes).toBe("Draft plan started");
    expect(merged.collaborators).toContain("alice@example.com");
    expect(merged.collaborators).toContain("bob@example.com");
    expect(merged.collaborators).toContain("charlie@example.com");
  });

  it("reconciles merged CRDT document into local SQLite tables", async () => {
    const doc = createMetadataDoc({
      categories: ["Updates"],
      followUpAt: 1730000000,
      labels: ["INBOX", "STARRED"],
    });

    await reconcileCrdtToLocalDb("acc-1", "thread-123", doc);

    expect(mockCategories["thread-123"]).toEqual({
      accountId: "acc-1",
      threadId: "thread-123",
      category: "Updates",
      isManual: true,
    });

    expect(mockReminders["thread-123"]).toEqual({
      accountId: "acc-1",
      threadId: "thread-123",
      messageId: "thread-123",
      remindAt: 1730000000,
    });
  });

  it("strictly isolates personal metadata from shared metadata", async () => {
    // 1. User sets private personal metadata (private note, personal follow-up)
    const personalDoc = createPersonalMetadataDoc({
      conversationId: "thread-555",
      privateNotes: "Secret salary negotiation notes",
      followUpAt: 1780000000,
      personalLabels: ["INBOX", "Archive"],
      category: "Personal",
    });
    await savePersonalMetadataDoc("acc-1", "thread-555", personalDoc);

    // 2. User sets collaborative shared metadata (shared category, shared notes)
    const sharedDoc = createSharedMetadataDoc({
      conversationId: "thread-555",
      sharedCategories: ["Negotiation"],
      sharedNotes: "Agreed to follow up on Tuesday",
      collaborators: ["me@example.com"],
    });
    await saveSharedMetadataDoc("acc-1", "thread-555", sharedDoc);

    // 3. Verify personal doc and shared doc are stored independently in their respective scopes
    const fetchedPersonal = await getOrInitPersonalMetadataDoc("acc-1", "thread-555");
    const fetchedShared = await getOrInitSharedMetadataDoc("acc-1", "thread-555");

    expect(fetchedPersonal.privateNotes).toBe("Secret salary negotiation notes");
    expect(fetchedPersonal.followUpAt).toBe(1780000000);
    expect(fetchedPersonal.category).toBe("Personal");
    // Shared doc does NOT contain private notes or personal follow-up!
    expect((fetchedShared as any).privateNotes).toBeUndefined();
    expect((fetchedShared as any).followUpAt).toBeUndefined();
    expect(fetchedShared.sharedCategories).toEqual(["Negotiation"]);
    expect(fetchedShared.sharedNotes).toBe("Agreed to follow up on Tuesday");

    // 4. Reconcile personal metadata to local db
    await reconcilePersonalMetadataToDb("acc-1", "thread-555", fetchedPersonal);
    expect(mockCategories["thread-555"]).toEqual({
      accountId: "acc-1",
      threadId: "thread-555",
      category: "Personal",
      isManual: true,
    });
    expect(mockReminders["thread-555"]).toEqual({
      accountId: "acc-1",
      threadId: "thread-555",
      messageId: "thread-555",
      remindAt: 1780000000,
    });
  });

  describe("client-side filter metadata tracking", () => {
    it("initializes isFiltered in personal metadata doc", () => {
      const docDefault = createPersonalMetadataDoc({ conversationId: "t-1" });
      expect(docDefault.isFiltered).toBe(false);

      const docFiltered = createPersonalMetadataDoc({
        conversationId: "t-2",
        isFiltered: true,
      });
      expect(docFiltered.isFiltered).toBe(true);
    });

    it("updates isFiltered in personal metadata doc", () => {
      const doc = createPersonalMetadataDoc({ conversationId: "t-1" });
      expect(doc.isFiltered).toBe(false);

      const updated = updatePersonalMetadataDoc(doc, { isFiltered: true });
      expect(updated.isFiltered).toBe(true);

      const reverted = updatePersonalMetadataDoc(updated, { isFiltered: false });
      expect(reverted.isFiltered).toBe(false);
    });

    it("tracks isFiltered in composite metadata doc", () => {
      const doc = createMetadataDoc({ isFiltered: true });
      expect(doc.isFiltered).toBe(true);

      const updated = updateMetadataDoc(doc, { isFiltered: false });
      expect(updated.isFiltered).toBe(false);
    });

    it("isEmailFiltered returns false when no doc exists", async () => {
      const filtered = await isEmailFiltered("acc-1", "non-existent");
      expect(filtered).toBe(false);
    });

    it("markEmailFiltered marks email as filtered and persists to storage", async () => {
      expect(await isEmailFiltered("acc-1", "thread-101")).toBe(false);

      await markEmailFiltered("acc-1", "thread-101", true);
      expect(await isEmailFiltered("acc-1", "thread-101")).toBe(true);

      const meta = await getPersonalMetadata("acc-1", "thread-101");
      expect(meta?.isFiltered).toBe(true);

      await markEmailFiltered("acc-1", "thread-101", false);
      expect(await isEmailFiltered("acc-1", "thread-101")).toBe(false);
    });
  });

  describe("conversation labels in metadata", () => {
    it("stores conversation labels in personal metadata doc and reconciles to thread_labels", async () => {
      await setConversationMetadataLabels("acc-1", "thread-200", ["INBOX", "UNREAD"]);

      const labels = await getConversationMetadataLabels("acc-1", "thread-200");
      expect(labels).toEqual(["INBOX", "UNREAD"]);

      const meta = await getPersonalMetadata("acc-1", "thread-200");
      expect(meta?.personalLabels).toEqual(["INBOX", "UNREAD"]);
      expect(meta?.labels).toEqual(["INBOX", "UNREAD"]);

      const convMeta = await getConversationMetadata("acc-1", "thread-200");
      expect(convMeta?.personalLabels).toEqual(["INBOX", "UNREAD"]);
    });

    it("updates existing conversation labels in metadata", async () => {
      await setConversationMetadataLabels("acc-1", "thread-201", ["INBOX"]);
      expect(await getConversationMetadataLabels("acc-1", "thread-201")).toEqual(["INBOX"]);

      await setConversationMetadataLabels("acc-1", "thread-201", ["archive"]);
      expect(await getConversationMetadataLabels("acc-1", "thread-201")).toEqual(["archive"]);
    });
  });
});
