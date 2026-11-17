import type { DbMessage } from "@/services/db/messages";
import { getDb } from "@/services/db/connection";
import { platformSaveFile } from "@/platform";

export interface ExportableMessage {
  id: string;
  from_address: string | null;
  from_name: string | null;
  to_addresses: string | null;
  cc_addresses: string | null;
  subject: string | null;
  date: number;
  body_html: string | null;
  body_text: string | null;
  message_id_header?: string | null;
}

export function formatSingleEml(msg: ExportableMessage): string {
  const dateStr = new Date(msg.date).toUTCString();
  const from = msg.from_name
    ? `"${msg.from_name.replace(/"/g, '\\"')}" <${msg.from_address || "unknown@localhost"}>`
    : (msg.from_address || "unknown@localhost");
  const messageId = msg.message_id_header || `<${msg.id}@suitemail.local>`;
  const contentType = msg.body_html
    ? "text/html; charset=UTF-8"
    : "text/plain; charset=UTF-8";
  const body = msg.body_html ?? msg.body_text ?? "";

  const lines = [
    `From: ${from}`,
    `To: ${msg.to_addresses ?? ""}`,
    msg.cc_addresses ? `Cc: ${msg.cc_addresses}` : null,
    `Subject: ${msg.subject ?? ""}`,
    `Date: ${dateStr}`,
    `Message-ID: ${messageId}`,
    `MIME-Version: 1.0`,
    `Content-Type: ${contentType}`,
    "",
    body,
  ].filter((l): l is string => l !== null);

  return lines.join("\r\n");
}

export function formatMessagesAsEml(messages: ExportableMessage[]): string {
  return messages.map(formatSingleEml).join("\r\n\r\n");
}

export function formatMessagesAsMbox(messages: ExportableMessage[]): string {
  return messages
    .map((msg) => {
      const date = new Date(msg.date);
      const asctime = date.toUTCString().replace(/,/g, "");
      const envSender = msg.from_address || "MAILER-DAEMON";
      const eml = formatSingleEml(msg);
      // Mboxrd escaping: any line starting with "From " or ">*From " gets prepended with ">"
      const escapedEml = eml.replace(/^(>*From )/gm, ">$1");
      return `From ${envSender} ${asctime}\r\n${escapedEml}\r\n`;
    })
    .join("\r\n");
}

export async function exportThreadToFile(
  subject: string,
  messages: ExportableMessage[],
): Promise<{ success: boolean; filePath?: string }> {
  if (messages.length === 0) return { success: false };
  try {
    const sanitizedSubject = (subject || "email").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
    const filename = `${sanitizedSubject}.eml`;
    const content = formatMessagesAsEml(messages);

    await platformSaveFile(filename, new TextEncoder().encode(content));
    return { success: true, filePath: filename };
  } catch (err) {
    console.error("Export thread failed:", err);
    return { success: false };
  }
}

export async function exportAccountToMbox(
  accountId: string,
  accountEmail: string,
): Promise<{ count: number; filePath: string | null }> {
  try {
    const sanitizedEmail = accountEmail.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `${sanitizedEmail}-archive.mbox`;

    const db = await getDb();
    const messages = await db.select<DbMessage[]>(
      "SELECT * FROM messages WHERE account_id = $1 ORDER BY date ASC",
      [accountId],
    );

    const content = formatMessagesAsMbox(messages);
    await platformSaveFile(filename, new TextEncoder().encode(content));

    return { count: messages.length, filePath: filename };
  } catch (err) {
    console.error("Export account to MBOX failed:", err);
    throw err;
  }
}
