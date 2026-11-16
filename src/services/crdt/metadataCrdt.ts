import * as automerge from "@automerge/automerge";
import { base64Encode, base64Decode } from "../../utils/crypto";
import { getThreadCrdtDoc, upsertThreadCrdtDoc, type CrdtScope } from "../db/threadCrdtDocs";
import { setThreadCategory } from "../db/threadCategories";
import { insertFollowUpReminder, cancelFollowUpForThread } from "../db/followUpReminders";
import { setThreadLabels } from "../db/threads";

/**
 * Personal metadata: private to this user/account.
 * Stored in the .metadata shadow folder on the IMAP server and synced across
 * the user's own devices. NEVER sent out in email replies.
 */
export interface PersonalMetadataState {
  conversationId?: string;
  personalLabels: string[];
  followUpAt?: number | null;
  privateNotes?: string;
  isStarred?: boolean;
  isRead?: boolean;
  category?: string | null;
  lastUpdated: number;
}

export type LocalMetadataState = PersonalMetadataState;

/**
 * Shared metadata: collaborative across all participants in a conversation.
 * Created/updated by sending a reply-all email with signed Automerge CRDT operations.
 */
export interface SharedMetadataState {
  conversationId?: string;
  sharedCategories: string[];
  sharedLabels: string[];
  sharedNotes?: string;
  sharedStatus?: string;
  collaborators: string[];
  lastUpdated: number;
}

/**
 * Composite view of metadata (convenience type).
 */
export interface ConversationMetadataState extends Partial<LocalMetadataState>, Partial<SharedMetadataState> {
  conversationId?: string;
  categories: string[];
  labels: string[];
  isStarred?: boolean;
  isRead?: boolean;
  followUpAt?: number | null;
  notes?: string;
  collaborators?: string[];
  lastUpdated: number;
}

export type EmailMetadataState = ConversationMetadataState;

// ============================================================================
// Personal Metadata (Shadow folder sync only)
// ============================================================================

export function createPersonalMetadataDoc(
  initial?: Partial<PersonalMetadataState>,
): automerge.Doc<PersonalMetadataState> {
  let doc = automerge.init<PersonalMetadataState>();
  doc = automerge.change(doc, "Initialize personal metadata document", (d) => {
    d.conversationId = initial?.conversationId ?? "";
    d.personalLabels = initial?.personalLabels ? [...initial.personalLabels] : [];
    d.followUpAt = initial?.followUpAt ?? null;
    d.privateNotes = initial?.privateNotes ?? "";
    d.isStarred = initial?.isStarred ?? false;
    d.isRead = initial?.isRead ?? false;
    d.category = initial?.category ?? null;
    d.lastUpdated = initial?.lastUpdated ?? Date.now();
  });
  return doc;
}

export const createLocalMetadataDoc = createPersonalMetadataDoc;

export function updatePersonalMetadataDoc(
  doc: automerge.Doc<PersonalMetadataState>,
  changes: Partial<PersonalMetadataState>,
  message = "Update personal metadata",
): automerge.Doc<PersonalMetadataState> {
  return automerge.change(doc, message, (d) => {
    if (changes.conversationId !== undefined) d.conversationId = changes.conversationId;
    if (changes.personalLabels !== undefined) d.personalLabels = [...changes.personalLabels];
    if (changes.followUpAt !== undefined) d.followUpAt = changes.followUpAt;
    if (changes.privateNotes !== undefined) d.privateNotes = changes.privateNotes;
    if (changes.isStarred !== undefined) d.isStarred = changes.isStarred;
    if (changes.isRead !== undefined) d.isRead = changes.isRead;
    if (changes.category !== undefined) d.category = changes.category;
    d.lastUpdated = Date.now();
  });
}

export const updateLocalMetadataDoc = updatePersonalMetadataDoc;

// ============================================================================
// Shared Metadata (Reply-All CRDT synchronization)
// ============================================================================

export function createSharedMetadataDoc(
  initial?: Partial<SharedMetadataState>,
): automerge.Doc<SharedMetadataState> {
  let doc = automerge.init<SharedMetadataState>();
  doc = automerge.change(doc, "Initialize shared metadata document", (d) => {
    d.conversationId = initial?.conversationId ?? "";
    d.sharedCategories = initial?.sharedCategories ? [...initial.sharedCategories] : [];
    d.sharedLabels = initial?.sharedLabels ? [...initial.sharedLabels] : [];
    d.sharedNotes = initial?.sharedNotes ?? "";
    d.sharedStatus = initial?.sharedStatus ?? "";
    d.collaborators = initial?.collaborators ? [...initial.collaborators] : [];
    d.lastUpdated = initial?.lastUpdated ?? Date.now();
  });
  return doc;
}

