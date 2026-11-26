import { upsertLocalDraft, getLocalDraft, deleteLocalDraft } from "@/services/db/localDrafts";
import { useComposerStore, type ComposerState } from "@/stores/composerStore";

const PREFIX = "ios-draft-";

export function isIOSLocalDraft(id: string | null): boolean {
  return id?.startsWith(PREFIX) ?? false;
}

export async function saveIOSDraft(accountId: string, state: ComposerState): Promise<string> {
  const id = isIOSLocalDraft(state.draftId) ? state.draftId! : PREFIX + crypto.randomUUID();
  await upsertLocalDraft({
    id,
    account_id: accountId,
    to_addresses: JSON.stringify(state.to),
    cc_addresses: JSON.stringify(state.cc),
    bcc_addresses: JSON.stringify(state.bcc),
    subject: state.subject,
    body_html: state.bodyHtml,
    reply_to_message_id: state.inReplyToMessageId,
    thread_id: state.threadId,
    from_email: state.fromEmail,
    signature_id: state.signatureId,
    attachments: JSON.stringify({
      attachments: state.attachments.map(({ id, filename, mimeType, size, content }) => ({ id, filename, mimeType, size, content })),
      mode: state.mode,
      quotedHtml: state.quotedHtml,
      signatureHtml: state.signatureHtml,
      contractActive: state.contractActive,
      contractText: state.contractText,
    }),
  });
  return id;
}

export async function openIOSDraft(accountId: string, id: string): Promise<void> {
  const draft = await getLocalDraft(id);
  if (!draft || draft.account_id !== accountId || !isIOSLocalDraft(id)) throw new Error("Draft is unavailable");
  const extras = JSON.parse(draft.attachments ?? "{}");
  const composer = useComposerStore.getState();
  composer.openComposer({
    ...extras,
    accountId,
    draftId: id,
    threadId: draft.thread_id,
    inReplyToMessageId: draft.reply_to_message_id,
    to: JSON.parse(draft.to_addresses ?? "[]"),
    cc: JSON.parse(draft.cc_addresses ?? "[]"),
    bcc: JSON.parse(draft.bcc_addresses ?? "[]"),
    subject: draft.subject ?? "",
    bodyHtml: draft.body_html ?? "",
  });
  composer.setFromEmail(draft.from_email);
  composer.setSignatureId(draft.signature_id);
  composer.setSignatureHtml(extras.signatureHtml ?? "");
  composer.setLastSavedAt(draft.updated_at * 1000);
}

export async function removeIOSDraft(accountId: string, id: string): Promise<void> {
  const draft = await getLocalDraft(id);
  if (draft?.account_id === accountId) await deleteLocalDraft(id);
  window.dispatchEvent(new Event("draft-count-changed"));
}
