import { Capacitor, registerPlugin } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import type { PlatformBridge } from "./index";

interface NativeCore {
  invoke(options: { command: string; args: Record<string, unknown> }): Promise<{ value: unknown }>;
  openUrl(options: { url: string }): Promise<void>;
}

// The same platform contract as desktop; mail and SQLite execute locally in Rust.
if (Capacitor.getPlatform() === "android") {
  document.documentElement.classList.add("android-app");
  const native = registerPlugin<NativeCore>("SuiteMail");
  const invoke = async <T>(command: string, args: Record<string, unknown> = {}): Promise<T> => {
    if (["close_splashscreen", "set_tray_tooltip", "set_badge_count", "set_tray_icon"].includes(command)) return undefined as T;
    if (command === "get_app_version") return (await App.getInfo()).version as T;
    if (command === "check_for_updates") return null as T;
    return (await native.invoke({ command, args })).value as T;
  };
  // Paths are relative to the app's private files directory, never shared storage.
  const pathOptions = (path: string) => {
    if (path.startsWith("/") || path.split("/").includes("..")) throw new Error("Invalid private file path");
    return { path, directory: Directory.Data };
  };
  const bridge: PlatformBridge = {
    invoke,
    db: {
      select: <T>(query: string, params: unknown[] = []) => invoke<T>("db_select", { query, params }),
      execute: (query, params = []) => invoke("db_execute", { query, params }),
    },
    openUrl: (url) => native.openUrl({ url }),
    fs: {
      mkdir: async (path, options) => { await Filesystem.mkdir({ ...pathOptions(path), recursive: options?.recursive }); },
      exists: async (path) => { try { await Filesystem.stat(pathOptions(path)); return true; } catch { return false; } },
      writeTextFile: async (path, data) => { await Filesystem.writeFile({ ...pathOptions(path), data, encoding: Encoding.UTF8, recursive: true }); },
      readTextFile: async (path) => String((await Filesystem.readFile({ ...pathOptions(path), encoding: Encoding.UTF8 })).data),
      writeFile: async (path, data) => {
        if (typeof data === "string") {
          await Filesystem.writeFile({ ...pathOptions(path), data, encoding: Encoding.UTF8, recursive: true });
        } else {
          let binary = "";
          for (const byte of data) binary += String.fromCharCode(byte);
          await Filesystem.writeFile({ ...pathOptions(path), data: btoa(binary), recursive: true });
        }
      },
      readFile: async (path) => {
        const { data } = await Filesystem.readFile(pathOptions(path));
        if (typeof data !== "string") return new Uint8Array(await data.arrayBuffer());
        return Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
      },
      remove: async (path, options) => {
        if (options?.recursive) await Filesystem.rmdir({ ...pathOptions(path), recursive: true });
        else await Filesystem.deleteFile(pathOptions(path));
      },
    },
    on: () => () => {},
  };
  window.supermail = bridge;
  App.addListener("backButton", () => {
    const close = document.querySelector<HTMLButtonElement>('button[title="Back to list"]');
    if (close) close.click();
    else if (window.history.length > 1) window.history.back();
    else App.minimizeApp();
  });
}
