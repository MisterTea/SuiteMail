import {
  encryptSignedMetadataPayloadForRecipients,
  decryptMetadataPayload,
  getContactKey,
  type DecryptResult,
} from "../crypto/pgpService";
import {
  getOrInitSharedMetadataDoc,
  updateSharedMetadataDoc,
  saveSharedMetadataDoc,
  serializeMetadataDoc,
  deserializeMetadataDoc,
  mergeMetadataDocs,
  reconcileSharedMetadataToDb,
  type SharedMetadataState,
  type ConversationMetadataState,
} from "./metadataCrdt";
import { getThreadCrdtDoc } from "../db/threadCrdtDocs";

export const METADATA_REPLY_HEADER = "X-SuperMail-Metadata";
export const SHARED_METADATA_REPLY_TAG = "[SuperMail Shared Metadata Update]";
export const METADATA_REPLY_TAG = "[SuperMail Metadata Update]";

export interface MetadataReplyPayload {
  conversationId: string;
  threadId: string;
  scope: "shared";
  docBase64: string;
  timestamp: number;
}

export interface SendSharedMetadataReplyAllOptions {
  accountId: string;
  threadId: string;
  recipientEmails: string[];
  sharedUpdates: Partial<SharedMetadataState>;
  authorEmail?: string;
}

export interface SendMetadataReplyOptions {
  accountId: string;
  threadId: string;
  recipientEmail?: string;
  recipientEmails?: string[];
  updates: Partial<ConversationMetadataState>;
  authorEmail?: string;
}

export interface PreparedMetadataReply {
  body: string;
  headers: Record<string, string>;
  encryptedPayload: string;
  recipients: string[];
  unkeyedRecipients?: string[];
}

/**
 * Build an encrypted & signed PGP reply-all payload containing an Automerge CRDT
 * shared conversation metadata update formatted to be sent to all conversation participants.
 *
 * NOTE: Only shared metadata is included in this reply-all payload.
 * Personal metadata is kept in the .metadata shadow folder and is never sent out.
 */
export async function prepareSharedMetadataReplyAll(
  options: SendSharedMetadataReplyAllOptions,
): Promise<PreparedMetadataReply> {
  const { accountId, threadId, recipientEmails, sharedUpdates, authorEmail } = options;

  // 1. Get or initialize shared conversation CRDT document and apply updates
  const currentDoc = await getOrInitSharedMetadataDoc(accountId, threadId, {
    conversationId: threadId,
  });
  const updatedDoc = updateSharedMetadataDoc(
    currentDoc,
    { ...sharedUpdates, conversationId: threadId },
    authorEmail,
  );
  await saveSharedMetadataDoc(accountId, threadId, updatedDoc);

  // 2. Prepare payload
  const docBase64 = serializeMetadataDoc(updatedDoc);
  const payload: MetadataReplyPayload = {
    conversationId: threadId,
    threadId,
    scope: "shared",
    docBase64,
    timestamp: Date.now(),
  };

  // 3. Resolve recipient PGP public keys for reply-all
  const armoredKeys: string[] = [];
  const validRecipients: string[] = [];
  const unkeyedRecipients: string[] = [];

  for (const email of recipientEmails) {
    const keyRecord = await getContactKey(email);
    if (keyRecord && keyRecord.armored_public_key) {
      armoredKeys.push(keyRecord.armored_public_key);
      validRecipients.push(email);
    } else {
      unkeyedRecipients.push(email);
    }
  }

  if (armoredKeys.length === 0) {
    throw new Error(
      `Cannot encrypt shared metadata: No registered PGP public keys found for participants: ${recipientEmails.join(", ")}`,
    );
  }

  // 4. Encrypt for all keyed participants and sign with own private key
  const encryptedPayload = await encryptSignedMetadataPayloadForRecipients(
    JSON.stringify(payload),
    armoredKeys,
  );

  const body = `${SHARED_METADATA_REPLY_TAG}\r\n\r\n${encryptedPayload}\r\n`;
  const headers = {
    [METADATA_REPLY_HEADER]: "shared-crdt-v1",
    "X-SuperMail-Conversation-Id": threadId,
    "X-SuperMail-Metadata-Scope": "shared",
  };

  return {
    body,
    headers,
    encryptedPayload,
    recipients: validRecipients,
    unkeyedRecipients,
  };
}