export function updateSharedMetadataDoc(
  doc: automerge.Doc<SharedMetadataState>,
  changes: Partial<SharedMetadataState>,
  authorEmail?: string,
  message = "Update shared metadata",
): automerge.Doc<SharedMetadataState> {
  return automerge.change(doc, message, (d) => {
    if (changes.conversationId !== undefined) d.conversationId = changes.conversationId;
    if (changes.sharedCategories !== undefined) d.sharedCategories = [...changes.sharedCategories];
    if (changes.sharedLabels !== undefined) d.sharedLabels = [...changes.sharedLabels];
    if (changes.sharedNotes !== undefined) d.sharedNotes = changes.sharedNotes;
    if (changes.sharedStatus !== undefined) d.sharedStatus = changes.sharedStatus;
    if (authorEmail) {
      if (!d.collaborators) d.collaborators = [];
      if (!d.collaborators.includes(authorEmail)) {
        d.collaborators.push(authorEmail);
      }
    }
    d.lastUpdated = Date.now();
  });
}

// ============================================================================
// General Serialization & Merge helpers
// ============================================================================

export function serializeMetadataDoc<T>(doc: automerge.Doc<T>): string {
  const binary = automerge.save(doc);
  return base64Encode(binary);
}

export function deserializeMetadataDoc<T>(base64: string): automerge.Doc<T> {
  const bytes = base64Decode(base64);
  return automerge.load<T>(bytes);
}

export function mergeMetadataDocs<T>(
  localDoc: automerge.Doc<T>,
  remoteDoc: automerge.Doc<T>,
): automerge.Doc<T> {
  return automerge.merge(localDoc, remoteDoc);
}

// ============================================================================
// Scoped Database Accessors (Personal vs Shared)
// ============================================================================

export async function getOrInitPersonalMetadataDoc(
  accountId: string,
  threadId: string,
  initial?: Partial<PersonalMetadataState>,
): Promise<automerge.Doc<PersonalMetadataState>> {
  const record = await getThreadCrdtDoc(accountId, threadId, "personal");
  if (record && record.doc_base64) {
    try {
      return deserializeMetadataDoc<PersonalMetadataState>(record.doc_base64);
    } catch (e) {
      console.warn(`[metadataCrdt] Failed to deserialize personal doc for thread ${threadId}:`, e);
    }
  }

  const newDoc = createPersonalMetadataDoc({ conversationId: threadId, ...initial });
  await savePersonalMetadataDoc(accountId, threadId, newDoc);
  return newDoc;
}

export const getOrInitLocalMetadataDoc = getOrInitPersonalMetadataDoc;

export async function savePersonalMetadataDoc(
  accountId: string,
  threadId: string,
  doc: automerge.Doc<PersonalMetadataState>,
): Promise<void> {
  const base64 = serializeMetadataDoc(doc);
  await upsertThreadCrdtDoc({
    account_id: accountId,
    thread_id: threadId,
    scope: "personal",
    doc_base64: base64,
  });
}

export const saveLocalMetadataDoc = savePersonalMetadataDoc;

export async function getOrInitSharedMetadataDoc(
  accountId: string,
  threadId: string,
  initial?: Partial<SharedMetadataState>,
): Promise<automerge.Doc<SharedMetadataState>> {
  const record = await getThreadCrdtDoc(accountId, threadId, "shared");
  if (record && record.doc_base64) {
    try {
      return deserializeMetadataDoc<SharedMetadataState>(record.doc_base64);
    } catch (e) {
      console.warn(`[metadataCrdt] Failed to deserialize shared doc for thread ${threadId}:`, e);
    }
  }

  const newDoc = createSharedMetadataDoc({ conversationId: threadId, ...initial });
  await saveSharedMetadataDoc(accountId, threadId, newDoc);
  return newDoc;
}

export async function saveSharedMetadataDoc(
  accountId: string,
  threadId: string,
  doc: automerge.Doc<SharedMetadataState>,
): Promise<void> {
  const base64 = serializeMetadataDoc(doc);
  await upsertThreadCrdtDoc({
    account_id: accountId,
    thread_id: threadId,
    scope: "shared",
    doc_base64: base64,
  });
}

// ============================================================================
// Reconciliation
// ============================================================================

export async function reconcilePersonalMetadataToDb(
  accountId: string,
  threadId: string,
  doc: automerge.Doc<PersonalMetadataState>,
): Promise<void> {
  if (doc.category) {
    await setThreadCategory(accountId, threadId, doc.category, true);
  }
  if (doc.followUpAt) {
    await insertFollowUpReminder(accountId, threadId, threadId, doc.followUpAt);
  } else if (doc.followUpAt === null) {
    await cancelFollowUpForThread(accountId, threadId);
  }
  if (doc.personalLabels && doc.personalLabels.length > 0) {
    try {
      await setThreadLabels(accountId, threadId, doc.personalLabels);
    } catch (e) {
      console.warn(`[metadataCrdt] Could not update thread labels for ${threadId}:`, e);
    }
  }
}

