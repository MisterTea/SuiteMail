import { useComposerStore } from "@/stores/composerStore";
import type { Thread } from "@/stores/threadStore";
import { peelDraftContract } from "../contracts/contractMessage";
import { getMessagesForThread } from "../db/messages";
import { getGmailClient } from "../gmail/tokenManager";

const addresses = (raw: string | null) => (raw ?? "").split(",").map((address) => address.trim()).filter(Boolean);

export async function openThreadDraft(thread: Thread): Promise<void> {
  try {
    const messages = await getMessagesForThread(thread.accountId, thread.id);
    const draft = messages[messages.length - 1];
    if (!draft) return;

    let draftId: string | null = null;
    try {
      const client = await getGmailClient(thread.accountId);
      const drafts = await client.listDrafts();
      draftId = drafts.find((item) => item.message.id === draft.id)?.id ?? null;
    } catch {
      // Without a provider draft ID, auto-save creates a draft.
    }

    const contract = peelDraftContract(draft.body_html ?? draft.body_text ?? "");
    const composer = useComposerStore.getState();
    composer.openComposer({
      accountId: thread.accountId,
      mode: "new",
      to: addresses(draft.to_addresses),
      cc: addresses(draft.cc_addresses),
      bcc: addresses(draft.bcc_addresses),
      subject: draft.subject ?? "",
      bodyHtml: contract.html,
      threadId: thread.id,
      draftId,
      contractActive: contract.contractText != null,
      contractText: contract.contractText ?? "",
    });
    composer.setLastSavedAt(draft.date ? draft.date * 1000 : Date.now());
  } catch (error) {
    console.error("Couldn’t open draft", error);
  }
}
