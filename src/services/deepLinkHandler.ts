import { isTauri } from "@/platform";
import { parseMailtoUrl } from "../utils/mailtoParser";
import { useComposerStore } from "../stores/composerStore";
import { escapeHtml } from "../utils/sanitize";

async function handleUrl(url: string): Promise<void> {
  if (!url.startsWith("mailto:")) return;

  const fields = parseMailtoUrl(url);

  // Show and focus the main window if in Tauri
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

  // Open composer with parsed fields
  useComposerStore.getState().openComposer({
    mode: "new",
    to: fields.to,
    cc: fields.cc,
    bcc: fields.bcc,
    subject: fields.subject,
    bodyHtml: fields.body ? `<p>${escapeHtml(fields.body)}</p>` : "",
  });
}

export async function initDeepLinkHandler(): Promise<() => void> {
  const cleanups: Array<() => void> = [];

  if (!isTauri()) {
    const onMailto = (event: Event) => {
      const customEvent = event as CustomEvent<{ url: string }>;
      if (customEvent.detail?.url) {
        handleUrl(customEvent.detail.url);
      }
    };
    window.addEventListener("supermail:open-url", onMailto);
    return () => window.removeEventListener("supermail:open-url", onMailto);
  }

  // Listen for URLs when app is already running in Tauri
  try {
    const { onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
    const unlistenOpenUrl = await onOpenUrl((urls) => {
      for (const url of urls) {
        handleUrl(url);
      }
    });
    cleanups.push(unlistenOpenUrl);
  } catch (err) {
    console.error("Failed to register deep link handler:", err);
  }

  try {
    const { listen } = await import("@tauri-apps/api/event");
    const unlistenArgs = await listen<string[]>("single-instance-args", (event) => {
      for (const arg of event.payload) {
        if (arg.startsWith("mailto:")) {
          handleUrl(arg);
        }
      }
    });
    cleanups.push(unlistenArgs);
  } catch (err) {
    console.error("Failed to listen for single-instance args:", err);
  }

  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}
