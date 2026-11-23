import { useAndroidMobile } from "@/hooks/useAndroidMobile";
import { Capacitor } from "@capacitor/core";
import { useRef, useCallback, useLayoutEffect, useMemo, useState, useEffect } from "react";
import { ImageOff } from "lucide-react";
import { platformOpenUrl as openUrl } from "@/platform";
import { stripRemoteImages, hasBlockedImages } from "@/utils/imageBlocker";
import { auditTrackingPixels, type DetectedTracker } from "@/utils/trackingPixels";
import { addToAllowlist } from "@/services/db/imageAllowlist";
import { escapeHtml, sanitizeHtml } from "@/utils/sanitize";
import { applyEmailDarkMode, emailDisablesDarkMode } from "@/utils/emailDarkMode";
import { useUIStore } from "@/stores/uiStore";
import type { DbAttachment } from "@/services/db/attachments";

interface EmailRendererProps {
  html: string | null;
  text: string | null;
  blockImages?: boolean;
  senderAddress?: string | null;
  accountId?: string | null;
  senderAllowlisted?: boolean;
  messageId?: string | null;
  inlineAttachments?: DbAttachment[];
  onTrackersDetected?: (trackers: DetectedTracker[]) => void;
}

export function EmailRenderer({
  html,
  text,
  blockImages = false,
  senderAddress,
  accountId,
  senderAllowlisted = false,
  messageId,
  inlineAttachments,
  onTrackersDetected,
}: EmailRendererProps) {
  const androidMobile = useAndroidMobile();
  const android = Capacitor.getPlatform() === "android";
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const rafRef = useRef<number>(0);
  const [overrideShow, setOverrideShow] = useState(false);
  const [cidMap, setCidMap] = useState<Map<string, string>>(new Map());

  const theme = useUIStore((s) => s.theme);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const isDark = theme === "dark"
    || (theme === "system" && systemDark);
  const disableDarkMode = useMemo(() => html ? emailDisablesDarkMode(html) : false, [html]);

  const shouldBlock = blockImages && !senderAllowlisted && !overrideShow;

  // Resolve cid: references by fetching inline attachment data
  useEffect(() => {
    if (!accountId || !messageId || !inlineAttachments?.length) return;

    const cidAttachments = inlineAttachments.filter(
      (a) => a.content_id && a.gmail_attachment_id,
    );
    if (cidAttachments.length === 0) return;

    let cancelled = false;

    (async () => {
      try {
        const { getEmailProvider } = await import("@/services/email/providerFactory");
        const provider = await getEmailProvider(accountId);
        const resolved = new Map<string, string>();

        await Promise.all(
          cidAttachments.map(async (att) => {
            try {
              const response = await provider.fetchAttachment(
                messageId,
                att.gmail_attachment_id!,
              );
              const base64 = response.data.replace(/-/g, "+").replace(/_/g, "/");
              resolved.set(att.content_id!, `data:${att.mime_type ?? "image/png"};base64,${base64}`);
            } catch {
              // Skip individual failures
            }
          }),
        );

        if (!cancelled && resolved.size > 0) {
          setCidMap(resolved);
        }
      } catch {
        // Non-critical — images just won't render
      }
    })();

    return () => { cancelled = true; };
  }, [accountId, messageId, inlineAttachments]);

  // Sanitize once — reused by both content and blocked-image check
  const sanitizedBody = useMemo(() => {
    if (!html) return null;
    const sanitized = sanitizeHtml(html);
    const audit = auditTrackingPixels(sanitized);
    if (audit.hasTrackers && onTrackersDetected) {
      onTrackersDetected(audit.trackers);
    }
    return audit.sanitizedHtml;
  }, [html, onTrackersDetected]);

  const isPlainText = !sanitizedBody;

  const bodyHtml = useMemo(() => {
    let body = sanitizedBody
      ?? `<pre style="white-space: pre-wrap; font-family: inherit;">${escapeHtml(text ?? "")}</pre>`;

    if (shouldBlock && sanitizedBody) {
      body = stripRemoteImages(body);
    }

    // Replace cid: references with resolved data URIs
    if (cidMap.size > 0) {
      body = body.replace(
        /\bcid:([^"'\s)]+)/gi,
        (match, cidRef: string) => cidMap.get(cidRef) ?? match,
      );
    }

    return body;
  }, [sanitizedBody, text, shouldBlock, cidMap]);

  const blocked = useMemo(() => {
    if (!shouldBlock || !sanitizedBody) return false;
    return hasBlockedImages(stripRemoteImages(sanitizedBody));
  }, [shouldBlock, sanitizedBody]);

  // Write content directly into iframe document — synchronous, no srcDoc async parsing
  useLayoutEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    observerRef.current?.disconnect();

    const doc = iframe.contentDocument;
    if (!doc) return;

    doc.open();
    // Start HTML from sender colors, then selectively darken before the first paint.
    const plainTextDark = isDark && isPlainText;
    doc.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes">
  <meta name="color-scheme" content="light only">
  <style>
    *, *::before, *::after {
      box-sizing: border-box;
    }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      -webkit-text-size-adjust: 100%;
      -moz-text-size-adjust: 100%;
      text-size-adjust: 100%;
    }
    ${android ? `
    html { overflow-x: auto; overflow-y: hidden; }
    * { scrollbar-width: none !important; }
    ::-webkit-scrollbar { display: none; }
    body { display: flow-root; }
    ` : ""}
    body {
      padding: ${android ? "0" : isPlainText ? "8px 2px 14px 2px" : "12px 10px"};
      font-family: -apple-system, BlinkMacSystemFont, "Roboto", "Segoe UI", system-ui, sans-serif;
      font-size: ${androidMobile ? 16 : 15}px;
      line-height: 1.65;
      color: ${plainTextDark ? "#e8eaed" : "#202124"};
      background: ${isPlainText ? "transparent" : "#ffffff"};
      word-wrap: break-word;
      overflow-wrap: break-word;
      overflow-x: ${android ? "visible" : "auto"};
      touch-action: ${android ? "pan-x pan-y pinch-zoom" : "pan-y pinch-zoom"};
    }
    @media (min-width: 640px) {
      body {
        padding: ${android ? "0" : isPlainText ? "8px 2px 14px 2px" : "16px"};
        font-size: ${androidMobile ? 16 : 14}px;
        line-height: 1.6;
      }
    }
    img {
      max-width: 100% !important;
      height: auto !important;
      object-fit: contain;
    }
    table {
      max-width: 100% !important;
      border-collapse: collapse;
    }
    a {
      color: ${plainTextDark ? "#81c995" : "#188038"};
      text-decoration-thickness: 1px;
      text-underline-offset: 2px;
      touch-action: manipulation;
    }
    a:hover {
      text-decoration: underline;
    }
    blockquote {
      border-left: 3px solid ${plainTextDark ? "#3c4043" : "#dadce0"};
      margin: 8px 0;
      padding: 4px 12px;
      color: ${plainTextDark ? "#9aa0a6" : "#5f6368"};
    }
    pre {
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: ui-monospace, SFMono-Regular, "Roboto Mono", Menlo, Consolas, monospace;
      font-size: 13px;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, "Roboto Mono", Menlo, Consolas, monospace;
      font-size: 13px;
    }
  </style>
</head>
<body>${bodyHtml}</body>
</html>`);
    doc.close();
    if (isDark && !isPlainText && !disableDarkMode) {
      applyEmailDarkMode(doc);
    }

    // Calculate and set height synchronously before paint
    const applyHeight = () => {
      if (!doc.body) return;
      // Size Android's frame to the body, including its children's margins.
      // The document's scrollHeight also includes the previous frame height.
      const h = android
        ? Math.max(doc.body.scrollHeight, doc.body.offsetHeight)
        : Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight, doc.body.offsetHeight);
      if (h > 0) {
        iframe.style.height = h + "px";
      }
    };
    applyHeight();

    // Watch for dynamic changes (images loading, etc.) — batched with rAF
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(applyHeight);
    });
    resizeObserver.observe(doc.body);
    observerRef.current = resizeObserver;

    // Open links in external browser via Electron opener
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const anchor = target.closest("a");
      if (anchor?.href) {
        e.preventDefault();
        openUrl(anchor.href).catch((err) => {
          console.error("Failed to open link:", err);
        });
      }
    };
    doc.addEventListener("click", handleClick);

    return () => {
      doc.removeEventListener("click", handleClick);
      observerRef.current?.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [bodyHtml, isDark, isPlainText, disableDarkMode, android, androidMobile]);

  const handleLoadImages = useCallback(() => {
    setOverrideShow(true);
  }, []);

  const handleAlwaysLoad = useCallback(async () => {
    if (accountId && senderAddress) {
      await addToAllowlist(accountId, senderAddress);
    }
    setOverrideShow(true);
  }, [accountId, senderAddress]);

  return (
    <div data-email-renderer className="min-w-0 max-w-full">
      {blocked && (
        <div className="flex items-center gap-2 flex-wrap px-3 py-2 mb-2 text-xs bg-bg-tertiary rounded-md border border-border-secondary">
          <ImageOff size={14} className="text-text-tertiary shrink-0" />
          <span className="text-text-secondary">
            Images hidden to protect your privacy.
          </span>
          <button
            onClick={handleLoadImages}
            className="text-accent hover:text-accent-hover font-semibold min-h-[40px] sm:min-h-[32px] px-2.5 py-1 rounded-md active:bg-accent/15 transition-all touch-manipulation"
          >
            Load images
          </button>
          {senderAddress && accountId && (
            <button
              onClick={handleAlwaysLoad}
              className="text-accent hover:text-accent-hover font-semibold min-h-[40px] sm:min-h-[32px] px-2.5 py-1 rounded-md active:bg-accent/15 transition-all touch-manipulation"
            >
              Always load from sender
            </button>
          )}
        </div>
      )}
      <iframe
        ref={iframeRef}
        sandbox="allow-same-origin"
        className={`block w-full max-w-full min-w-0 border-0 ${!android && isDark && !isPlainText ? "rounded-md" : ""}`}
        style={{ overflow: "hidden" }}
        title="Email content"
      />
    </div>
  );
}

