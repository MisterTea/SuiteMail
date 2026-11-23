import { getSetting, setSetting } from "./db/settings";
import { useComposerStore } from "../stores/composerStore";
import { isElectron, platformInvoke } from "@/platform";

const DEFAULT_SHORTCUT = "CmdOrCtrl+Shift+M";
let currentShortcut: string | null = null;
let registrationError: string | null = null;
let unsubscribeCompose: (() => void) | undefined;

export async function handleComposeShortcut(): Promise<void> {
  useComposerStore.getState().openComposer();
}

export async function initGlobalShortcut(): Promise<void> {
  const saved = await getSetting("global_compose_shortcut");
  unsubscribeCompose?.();
  unsubscribeCompose = window.supermail?.on?.("supermail:compose", () => { void handleComposeShortcut(); });
  const shortcut = saved ?? DEFAULT_SHORTCUT;
  try {
    if (isElectron()) await platformInvoke("register_compose_shortcut", { shortcut });
    currentShortcut = shortcut;
    registrationError = null;
  } catch (error) {
    currentShortcut = null;
    registrationError = error instanceof Error ? error.message : String(error);
    console.warn("Global compose shortcut unavailable:", error);
  }
}

export async function registerComposeShortcut(shortcut: string): Promise<void> {
  const previous = currentShortcut;
  try {
    if (isElectron()) await platformInvoke("register_compose_shortcut", { shortcut });
    try {
      await setSetting("global_compose_shortcut", shortcut);
    } catch (error) {
      if (isElectron()) {
        if (previous) await platformInvoke("register_compose_shortcut", { shortcut: previous });
        else await platformInvoke("unregister_compose_shortcut");
      }
      throw error;
    }
    currentShortcut = shortcut;
    registrationError = null;
  } catch (error) {
    registrationError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

export async function unregisterComposeShortcut(): Promise<void> {
  currentShortcut = null;
  registrationError = null;
  unsubscribeCompose?.();
  unsubscribeCompose = undefined;
  if (isElectron()) await platformInvoke("unregister_compose_shortcut").catch(console.warn);
}

export function getCurrentShortcut(): string | null {
  return currentShortcut;
}

export function getComposeShortcutError(): string | null {
  return registrationError;
}

export { DEFAULT_SHORTCUT };
