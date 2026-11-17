import { isTauri } from "@/platform";
import { getSetting, setSetting } from "./db/settings";
import { useComposerStore } from "../stores/composerStore";

const DEFAULT_SHORTCUT = "CmdOrCtrl+Shift+M";
let currentShortcut: string | null = null;

async function handleComposeShortcut(): Promise<void> {
  if (isTauri()) {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const mainWindow = await WebviewWindow.getByLabel("main");
      if (mainWindow) {
        await mainWindow.show();
        await mainWindow.setFocus();
      }
    } catch {}
  }
  useComposerStore.getState().openComposer();
}

export async function initGlobalShortcut(): Promise<void> {
  if (!isTauri()) return;
  const saved = await getSetting("global_compose_shortcut");
  const shortcut = saved ?? DEFAULT_SHORTCUT;

  try {
    const { register, isRegistered } = await import("@tauri-apps/plugin-global-shortcut");
    const alreadyRegistered = await isRegistered(shortcut);
    if (!alreadyRegistered) {
      await register(shortcut, handleComposeShortcut);
    }
    currentShortcut = shortcut;
  } catch (err) {
    console.error("Failed to register global shortcut:", err);
  }
}

export async function registerComposeShortcut(shortcut: string): Promise<void> {
  if (!isTauri()) return;
  if (currentShortcut) {
    try {
      const { unregister } = await import("@tauri-apps/plugin-global-shortcut");
      await unregister(currentShortcut);
    } catch {}
  }

  const { register } = await import("@tauri-apps/plugin-global-shortcut");
  await register(shortcut, handleComposeShortcut);
  currentShortcut = shortcut;
  await setSetting("global_compose_shortcut", shortcut);
}

export async function unregisterComposeShortcut(): Promise<void> {
  if (!isTauri()) return;
  if (currentShortcut) {
    try {
      const { unregister } = await import("@tauri-apps/plugin-global-shortcut");
      await unregister(currentShortcut);
    } catch {}
    currentShortcut = null;
  }
}

export function getCurrentShortcut(): string | null {
  return currentShortcut;
}

export { DEFAULT_SHORTCUT };