/**
 * Backward-compatible wrapper supporting single-recipient or multi-recipient calls.
 */
export async function prepareMetadataReply(
  options: SendMetadataReplyOptions,
): Promise<PreparedMetadataReply> {
  const recipients = options.recipientEmails ?? (options.recipientEmail ? [options.recipientEmail] : []);
  if (recipients.length === 0) {
    throw new Error("No recipient provided for metadata reply");
  }

  const sharedUpdates: Partial<SharedMetadataState> = {
    sharedCategories: options.updates.categories,
    sharedLabels: options.updates.labels,
    sharedNotes: options.updates.notes,
  };

  return prepareSharedMetadataReplyAll({
    accountId: options.accountId,
    threadId: options.threadId,
    recipientEmails: recipients,
    sharedUpdates,
    authorEmail: options.authorEmail,
  });
}

export interface ProcessIncomingMetadataResult {
  processed: boolean;
  threadId?: string;
  scope?: "shared";
  mergedSharedState?: SharedMetadataState;
  mergedState?: any;
  senderWarning?: string;
  verified?: boolean;
}

/**
 * Check an incoming email reply for an encrypted SuperMail shared metadata update.
 * If present, decrypts it using the local PGP private key, verifies the sender's signature,
 * and merges the Automerge CRDT changes into the shared conversation metadata.
 */
export async function processIncomingSharedMetadataReply(
  accountId: string,
  fromEmail: string,
  bodyText: string,
  threadIdFallback?: string,
): Promise<ProcessIncomingMetadataResult> {
  if (
    !bodyText.includes(SHARED_METADATA_REPLY_TAG) &&
    !bodyText.includes(METADATA_REPLY_TAG) &&
    !bodyText.includes("-----BEGIN PGP MESSAGE-----")
  ) {
    return { processed: false };
  }

  // Extract PGP message block
  const pgpStart = bodyText.indexOf("-----BEGIN PGP MESSAGE-----");
  const pgpEnd = bodyText.indexOf("-----END PGP MESSAGE-----");
  if (pgpStart === -1 || pgpEnd === -1) {
    return { processed: false };
  }

  const armoredMessage = bodyText
    .slice(pgpStart, pgpEnd + "-----END PGP MESSAGE-----".length)
    .trim();

  // Decrypt payload and verify sender signature
  let decrypted: DecryptResult;
  try {
    decrypted = await decryptMetadataPayload(armoredMessage, fromEmail);
  } catch (err) {
    console.warn("[collaborativeMetadataReply] Decryption failed:", err);
    return { processed: false };
  }

  try {
    const payload: MetadataReplyPayload = JSON.parse(decrypted.text);
    const targetThreadId = payload.conversationId || payload.threadId || threadIdFallback;
    if (!targetThreadId || !payload.docBase64) {
      return { processed: false };
    }

    // Merge remote shared CRDT doc with local shared CRDT doc
    const remoteDoc = deserializeMetadataDoc<SharedMetadataState>(payload.docBase64);
    const existing = await getThreadCrdtDoc(accountId, targetThreadId, "shared");

    let mergedDoc: SharedMetadataState;
    if (existing && existing.doc_base64) {
      const localDoc = deserializeMetadataDoc<SharedMetadataState>(existing.doc_base64);
      mergedDoc = mergeMetadataDocs(localDoc, remoteDoc);
    } else {
      mergedDoc = remoteDoc;
    }

    // Save merged doc to thread_crdt_docs (scope = 'shared')
    await saveSharedMetadataDoc(accountId, targetThreadId, mergedDoc as any);
    await reconcileSharedMetadataToDb(accountId, targetThreadId, mergedDoc as any);

    return {
      processed: true,
      threadId: targetThreadId,
      scope: "shared",
      mergedSharedState: mergedDoc,
      mergedState: {
        ...mergedDoc,
        categories: mergedDoc.sharedCategories,
        labels: mergedDoc.sharedLabels,
        notes: mergedDoc.sharedNotes,
      },
      senderWarning: decrypted.warning,
      verified: decrypted.verified,
    };
  } catch (err) {
    console.warn("[collaborativeMetadataReply] Failed to parse or apply shared metadata payload:", err);
    return { processed: false };
  }
}

export const processIncomingMetadataReply = processIncomingSharedMetadataReply;
