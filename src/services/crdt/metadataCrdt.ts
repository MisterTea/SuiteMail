import * as automerge from "@automerge/automerge";
import { base64Encode, base64Decode } from "../../utils/crypto";
import { getThreadCrdtDoc, upsertThreadCrdtDoc, type CrdtScope } from "../db/threadCrdtDocs";
import { setThreadCategory } from "../db/threadCategories";
import { insertFollowUpReminder, cancelFollowUpForThread } from "../db/followUpReminders";
import { setThreadLabels } from "../db/threads";
import { getDb } from "../db/connection";
import { recordMetadataChange } from "../db/metadataHistory";

/**
 * Personal metadata: private to this user/account.
 * Stored in the .metadata shadow folder on the IMAP server and synced across
 * the user's own devices. NEVER sent out in email replies.
 */
export interface PersonalMetadataState {
  conversationId?: string;
  personalLabels: string[];
  labels?: string[];
  followUpAt?: number | null;
  privateNotes?: string;
  isStarred?: boolean;
  isRead?: boolean;
  category?: string | null;
  isFiltered?: boolean;
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
  personalLabels?: string[];
  isStarred?: boolean;
  isRead?: boolean;
  followUpAt?: number | null;
  notes?: string;
  collaborators?: string[];
  isFiltered?: boolean;
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
    const labels = initial?.personalLabels ? [...initial.personalLabels] : (initial?.labels ? [...initial.labels] : []);
    d.personalLabels = [...labels];
    d.labels = [...labels];
    d.followUpAt = initial?.followUpAt ?? null;
    d.privateNotes = initial?.privateNotes ?? "";
    d.isStarred = initial?.isStarred ?? false;
    d.isRead = initial?.isRead ?? false;
    d.category = initial?.category ?? null;
    d.isFiltered = initial?.isFiltered ?? false;
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
    if (changes.personalLabels !== undefined || changes.labels !== undefined) {
      const labels = changes.personalLabels ? [...changes.personalLabels] : (changes.labels ? [...changes.labels] : []);
      d.personalLabels = [...labels];
      d.labels = [...labels];
    }
    if (changes.followUpAt !== undefined) d.followUpAt = changes.followUpAt;
    if (changes.privateNotes !== undefined) d.privateNotes = changes.privateNotes;
    if (changes.isStarred !== undefined) d.isStarred = changes.isStarred;
    if (changes.isRead !== undefined) d.isRead = changes.isRead;
    if (changes.category !== undefined) d.category = changes.category;
    if (changes.isFiltered !== undefined) d.isFiltered = changes.isFiltered;
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

  let isFiltered = initial?.isFiltered;
  if (isFiltered === undefined) {
    try {
      const db = await getDb();
      const rows = await db.select<{ is_filtered: number }[]>(
        "SELECT is_filtered FROM threads WHERE account_id = $1 AND id = $2 LIMIT 1",
        [accountId, threadId],
      );
      if (rows.length > 0 && rows[0]?.is_filtered !== undefined && rows[0]?.is_filtered !== null) {
        isFiltered = rows[0].is_filtered === 1;
      }
    } catch {
      // Ignored in environments without active DB
    }
  }

