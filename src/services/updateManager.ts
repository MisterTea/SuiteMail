import { createBackgroundChecker } from "./backgroundCheckers";
import type { BackgroundChecker } from "./backgroundCheckers";

interface UpdateInfo {
  version: string;
  body: string | null;
}

type UpdateCallback = (update: UpdateInfo) => void;

let checker: BackgroundChecker | null = null;
let availableUpdate: { info: UpdateInfo; raw: unknown } | null = null;
let callback: UpdateCallback | null = null;
let unsubscribeAvailable: (() => void) | null = null;

let pendingCheck: Promise<void> | null = null;
let startupCheckPending = true;

async function performCheck(manual: boolean, startup: boolean): Promise<void> {
  if (typeof window !== "undefined" && window.supermail?.invoke) {
    const update = await window.supermail.invoke<UpdateInfo | null>("check_for_updates", { manual, startup });
    if (update) {
      availableUpdate = {
        info: { version: update.version, body: update.body ?? null },
        raw: update,
      };
      callback?.(availableUpdate.info);
    } else availableUpdate = null;
  }
}

function check(manual: boolean, startup = false): Promise<void> {
  if (!pendingCheck) pendingCheck = performCheck(manual, startup).finally(() => { pendingCheck = null; });
  return pendingCheck;
}

export async function checkForUpdateAutomatically(): Promise<void> {
  // Resume events can arrive before the main app starts the checker.
  if (!checker) return;
  const startup = startupCheckPending;
  startupCheckPending = false;
  try { await check(false, startup); } catch (error) { console.warn("Update check failed:", error); }
}

const FOUR_HOURS = 4 * 60 * 60 * 1000;

export function startUpdateChecker(): void {
  if (checker) return;
  checker = createBackgroundChecker("update-checker", checkForUpdateAutomatically, FOUR_HOURS);
  checker.start();

  if (typeof window !== "undefined" && window.supermail?.on) {
    unsubscribeAvailable = window.supermail.on(
      "supermail:update-available",
      (...args: unknown[]) => {
        const update = args[0] as UpdateInfo | undefined;
        if (update?.version) {
          availableUpdate = {
            info: { version: update.version, body: update.body ?? null },
            raw: update,
          };
          callback?.(availableUpdate.info);
        }
      },
    );
  }
}

export function stopUpdateChecker(): void {
  checker?.stop();
  checker = null;
  unsubscribeAvailable?.();
  unsubscribeAvailable = null;
}

export async function checkForUpdateNow(): Promise<UpdateInfo | null> {
  await check(true);
  return availableUpdate?.info ?? null;
}

export async function installUpdate(): Promise<void> {
  if (!availableUpdate) throw new Error("No update available");
  if (typeof window !== "undefined" && window.supermail?.invoke) {
    await window.supermail.invoke("install_update");
  }
}

export function getAvailableUpdate(): UpdateInfo | null {
  return availableUpdate?.info ?? null;
}

export function setUpdateCallback(cb: UpdateCallback | null): void {
  callback = cb;
}

/** Reset module state for testing */
export function _resetForTesting(): void {
  checker?.stop();
  checker = null;
  unsubscribeAvailable?.();
  unsubscribeAvailable = null;
  availableUpdate = null;
  callback = null;
  startupCheckPending = true;
}
