import { App } from "@capacitor/app";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { base64Encode } from "@/utils/crypto";
import type { PlatformBridge } from "./index";
import { installMobileViewport } from "./mobileViewport";

interface IOSBridge {
  invoke(options: { command: string; args: Record<string, unknown> }): Promise<{ value: unknown }>;
  openUrl(options: { url: string }): Promise<void>;
  attachment(options: { filename: string; data: string; preview: boolean }): Promise<void>;
  authorizeGoogle(options: { email?: string }): Promise<{ email: string }>;
  googleToken(options: { email: string; invalidToken?: string; remove?: boolean }): Promise<{ accessToken: string; expiresAt: number }>;
  googleRequest(options: { account: string; url: string; method?: string; headers: Record<string, string>; body?: string }): Promise<{ status: number; headers: Record<string, string>; body: string }>;
  backgroundMail(options: { action: "discard"; account: string }): Promise<void>;
  backgroundMail(options: { action: "sendScheduled" }): Promise<{ sent: number; failed: number }>;
}

export const iosNative = registerPlugin<IOSBridge>("SuiteMailIOS");
export const isIOS = () => Capacitor.getPlatform() === "ios";

export function iosBytes(data: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(data);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  return bytes;
}

if (isIOS()) {
  document.documentElement.classList.add("ios-app", "native-phone");
  installMobileViewport();

  const localOnly = new Set([
    "close_splashscreen", "set_tray_tooltip", "set_tray_icon", "set_badge_count",
    "check_for_updates", "install_update", "open_devtools",
  ]);
  const invoke = async <T>(command: string, args: Record<string, unknown> = {}): Promise<T> => {
    if (localOnly.has(command)) return undefined as T;
    if (command === "get_app_version") return (await App.getInfo()).version as T;
    if (command === "get_startup_telemetry") return false as T;
    // The web contract uses camelCase for IMAP operation arguments. Rust expects snake_case.
    const nativeArgs = command.startsWith("imap_") || command.startsWith("smtp_")
      ? Object.fromEntries(Object.entries(args).map(([key, value]) =>
          [key.replace(/[A-Z]/g, (letter) => "_" + letter.toLowerCase()), value]))
      : args;
    return (await iosNative.invoke({ command, args: nativeArgs })).value as T;
  };

  const file = (path: string) => {
    if (!path || path.startsWith("/") || path.split("/").includes("..")) throw new Error("Invalid private file path");
    return { path, directory: Directory.LibraryNoCloud };
  };

  const bridge: PlatformBridge = {
    invoke,
    db: {
      select: <T>(query: string, params: unknown[] = []) => invoke<T>("db_select", { query, params }),
      execute: (query, params = []) => invoke("db_execute", { query, params }),
    },
    openUrl: (url) => iosNative.openUrl({ url }),
    presentFile: (filename, bytes, preview) => iosNative.attachment({ filename, data: base64Encode(bytes), preview }),
    fs: {
      mkdir: async (path, options) => { await Filesystem.mkdir({ ...file(path), recursive: options?.recursive }); },
      exists: async (path) => { try { await Filesystem.stat(file(path)); return true; } catch { return false; } },
      writeTextFile: async (path, data) => { await Filesystem.writeFile({ ...file(path), data, encoding: Encoding.UTF8, recursive: true }); },
      readTextFile: async (path) => String((await Filesystem.readFile({ ...file(path), encoding: Encoding.UTF8 })).data),
      writeFile: async (path, data) => {
        await Filesystem.writeFile({ ...file(path), data: typeof data === "string" ? data : base64Encode(data),
          encoding: typeof data === "string" ? Encoding.UTF8 : undefined, recursive: true });
      },
      readFile: async (path) => {
        const { data } = await Filesystem.readFile(file(path));
        return typeof data === "string" ? iosBytes(data) : new Uint8Array(await data.arrayBuffer());
      },
      remove: async (path, options) => {
        if (options?.recursive) await Filesystem.rmdir({ ...file(path), recursive: true });
        else await Filesystem.deleteFile(file(path));
      },
    },
  };
  window.supermail = bridge;
}
