/**
 * Platform abstraction layer for SuperMail.
 * Allows running across Tauri v2, Electron (SuiteLeaf desktop), and Web browser environments.
 */

export interface SqlDatabase {
  select<T = unknown>(query: string, bindValues?: unknown[]): Promise<T>;
  execute(
    query: string,
    bindValues?: unknown[],
  ): Promise<{ rowsAffected: number; lastInsertId: number }>;
}

export interface PlatformFs {
  mkdir(path: string, options?: { recursive?: boolean; baseDir?: number }): Promise<void>;
  writeFile(path: string, data: Uint8Array | string, options?: { baseDir?: number }): Promise<void>;
  readFile(path: string, options?: { baseDir?: number }): Promise<Uint8Array>;
  readTextFile(path: string, options?: { baseDir?: number }): Promise<string>;
  writeTextFile(path: string, text: string, options?: { baseDir?: number }): Promise<void>;
  remove(path: string, options?: { baseDir?: number; recursive?: boolean }): Promise<void>;
  exists(path: string, options?: { baseDir?: number }): Promise<boolean>;
}

export interface PlatformDialog {
  save(options?: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null>;
  open(options?: { defaultPath?: string; multiple?: boolean; directory?: boolean; filters?: { name: string; extensions: string[] }[] }): Promise<string | string[] | null>;
}

export interface PlatformBridge {
  db?: SqlDatabase;
  invoke?: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  openUrl?: (url: string) => Promise<void>;
  fs?: PlatformFs;
  dialog?: PlatformDialog;
  isElectron?: boolean;
}

declare global {
  interface Window {
    supermail?: PlatformBridge;
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isElectron(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.supermail?.isElectron ||
    (window as unknown as { suiteleaf?: unknown }).suiteleaf ||
    (window as unknown as { process?: { versions?: { electron?: string } } }).process?.versions?.electron,
  );
}

export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.__TAURI_INTERNALS__);
}

export async function platformInvoke<T>(
  cmd: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (typeof window !== "undefined" && window.supermail?.invoke) {
    return window.supermail.invoke<T>(cmd, args);
  }

  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }

  // Graceful fallback for non-native environments
  if (cmd === "close_splashscreen" || cmd === "open_devtools" || cmd === "set_tray_tooltip") {
    return undefined as unknown as T;
  }

  throw new Error(`Command "${cmd}" is not supported in this runtime environment.`);
}

export async function platformFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (isTauri()) {
    try {
      const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
      return tauriFetch(input, init);
    } catch {}
  }
  return fetch(input, init);
}

export async function platformOpenUrl(url: string): Promise<void> {
  if (typeof window !== "undefined" && window.supermail?.openUrl) {
    return window.supermail.openUrl(url);
  }

  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    return openUrl(url);
  }

  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export async function platformSaveFile(filename: string, bytes: Uint8Array): Promise<void> {
  if (typeof window !== "undefined" && window.supermail?.dialog?.save && window.supermail?.fs?.writeFile) {
    const filePath = await window.supermail.dialog.save({ defaultPath: filename });
    if (filePath) {
      await window.supermail.fs.writeFile(filePath, bytes);
      return;
    }
  }

  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const filePath = await save({ defaultPath: filename });
    if (filePath) {
      await writeFile(filePath, bytes);
      return;
    }
  }

  // Fallback to browser standard blob download
  if (typeof document !== "undefined") {
    const blob = new Blob([bytes as unknown as BlobPart]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
