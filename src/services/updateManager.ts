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

async function performCheck(): Promise<void> {
  if (typeof window !== "undefined" && window.supermail?.invoke) {
    try {
      const update = await window.supermail.invoke<{ version: string; body: string | null } | null>("check_for_updates");
      if (update) {
        availableUpdate = {
          info: { version: update.version, body: update.body ?? null },
          raw: update,
        };
        callback?.(availableUpdate.info);
      }
    } catch {}
  }
}

const FOUR_HOURS = 4 * 60 * 60 * 1000;

export function startUpdateChecker(): void {
  if (checker) return;
  checker = createBackgroundChecker("update-checker", performCheck, FOUR_HOURS);
  checker.start();
}

export function stopUpdateChecker(): void {
  checker?.stop();
  checker = null;
}

export async function checkForUpdateNow(): Promise<UpdateInfo | null> {
  await performCheck();
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
  availableUpdate = null;
  callback = null;
}