  const newDoc = createPersonalMetadataDoc({
    conversationId: threadId,
    ...initial,
    ...(isFiltered !== undefined ? { isFiltered } : {}),
  });
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
    try {
      await setThreadCategory(accountId, threadId, doc.category, true);
    } catch (e) {
      console.warn(`[metadataCrdt] Could not update category for ${threadId}:`, e);
    }
  }
  if (doc.followUpAt) {
    try {
      await insertFollowUpReminder(accountId, threadId, threadId, doc.followUpAt);
    } catch (e) {
      console.warn(`[metadataCrdt] Could not insert follow-up reminder for ${threadId}:`, e);
    }
  } else if (doc.followUpAt === null) {
    try {
      await cancelFollowUpForThread(accountId, threadId);
    } catch {
      // Ignored if cancelFollowUp is not available or DB is unavailable
    }
  }
  const labelsToReconcile =
    doc.personalLabels && doc.personalLabels.length > 0
      ? doc.personalLabels
      : doc.labels && doc.labels.length > 0
      ? doc.labels
      : undefined;
  if (labelsToReconcile !== undefined) {
    try {
      await setThreadLabels(accountId, threadId, labelsToReconcile);
    } catch (e) {
      console.warn(`[metadataCrdt] Could not update thread labels for ${threadId}:`, e);
    }
  }
  if (doc.isFiltered !== undefined) {
    try {
      const db = await getDb();
      await db.execute(
        "UPDATE threads SET is_filtered = $1 WHERE account_id = $2 AND id = $3",
        [doc.isFiltered ? 1 : 0, accountId, threadId],
      );
    } catch {
      // Ignored in environments without active DB
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
    const labels = initial?.labels ? [...initial.labels] : (initial?.personalLabels ? [...initial.personalLabels] : []);
    d.labels = [...labels];
    d.personalLabels = [...labels];
    d.isStarred = initial?.isStarred ?? false;
    d.isRead = initial?.isRead ?? false;
    d.followUpAt = initial?.followUpAt ?? null;
    d.notes = initial?.notes ?? "";
    d.collaborators = initial?.collaborators ? [...initial.collaborators] : [];
    d.isFiltered = initial?.isFiltered ?? false;
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
    if (changes.labels !== undefined || changes.personalLabels !== undefined) {
      const labels = changes.labels ? [...changes.labels] : (changes.personalLabels ? [...changes.personalLabels] : []);
      d.labels = [...labels];
      d.personalLabels = [...labels];
    }
    if (changes.isStarred !== undefined) d.isStarred = changes.isStarred;
    if (changes.isRead !== undefined) d.isRead = changes.isRead;
    if (changes.followUpAt !== undefined) d.followUpAt = changes.followUpAt;
    if (changes.notes !== undefined) d.notes = changes.notes;
    if (changes.isFiltered !== undefined) d.isFiltered = changes.isFiltered;
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

// ============================================================================
// Client-side Filtering Helpers
// ============================================================================

/**
 * Check whether an email/thread has already been filtered using its metadata.
 */
export async function isEmailFiltered(
  accountId: string,
  threadId: string,
): Promise<boolean> {
  const record = await getThreadCrdtDoc(accountId, threadId, "personal");
  if (record && record.doc_base64) {
    try {
      const doc = deserializeMetadataDoc<PersonalMetadataState>(record.doc_base64);
      if (doc.isFiltered !== undefined) return Boolean(doc.isFiltered);
    } catch {
      // Fall through to DB check
    }
  }
  try {
    const db = await getDb();
    const rows = await db.select<{ is_filtered: number }[]>(
      "SELECT is_filtered FROM threads WHERE account_id = $1 AND id = $2 LIMIT 1",
      [accountId, threadId],
    );
    if (rows.length > 0 && rows[0]?.is_filtered !== undefined && rows[0]?.is_filtered !== null) {
      return rows[0].is_filtered === 1;
    }
  } catch {
    // If column doesn't exist or query fails
  }
  return false;
}

/**
 * Mark an email/thread as filtered or not in its personal metadata doc and database.
 */
export async function markEmailFiltered(
  accountId: string,
  threadId: string,
  isFiltered = true,
  options?: { skipAudit?: boolean; timestamp?: number },
): Promise<void> {
  const doc = await getOrInitPersonalMetadataDoc(accountId, threadId, {
    conversationId: threadId,
    isFiltered,
  });
  const previous = doc.isFiltered ?? true;
  const updated = updatePersonalMetadataDoc(doc, { isFiltered });
  await savePersonalMetadataDoc(accountId, threadId, updated);
  try {
    const db = await getDb();
    await db.execute(
      "UPDATE threads SET is_filtered = $1 WHERE account_id = $2 AND id = $3",
      [isFiltered ? 1 : 0, accountId, threadId],
    );
  } catch {
    // Ignored in environments without active DB
  }

  if (!options?.skipAudit && previous !== isFiltered) {
    await recordMetadataChange({
      accountId,
      conversationId: threadId,
      action: "set_filtered",
      field: "isFiltered",
      oldValue: previous,
      newValue: isFiltered,
      changeSummary: `Marked filtered: ${isFiltered}`,
      timestamp: options?.timestamp,
    }).catch((e) => console.warn("[metadataCrdt] Failed to record metadata history:", e));
  }
}

/**
 * Retrieve personal metadata state for an email/thread if available.
 */
export async function getPersonalMetadata(
  accountId: string,
  threadId: string,
): Promise<PersonalMetadataState | null> {
  const record = await getThreadCrdtDoc(accountId, threadId, "personal");
  if (!record || !record.doc_base64) return null;
  try {
    return deserializeMetadataDoc<PersonalMetadataState>(record.doc_base64);
  } catch {
    return null;
  }
}

/**
 * Retrieve composite conversation metadata state if available.
 */
export async function getConversationMetadata(
  accountId: string,
  threadId: string,
): Promise<ConversationMetadataState | null> {
  const record = await getThreadCrdtDoc(accountId, threadId, "personal");
  if (!record || !record.doc_base64) return null;
  try {
    return deserializeMetadataDoc<ConversationMetadataState>(record.doc_base64);
  } catch {
    return null;
  }
}

/**
 * Put conversation labels into conversation metadata (Automerge CRDT doc)
 * and reconcile them to the database. Logs the change to metadata history and ledger.
 */
export async function setConversationMetadataLabels(
  accountId: string,
  conversationId: string,
  labels: string[],
  options?: { skipAudit?: boolean; timestamp?: number },
): Promise<void> {
  const doc = await getOrInitPersonalMetadataDoc(accountId, conversationId, {
    conversationId,
    personalLabels: labels,
    labels,
  });
  const previousLabels = doc.personalLabels ? [...doc.personalLabels] : (doc.labels ? [...doc.labels] : []);
  const updated = updatePersonalMetadataDoc(doc, {
    personalLabels: labels,
    labels,
  });
  await savePersonalMetadataDoc(accountId, conversationId, updated);
  await reconcilePersonalMetadataToDb(accountId, conversationId, updated);

  if (!options?.skipAudit) {
    const isDifferent =
      previousLabels.length !== labels.length ||
      previousLabels.some((l, idx) => l !== labels[idx]);
    if (isDifferent) {
      await recordMetadataChange({
        accountId,
        conversationId,
        action: "set_labels",
        field: "labels",
        oldValue: previousLabels,
        newValue: labels,
        changeSummary: `Set conversation labels: [${labels.join(", ")}]`,
        timestamp: options?.timestamp,
      }).catch((e) => console.warn("[metadataCrdt] Failed to record metadata history:", e));
    }
  }
}

/**
 * Set conversation category in personal metadata, reconciles to DB,
 * and logs to auditable history and ledger.
 */
export async function setConversationMetadataCategory(
  accountId: string,
  conversationId: string,
  category: string | null,
  options?: { skipAudit?: boolean; timestamp?: number },
): Promise<void> {
  const doc = await getOrInitPersonalMetadataDoc(accountId, conversationId, {
    conversationId,
    category,
  });
  const previous = doc.category ?? null;
  const updated = updatePersonalMetadataDoc(doc, { category });
  await savePersonalMetadataDoc(accountId, conversationId, updated);
  if (category) {
    await setThreadCategory(accountId, conversationId, category, true).catch(() => {});
  }
  if (!options?.skipAudit && previous !== category) {
    await recordMetadataChange({
      accountId,
      conversationId,
      action: "set_category",
      field: "category",
      oldValue: previous,
      newValue: category,
      changeSummary: category ? `Set category to ${category}` : "Cleared category",
      timestamp: options?.timestamp,
    }).catch((e) => console.warn("[metadataCrdt] Failed to record metadata history:", e));
  }
}

/**
 * Set follow-up reminder in personal metadata, reconciles to DB,
 * and logs to auditable history and ledger.
 */
export async function setConversationMetadataFollowUp(
  accountId: string,
  conversationId: string,
  followUpAt: number | null,
  options?: { skipAudit?: boolean; timestamp?: number },
): Promise<void> {
  const doc = await getOrInitPersonalMetadataDoc(accountId, conversationId, {
    conversationId,
    followUpAt,
  });
  const previous = doc.followUpAt ?? null;
  const updated = updatePersonalMetadataDoc(doc, { followUpAt });
  await savePersonalMetadataDoc(accountId, conversationId, updated);
  if (followUpAt) {
    await insertFollowUpReminder(accountId, conversationId, conversationId, followUpAt).catch(() => {});
  } else {
    await cancelFollowUpForThread(accountId, conversationId).catch(() => {});
  }
  if (!options?.skipAudit && previous !== followUpAt) {
    await recordMetadataChange({
      accountId,
      conversationId,
      action: "set_followup",
      field: "followUpAt",
      oldValue: previous,
      newValue: followUpAt,
      changeSummary: followUpAt ? `Set follow up reminder for ${new Date(followUpAt).toISOString()}` : "Cleared follow up reminder",
      timestamp: options?.timestamp,
    }).catch((e) => console.warn("[metadataCrdt] Failed to record metadata history:", e));
  }
}

/**
 * Retrieve conversation labels from conversation metadata.
 */
export async function getConversationMetadataLabels(
  accountId: string,
  conversationId: string,
): Promise<string[]> {
  const meta = await getPersonalMetadata(accountId, conversationId);
  return meta?.personalLabels ?? meta?.labels ?? [];
}

