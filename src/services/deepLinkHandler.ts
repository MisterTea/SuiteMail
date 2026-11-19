import { parseMailtoUrl } from "../utils/mailtoParser";
import { useComposerStore } from "../stores/composerStore";
import { escapeHtml } from "../utils/sanitize";

async function handleUrl(url: string): Promise<void> {
  if (!url || !url.startsWith("mailto:")) return;

  const fields = parseMailtoUrl(url);

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

  const onMailto = (event: Event) => {
    const customEvent = event as CustomEvent<{ url: string }>;
    if (customEvent.detail?.url) {
      handleUrl(customEvent.detail.url);
    }
  };
  window.addEventListener("supermail:open-url", onMailto);
  cleanups.push(() => window.removeEventListener("supermail:open-url", onMailto));

  if (typeof window !== "undefined" && window.supermail?.on) {
    const unlistenUrl = window.supermail.on("supermail:open-url", (url) => {
      if (typeof url === "string") handleUrl(url);
    });
    cleanups.push(unlistenUrl);

    const unlistenArgs = window.supermail.on("single-instance-args", (argv) => {
      if (Array.isArray(argv)) {
        for (const arg of argv) {
          if (typeof arg === "string" && arg.startsWith("mailto:")) {
            handleUrl(arg);
          }
        }
      }
    });
    cleanups.push(unlistenArgs);
  }

  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}
