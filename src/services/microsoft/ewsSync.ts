import { clearAccountHistoryId, getAccount, updateAccountSyncState } from "../db/accounts";
import { getLabelsForAccount, upsertLabel } from "../db/labels";
import { ensureFreshToken } from "../oauth/oauthTokenManager";
import { ewsListFolders, ewsSyncPage, isEwsSyncReset } from "./ewsCommands";
import { storeGraphPage } from "./graphSync";
import { mapGraphFolder, receivedAfterIso } from "./graphModel";
import { getSetting } from "../db/settings";

async function freshAccount(accountId: string): Promise<{ token: string; email: string }> {
  const account = await getAccount(accountId);
  if (!account) throw new Error("Account not found");
  return { token: await ensureFreshToken(account), email: account.email };
}

export async function syncEwsFolders(accountId: string): Promise<Map<string, string>> {
  const { token, email } = await freshAccount(accountId);
  const folders = await ewsListFolders(token, email);
  const folderLabelById = new Map<string, string>();
  for (const folder of folders) {
    const mapped = mapGraphFolder(folder);
    folderLabelById.set(folder.id, mapped.labelId);
    if (mapped.labelId === "UNREAD" || mapped.labelId === "STARRED") continue;
    await upsertLabel({
      id: mapped.labelId,
      accountId,
      name: mapped.name,
      type: mapped.type,
      imapFolderPath: folder.id,
      imapSpecialUse: mapped.specialUse,
    });
  }
  await upsertLabel({
    id: "FOCUSED",
    accountId,
    name: "Focused",
    type: "system",
    imapFolderPath: null,
    imapSpecialUse: null,
  });
  return folderLabelById;
}

function savedCheckpoint(historyId: string | null): string | null {
  if (!historyId || !historyId.startsWith("{")) return null;
  return historyId;
}

async function followPages(
  accountId: string,
  startCheckpoint: string | null,
  receivedAfter: string | null,
  onProgress?: (phase: string, current: number, total: number) => void,
): Promise<void> {
  let checkpoint = startCheckpoint;
  let count = 0;
  const folderLabelById = await syncEwsFolders(accountId);
  onProgress?.("messages", 0, 0);

  for (let pageNumber = 0; pageNumber < 500; pageNumber += 1) {
    const { token, email } = await freshAccount(accountId);
    const page = await ewsSyncPage(
      token,
      email,
      checkpoint,
      checkpoint ? null : receivedAfter,
      40,
    );
    count += await storeGraphPage(
      accountId,
      { messages: page.messages, removedIds: page.removedIds },
      folderLabelById,
    );
    onProgress?.("messages", count, 0);
    checkpoint = page.checkpoint;
    await updateAccountSyncState(accountId, checkpoint);
    window.dispatchEvent(new Event("suitemail-sync-progress"));
    if (page.caughtUp) break;
  }
}

export async function syncEwsAccount(
  accountId: string,
  onProgress?: (phase: string, current: number, total: number) => void,
  daysBack?: number,
): Promise<void> {
  const account = await getAccount(accountId);
  if (!account) throw new Error("Account not found");
  const syncPeriod = daysBack ?? (parseInt((await getSetting("sync_period_days")) ?? "365", 10) || 365);
  onProgress?.("folders", 0, 0);
  const receivedAfter = receivedAfterIso(syncPeriod);
  const run = (checkpoint: string | null) => followPages(
    accountId,
    checkpoint,
    checkpoint ? null : receivedAfter,
    onProgress,
  );

  try {
    await run(savedCheckpoint(account.history_id));
  } catch (err) {
    if (!isEwsSyncReset(err)) throw err;
    await clearAccountHistoryId(accountId);
    await run(null);
  }
  onProgress?.("done", 0, 0);
}

export async function ewsFolderIdForLabel(
  accountId: string,
  labelId: string,
): Promise<string | null> {
  const labels = await getLabelsForAccount(accountId);
  return labels.find((label) => label.id === labelId)?.imap_folder_path ?? null;
}
