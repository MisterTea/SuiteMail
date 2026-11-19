import { escapeHtml, sanitizeHtml } from "./sanitize";
import { stripContractMarkup } from "@/services/contracts/contractMessage";

export interface ForwardAttachment {
  filename?: string | null;
  size?: number | null;
  mimeType?: string | null;
}

export interface ForwardMessageData {
  from_name?: string | null;
  from_address?: string | null;
  date: string | number;
  subject?: string | null;
  to_addresses?: string | null;
  body_html?: string | null;
  body_text?: string | null;
  attachments?: ForwardAttachment[] | null;
}

function formatForwardDate(rawDate: string | number): string {
  let timestamp: number;
  if (typeof rawDate === "number") {
    // If timestamp is in seconds (< 10000000000), convert to milliseconds
    timestamp = rawDate < 10000000000 ? rawDate * 1000 : rawDate;
  } else {
    const num = Number(rawDate);
    if (!isNaN(num) && num > 0) {
      timestamp = num < 10000000000 ? num * 1000 : num;
    } else {
      const parsed = Date.parse(rawDate);
      if (!isNaN(parsed)) {
        timestamp = parsed;
      } else {
        return String(rawDate);
      }
    }
  }

  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return String(rawDate);

  return d.toLocaleString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatFileSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function buildForwardQuote(msg: ForwardMessageData): string {
  const dateStr = formatForwardDate(msg.date);

  const fromName = msg.from_name?.trim();
  const fromAddr = msg.from_address?.trim() ?? "";
  const fromDisplay = fromName
    ? `${escapeHtml(fromName)} &lt;${escapeHtml(fromAddr)}&gt;`
    : escapeHtml(fromAddr || "Unknown");
  const toDisplay = escapeHtml(msg.to_addresses ?? "");
  const subjectDisplay = escapeHtml(msg.subject ?? "(No Subject)");
  const body = msg.body_html
    ? sanitizeHtml(stripContractMarkup(msg.body_html))
    : escapeHtml(stripContractMarkup(msg.body_text ?? ""));

  const hasAttachments = Boolean(msg.attachments && msg.attachments.length > 0);

  const attachmentsHtml = hasAttachments
    ? `
      <tr>
        <td style="padding: 4px 8px 4px 0; font-weight: 600; color: #202124; white-space: nowrap; width: 64px; vertical-align: top;">Attach:</td>
        <td style="padding: 4px 0; color: #5f6368; vertical-align: top;">
          <div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
            ${(msg.attachments || [])
              .map((att) => {
                const name = escapeHtml(att.filename || "attachment");
                const size = formatFileSize(att.size);
                return `<span class="forward-attachment-badge" style="display: inline-flex; align-items: center; gap: 4px; background: #e6f4ea; color: #188038; border: 1px solid #ceead6; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 500; max-width: 100%; box-sizing: border-box; word-break: break-all;">📎 <span>${name}</span>${size ? ` <span style="opacity: 0.75; font-size: 10px;">(${size})</span>` : ""}</span>`;
              })
              .join("")}
          </div>
        </td>
      </tr>`
    : "";

  return `<p><br></p>
<div class="forwarded-message-card" style="margin: 16px 0; padding: 14px 16px; border-left: 3px solid #188038; background: #f8f9fa; border-radius: 0 8px 8px 0; border-top: 1px solid #dadce0; border-right: 1px solid #dadce0; border-bottom: 1px solid #dadce0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; box-sizing: border-box; max-width: 100%; overflow-wrap: anywhere; word-break: break-word;">
  <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #188038; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
    <span>---------- Forwarded message ---------</span>
  </div>
  <table style="border-collapse: collapse; table-layout: fixed; font-size: 13px; line-height: 1.55; color: #5f6368; width: 100%;">
    <tbody>
      <tr>
        <td style="padding: 4px 8px 4px 0; font-weight: 600; color: #202124; white-space: nowrap; width: 64px; vertical-align: top;">From:</td>
        <td style="padding: 4px 0; color: #5f6368; vertical-align: top; word-break: break-word; overflow-wrap: anywhere;"><span style="display: inline-block; max-width: 100%; box-sizing: border-box; background: #dce9dd; color: #1b583e; padding: 2px 8px; border-radius: 12px; font-weight: 500; font-size: 12px; line-height: 1.55; word-break: break-word; overflow-wrap: anywhere;">${fromDisplay}</span></td>
      </tr>
      <tr>
        <td style="padding: 4px 8px 4px 0; font-weight: 600; color: #202124; white-space: nowrap; width: 64px; vertical-align: top;">Date:</td>
        <td style="padding: 4px 0; color: #5f6368; vertical-align: top; line-height: 1.55; word-break: break-word; overflow-wrap: anywhere;">${dateStr}</td>
      </tr>
      <tr>
        <td style="padding: 4px 8px 4px 0; font-weight: 600; color: #202124; white-space: nowrap; width: 64px; vertical-align: top;">Subject:</td>
        <td style="padding: 4px 0; color: #202124; font-weight: 600; vertical-align: top; line-height: 1.55; word-break: break-word; overflow-wrap: anywhere;">${subjectDisplay}</td>
      </tr>
      <tr>
        <td style="padding: 4px 8px 4px 0; font-weight: 600; color: #202124; white-space: nowrap; width: 64px; vertical-align: top;">To:</td>
        <td style="padding: 4px 0; color: #5f6368; vertical-align: top; word-break: break-word; overflow-wrap: anywhere;"><span style="display: inline-block; max-width: 100%; box-sizing: border-box; background: #f1f3f4; color: #5f6368; padding: 2px 8px; border-radius: 12px; font-size: 12px; line-height: 1.55; word-break: break-word; overflow-wrap: anywhere;">${toDisplay}</span></td>
      </tr>${attachmentsHtml}
    </tbody>
  </table>
</div>
<div class="forwarded-content" style="padding: 4px 2px; margin-top: 12px; font-size: 14px; line-height: 1.55; word-break: break-word; overflow-wrap: anywhere; max-width: 100%;">
  ${body}
</div>`;
}
