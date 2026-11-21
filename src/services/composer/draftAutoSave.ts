import { useComposerStore } from "@/stores/composerStore";
import { createDraft as createDraftAction, updateDraft as updateDraftAction } from "@/services/emailActions";
import { buildRawEmail } from "@/utils/emailBuilder";
import { useAccountStore } from "@/stores/accountStore";
import { embedDraftContract } from "@/services/contracts/contractMessage";

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;
let currentAccountId: string | null = null;

const DEBOUNCE_MS = 3000;
let pendingSave: Promise<void> = Promise.resolve();
let session = 0;

async function saveDraft(expectedSession: number): Promise<void> {
  if (expectedSession !== session) return;
  const state = useComposerStore.getState();
  // Capture the accountId at save time to avoid mismatch if user switches accounts during debounce
  const accountId = currentAccountId;
  if (!state.isOpen || !accountId) return;

  const accounts = useAccountStore.getState().accounts;
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return;

  // Don't save empty drafts
  if (!state.bodyHtml.replace(/<[^>]*>/g, "").trim() && !state.subject && state.to.length === 0 && state.cc.length === 0 && state.bcc.length === 0 && state.attachments.length === 0 && !state.contractText.trim()) return;

  state.setIsSaving(true);

  try {
    const raw = buildRawEmail({
      from: state.fromEmail ?? account.email,
      cc: state.cc.length ? state.cc : undefined,
      bcc: state.bcc.length ? state.bcc : undefined,
      inReplyTo: state.inReplyToMessageId ?? undefined,
      to: state.to.length > 0 ? state.to : [""],
      subject: state.subject,
      htmlBody: embedDraftContract(
        [state.bodyHtml, state.quotedHtml, state.signatureHtml].filter(Boolean).join("<br><br>"),
        state.contractActive ? state.contractText : "",
      ),
      threadId: state.threadId ?? undefined,
      attachments: state.attachments.length > 0
        ? state.attachments.map((a) => ({
            filename: a.filename,
            mimeType: a.mimeType,
            content: a.content,
          }))
        : undefined,
    });

    if (state.draftId) {
      const result = await updateDraftAction(accountId, state.draftId, raw, state.threadId ?? undefined);
      if (!result.success) throw new Error("Could not update draft");
    } else {
      const result = await createDraftAction(accountId, raw, state.threadId ?? undefined);
      if (!result.success) throw new Error("Could not create draft");
      if (expectedSession !== session) return;
      if (result.data && typeof result.data === "object" && "draftId" in result.data) {
        state.setDraftId((result.data as { draftId: string }).draftId);
      }
    }

    if (expectedSession !== session) return;
    const latest = useComposerStore.getState();
    if (latest.bodyHtml === state.bodyHtml && latest.subject === state.subject && latest.to === state.to && latest.cc === state.cc && latest.bcc === state.bcc && latest.attachments === state.attachments && latest.contractText === state.contractText && latest.contractActive === state.contractActive && latest.fromEmail === state.fromEmail && latest.quotedHtml === state.quotedHtml && latest.signatureHtml === state.signatureHtml) {
      state.setLastSavedAt(Date.now());
    }
    window.dispatchEvent(new CustomEvent("draft-count-changed"));
    window.dispatchEvent(new CustomEvent("suitemail-sync-done"));
  } catch (err) {
    console.error("Failed to auto-save draft:", err);
    if (expectedSession === session) window.dispatchEvent(new CustomEvent("composer-save-error"));
    throw err;
  } finally {
    if (expectedSession === session) state.setIsSaving(false);
  }
}

function scheduleSave(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void queueSave().catch(() => { /* UI receives composer-save-error. */ });
  }, DEBOUNCE_MS);
}

function queueSave(): Promise<void> {
  const expectedSession = session;
  // Serialize creates/updates so a quick close cannot race the first create.
  pendingSave = pendingSave.catch(() => {}).then(() => saveDraft(expectedSession));
  return pendingSave;
}

/** Persist the latest state before closing; failures leave the editor open. */
export async function flushAutoSave(): Promise<void> {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  await queueSave();
}

/** Cancel the debounce and let an already-started create finish before deletion. */
export async function waitForPendingAutoSave(): Promise<void> {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  await pendingSave.catch(() => {});
}

/**
 * Start watching composerStore changes and auto-saving drafts.
 */
export function startAutoSave(accountId: string): void {
  stopAutoSave();
  currentAccountId = accountId;

  // Subscribe to store changes — trigger debounced save on any field change
  unsubscribe = useComposerStore.subscribe(
    (state, prevState) => {
      if (!state.isOpen) return;
      // Only save when content-relevant fields change
      if (
        state.bodyHtml !== prevState.bodyHtml ||
        state.subject !== prevState.subject ||
        state.to !== prevState.to ||
        state.cc !== prevState.cc ||
        state.bcc !== prevState.bcc ||
        state.attachments !== prevState.attachments ||
        state.contractText !== prevState.contractText ||
        state.contractActive !== prevState.contractActive ||
        state.fromEmail !== prevState.fromEmail ||
        state.quotedHtml !== prevState.quotedHtml ||
        state.signatureHtml !== prevState.signatureHtml
      ) {
        state.setLastSavedAt(null);
        scheduleSave();
      }
    },
  );
}

/**
 * Stop auto-saving and clean up.
 */
export function stopAutoSave(): void {
  session++;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  currentAccountId = null;
}