export const reconcileLocalMetadataToDb = reconcilePersonalMetadataToDb;

export async function reconcileSharedMetadataToDb(
  accountId: string,
  threadId: string,
  doc: automerge.Doc<SharedMetadataState>,
): Promise<void> {
  if (doc.sharedCategories && doc.sharedCategories.length > 0) {
    const primary = doc.sharedCategories[0];
    if (primary) {
      await setThreadCategory(accountId, threadId, primary, true);
    }
  }
  if (doc.sharedLabels && doc.sharedLabels.length > 0) {
    try {
      await setThreadLabels(accountId, threadId, doc.sharedLabels);
    } catch (e) {
      console.warn(`[metadataCrdt] Could not update shared thread labels for ${threadId}:`, e);
    }
  }
}

// ============================================================================
// Backward compatibility wrappers
// ============================================================================

export function createMetadataDoc(
  initial?: Partial<ConversationMetadataState>,
): automerge.Doc<ConversationMetadataState> {
  let doc = automerge.init<ConversationMetadataState>();
  doc = automerge.change(doc, "Initialize conversation metadata document", (d) => {
    d.conversationId = initial?.conversationId ?? "";
    d.categories = initial?.categories ? [...initial.categories] : [];
    d.labels = initial?.labels ? [...initial.labels] : [];
    d.isStarred = initial?.isStarred ?? false;
    d.isRead = initial?.isRead ?? false;
    d.followUpAt = initial?.followUpAt ?? null;
    d.notes = initial?.notes ?? "";
    d.collaborators = initial?.collaborators ? [...initial.collaborators] : [];
    d.lastUpdated = initial?.lastUpdated ?? Date.now();
  });
  return doc;
}

export function updateMetadataDoc(
  doc: automerge.Doc<ConversationMetadataState>,
  changes: Partial<ConversationMetadataState>,
  authorEmail?: string,
  message = "Update conversation metadata",
): automerge.Doc<ConversationMetadataState> {
  return automerge.change(doc, message, (d) => {
    if (changes.conversationId !== undefined) d.conversationId = changes.conversationId;
    if (changes.categories !== undefined) d.categories = [...changes.categories];
    if (changes.labels !== undefined) d.labels = [...changes.labels];
    if (changes.isStarred !== undefined) d.isStarred = changes.isStarred;
    if (changes.isRead !== undefined) d.isRead = changes.isRead;
    if (changes.followUpAt !== undefined) d.followUpAt = changes.followUpAt;
    if (changes.notes !== undefined) d.notes = changes.notes;
    if (authorEmail) {
      if (!d.collaborators) d.collaborators = [];
      if (!d.collaborators.includes(authorEmail)) {
        d.collaborators.push(authorEmail);
      }
    }
    d.lastUpdated = Date.now();
  });
}

export async function getOrInitThreadCrdtDoc(
  accountId: string,
  threadId: string,
  initial?: Partial<ConversationMetadataState>,
  scope: CrdtScope = "shared",
): Promise<automerge.Doc<ConversationMetadataState>> {
  const record = await getThreadCrdtDoc(accountId, threadId, scope);
  if (record && record.doc_base64) {
    try {
      return deserializeMetadataDoc<ConversationMetadataState>(record.doc_base64);
    } catch (e) {
      console.warn(`[metadataCrdt] Failed to deserialize existing doc for thread ${threadId}:`, e);
    }
  }

  const newDoc = createMetadataDoc(initial);
  await saveThreadCrdtDoc(accountId, threadId, newDoc, scope);
  return newDoc;
}

export async function saveThreadCrdtDoc(
  accountId: string,
  threadId: string,
  doc: automerge.Doc<ConversationMetadataState>,
  scope: CrdtScope = "shared",
): Promise<void> {
  const base64 = serializeMetadataDoc(doc);
  await upsertThreadCrdtDoc({
    account_id: accountId,
    thread_id: threadId,
    scope,
    doc_base64: base64,
  });
}

export async function reconcileCrdtToLocalDb(
  accountId: string,
  threadId: string,
  doc: automerge.Doc<ConversationMetadataState>,
): Promise<void> {
  if (doc.categories && doc.categories.length > 0) {
    const primary = doc.categories[0];
    if (primary) {
      await setThreadCategory(accountId, threadId, primary, true);
    }
  }
  if (doc.followUpAt) {
    await insertFollowUpReminder(accountId, threadId, threadId, doc.followUpAt);
  } else if (doc.followUpAt === null) {
    await cancelFollowUpForThread(accountId, threadId);
  }
  if (doc.labels && doc.labels.length > 0) {
    try {
      await setThreadLabels(accountId, threadId, doc.labels);
    } catch (e) {
      console.warn(`[metadataCrdt] Could not update thread labels for ${threadId}:`, e);
    }
  }
}
