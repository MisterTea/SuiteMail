/**
 * Platform abstraction layer for SuperMail.
 * Connects renderer to the desktop shell (Electron via window.supermail) or web browser fallbacks.
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

export interface PlatformWindow {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  openThreadWindow?: (threadId: string, accountId: string) => Promise<void>;
}

export interface PlatformBridge {
  db?: SqlDatabase;
  invoke?: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  openUrl?: (url: string) => Promise<void>;
  fs?: PlatformFs;
  dialog?: PlatformDialog;
  window?: PlatformWindow;
  isElectron?: boolean;
  on?: (channel: string, callback: (...args: unknown[]) => void) => () => void;
}

declare global {
  interface Window {
    supermail?: PlatformBridge;
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
  return false;
}

export async function platformInvoke<T>(
  cmd: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (typeof window !== "undefined" && window.supermail?.invoke) {
    return window.supermail.invoke<T>(cmd, args);
  }

  // Graceful fallback for non-native environments
  if (cmd === "close_splashscreen" || cmd === "open_devtools" || cmd === "set_tray_tooltip") {
    return undefined as unknown as T;
  }

  throw new Error(`Command "${cmd}" is not supported in this runtime environment.`);
}

export async function platformMinimize(): Promise<void> {
  if (typeof window !== "undefined" && window.supermail?.window?.minimize) {
    return window.supermail.window.minimize();
  }
}

export async function platformToggleMaximize(): Promise<void> {
  if (typeof window !== "undefined" && window.supermail?.window?.toggleMaximize) {
    return window.supermail.window.toggleMaximize();
  }
}

export async function platformClose(): Promise<void> {
  if (typeof window !== "undefined" && window.supermail?.window?.close) {
    return window.supermail.window.close();
  }
}

export async function platformOpenThreadWindow(threadId: string, accountId: string): Promise<void> {
  if (typeof window !== "undefined" && window.supermail?.window?.openThreadWindow) {
    return window.supermail.window.openThreadWindow(threadId, accountId);
  }
}

// The webview's Request constructor rejects these as unsafe. The OpenAI client
// sets User-Agent, and Tauri's HTTP plugin builds a Request from the init.
const FORBIDDEN_REQUEST_HEADERS = new Set([
  "accept-charset",
  "accept-encoding",
  "access-control-request-headers",
  "access-control-request-method",
  "connection",
  "content-length",
  "cookie",
  "cookie2",
  "date",
  "dnt",
  "expect",
  "host",
  "keep-alive",
  "origin",
  "referer",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "user-agent",
  "via",
]);

export function stripForbiddenRequestHeaders(init?: RequestInit): RequestInit | undefined {
  if (!init?.headers) return init;
  const entries: [string, string][] = [];
  const add = (name: string, value: string) => {
    if (!FORBIDDEN_REQUEST_HEADERS.has(name.toLowerCase())) entries.push([name, value]);
  };
  const raw = init.headers;
  if (typeof Headers !== "undefined" && raw instanceof Headers) {
    raw.forEach((value, name) => add(name, value));
  } else if (Array.isArray(raw)) {
    for (const [name, value] of raw) add(String(name), String(value));
  } else {
    for (const [name, value] of Object.entries(raw)) {
      if (value != null) add(name, String(value));
    }
  }
  return { ...init, headers: entries };
}

export async function platformFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const safeInit = stripForbiddenRequestHeaders(init);
  return fetch(input, safeInit);
}

export async function platformOpenUrl(url: string): Promise<void> {
  if (typeof window !== "undefined" && window.supermail?.openUrl) {
    return window.supermail.openUrl(url);
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
