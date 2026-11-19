import { getSetting, setSetting } from "./db/settings";
import { useComposerStore } from "../stores/composerStore";

const DEFAULT_SHORTCUT = "CmdOrCtrl+Shift+M";
let currentShortcut: string | null = null;

export async function handleComposeShortcut(): Promise<void> {
  useComposerStore.getState().openComposer();
}

export async function initGlobalShortcut(): Promise<void> {
  const saved = await getSetting("global_compose_shortcut");
  currentShortcut = saved ?? DEFAULT_SHORTCUT;
}

export async function registerComposeShortcut(shortcut: string): Promise<void> {
  currentShortcut = shortcut;
  await setSetting("global_compose_shortcut", shortcut);
}

export async function unregisterComposeShortcut(): Promise<void> {
  currentShortcut = null;
}

export function getCurrentShortcut(): string | null {
  return currentShortcut;
}

export { DEFAULT_SHORTCUT };
