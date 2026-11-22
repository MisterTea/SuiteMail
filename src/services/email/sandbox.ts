import PostalMime from "postal-mime";
import { getDb, withTransaction } from "../db/connection";
import { getAccount } from "../db/accounts";
import { upsertAttachment } from "../db/attachments";
import { upsertLabel } from "../db/labels";
import { upsertThread, setThreadLabels, getThreadLabelIds } from "../db/threads";
import { upsertMessage, getMessagesForThread, type DbMessage } from "../db/messages";

export const SANDBOX_ID = "suitemail-sandbox";
export const SANDBOX_EMAIL = "you@sandbox.test";
const people = ["Alex Morgan", "Priya Shah", "Jordan Lee", "Sam Rivera", "Taylor Chen", "Casey Brooks", "Morgan Patel", "Riley Quinn"];
const projects = ["Orion", "Maple", "Harbor", "Juniper", "Atlas", "Cedar", "Willow", "Beacon"];
const topics = ["Project update", "Lunch plans", "Invoice ready", "Design review", "Weekend hike", "Release checklist", "Book club", "Travel itinerary", "Team workshop", "Volunteer schedule"];
const address = (name: string) => `${name.toLowerCase().replaceAll(" ", ".")}@sandbox.test`;
const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
export function generatedMail(index: number, now = Date.now()) {
  const name = people[index % people.length]!;
  const project = projects[Math.floor(index / people.length) % projects.length]!;
  const topic = topics[index % topics.length]!;
  const day = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][index % 5];
  const detail = [
    `The ${project} milestone is on track. We finished the first draft and need your feedback by ${day}. Please confirm whether the timeline works.`,
    `Would you like to meet for lunch on ${day} at ${11 + index % 2}:30? I found a quiet cafe near the park. Please tell me if another time is better.`,
    `Invoice ${4200 + index} for $${180 + index * 13}.00 is ready. Payment is due next ${day}. The reference is ${project}. Please confirm receipt.`,
    `Can you review the ${project} design before ${day}? Focus on navigation, readability, and the sign-up flow. We can discuss the feedback at 2 PM.`,
    `We are planning a ${3 + index % 6} mile hike this weekend. Bring water and a light lunch. We will meet at the north trailhead at 9 AM.`,
    `For the ${project} release, please check accessibility, review the help text, and run the final smoke test by ${day}. Jordan owns deployment.`,
    `Our book club meets ${day} at 6 PM. This month we are discussing a mystery novel. Bring one question and a favorite passage.`,
    `Your ${project} trip is confirmed for ${day}. The train leaves at 8:15 AM. Please arrive 20 minutes early and keep your booking number ${50000 + index}.`,
    `The ${project} workshop is scheduled for ${day} at 10 AM. Please prepare a five-minute demo and send your discussion topics by tomorrow.`,
    `Thank you for volunteering! Your ${day} shift starts at 3 PM. Please help with setup and welcome new guests at the ${project} community center.`,
  ][index % 10]!;
  return { id: `sandbox-seed-${index}`, threadId: `sandbox-thread-${index}`, name, email: address(name), subject: `${topic}: ${project} ${index + 1}`, body: `Hi there,\n\n${detail}\n\nThanks,\n${name}\n\nThis is generated sandbox mail.`, date: now - index * 47 * 60_000 };
}

async function putMessage(m: { id: string; threadId: string; from: string; name: string; to: string; subject: string; body: string; html?: string; date: number; read: boolean; messageId?: string; inReplyTo?: string }) {
  await upsertMessage({ id: m.id, accountId: SANDBOX_ID, threadId: m.threadId, fromAddress: m.from, fromName: m.name,
    toAddresses: m.to, ccAddresses: null, bccAddresses: null, replyTo: null, subject: m.subject,
    snippet: m.body.slice(0, 180), date: m.date, isRead: m.read, isStarred: false,
    bodyText: m.body, bodyHtml: m.html ?? `<p>${escape(m.body).replaceAll("\n", "<br>")}</p>`,
    rawSize: m.body.length, internalDate: m.date, messageIdHeader: m.messageId ?? `<${m.id}@sandbox.test>`, inReplyToHeader: m.inReplyTo ?? null,
  });
}

async function refreshThread(threadId: string, labels?: string[]) {
  const messages = await getMessagesForThread(SANDBOX_ID, threadId);
  const latest = messages[messages.length - 1]!;
  const db = await getDb();
  const attachments = await db.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM attachments a JOIN messages m ON m.account_id=a.account_id AND m.id=a.message_id WHERE m.account_id=$1 AND m.thread_id=$2", [SANDBOX_ID, threadId]);
  await upsertThread({ id: threadId, accountId: SANDBOX_ID, subject: messages[0]!.subject,
    snippet: latest.snippet, lastMessageAt: latest.date, messageCount: messages.length,
    isRead: messages.every((m) => m.is_read === 1), isStarred: messages.some((m) => m.is_starred === 1),
    isImportant: false, hasAttachments: Number(attachments[0]?.n ?? 0) > 0, isFiltered: true });
  if (labels) await setThreadLabels(SANDBOX_ID, threadId, labels);
}

export async function setSandboxEnabled(enabled: boolean): Promise<void> {
  await withTransaction(async (db) => {
    if (!enabled) {
      await db.execute("UPDATE accounts SET is_active = 0 WHERE id = $1", [SANDBOX_ID]);
      return;
    }
    await db.execute(`INSERT INTO accounts (id, email, display_name, provider, is_active, auth_method)
      VALUES ($1, $2, 'Sandbox', 'sandbox', 1, 'local') ON CONFLICT(id) DO UPDATE SET is_active = 1`, [SANDBOX_ID, SANDBOX_EMAIL]);
    for (const [id, name] of [["INBOX", "Inbox"], ["SENT", "Sent"], ["DRAFT", "Drafts"], ["TRASH", "Trash"], ["SPAM", "Spam"], ["STARRED", "Starred"]]) {
      await upsertLabel({ id: id!, accountId: SANDBOX_ID, name: name!, type: "system" });
    }
    const seeded = await db.select<{ count: number }[]>("SELECT COUNT(*) AS count FROM messages WHERE account_id = $1", [SANDBOX_ID]);
    if (seeded[0]!.count > 0) return;
    const now = Date.now();
    for (let i = 0; i < 75; i++) {
      const m = generatedMail(i, now);
      await upsertThread({ id: m.threadId, accountId: SANDBOX_ID, subject: m.subject, snippet: m.body.slice(0, 180), lastMessageAt: m.date,
        messageCount: 1, isRead: i % 3 === 0, isStarred: i % 11 === 0, isImportant: false, hasAttachments: false, isFiltered: true });
      await putMessage({ ...m, from: m.email, to: SANDBOX_EMAIL, read: i % 3 === 0 });
      await setThreadLabels(SANDBOX_ID, m.threadId, i % 11 === 0 ? ["INBOX", "STARRED"] : ["INBOX"]);
    }
  });
  window.dispatchEvent(new Event("suitemail-sync-done"));
}

export async function sandboxIsEnabled(): Promise<boolean> {
  return (await getAccount(SANDBOX_ID))?.is_active === 1;
}

export async function parseSandboxRaw(raw: string) {
  const binary = atob(raw.replaceAll("-", "+").replaceAll("_", "/"));
  return PostalMime.parse(Uint8Array.from(binary, (c) => c.charCodeAt(0)), { attachmentEncoding: "base64" });
}

export async function sendSandboxMessage(raw: string, requestedThread?: string): Promise<{ id: string }> {
  if (!(await sandboxIsEnabled())) throw new Error("Enable the sandbox account before sending.");
  const mail = await parseSandboxRaw(raw);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
  const id = `sandbox-sent-${Array.from(hash).map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  await withTransaction(async (db) => {
    if ((await db.select<{ id: string }[]>("SELECT id FROM messages WHERE account_id = $1 AND id = $2", [SANDBOX_ID, id])).length) return;
    let threadId = requestedThread;
    if (!threadId && mail.inReplyTo) {
      const matches = await db.select<{ thread_id: string }[]>("SELECT thread_id FROM messages WHERE account_id = $1 AND message_id_header = $2", [SANDBOX_ID, mail.inReplyTo]);
      threadId = matches[0]?.thread_id;
    }
    threadId ??= `sandbox-conversation-${crypto.randomUUID()}`;
    const existing = await getMessagesForThread(SANDBOX_ID, threadId);
    const subject = mail.subject || "Sandbox conversation";
    const recipient = mail.to?.find((a) => "address" in a && a.address);
    const to = recipient && "address" in recipient ? recipient.address! : "friend@sandbox.test";
    const name = recipient?.name || to.split("@")[0]!.replace(/[._-]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    if (!existing.length) await upsertThread({ id: threadId, accountId: SANDBOX_ID, subject, snippet: "", lastMessageAt: Date.now(), messageCount: 0,
      isRead: true, isStarred: false, isImportant: false, hasAttachments: false, isFiltered: true });
    await putMessage({ id, threadId, from: SANDBOX_EMAIL, name: "You", to, subject, body: mail.text || "", html: mail.html, date: Date.now(), read: true, messageId: mail.messageId, inReplyTo: mail.inReplyTo });
    for (const [index, attachment] of mail.attachments.entries()) {
      const data = sandboxAttachmentBase64(attachment.content);
      const attachmentId = `${id}-attachment-${index}`;
      await upsertAttachment({ id: attachmentId, accountId: SANDBOX_ID, messageId: id,
        filename: attachment.filename, mimeType: attachment.mimeType, size: atob(data).length,
        gmailAttachmentId: attachmentId, contentId: attachment.contentId ?? null, isInline: attachment.disposition === "inline" });
    }
    await db.execute("INSERT INTO sandbox_raw_messages (account_id, id, thread_id, raw) VALUES ($1, $2, $3, $4)", [SANDBOX_ID, id, threadId, raw]);
    const replied = await db.select<{ thread_id: string }[]>("SELECT thread_id FROM sandbox_replies WHERE account_id = $1 AND thread_id = $2", [SANDBOX_ID, threadId]);
    const labels = new Set(await getThreadLabelIds(SANDBOX_ID, threadId));
    labels.add("SENT");
    if (!replied.length) {
      await db.execute("INSERT INTO sandbox_replies (account_id, thread_id) VALUES ($1, $2)", [SANDBOX_ID, threadId]);
      const detail = ["I will review the details and send the next update tomorrow.", "The proposed time works for me. Please include the agenda.", "Thanks for confirming. I have added this to my checklist.", "I agree with the plan. Let us check progress on Friday."][hash[0]! % 4];
      await putMessage({ id: `sandbox-reply-${crypto.randomUUID()}`, threadId, from: to, name, to: SANDBOX_EMAIL,
        subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`, body: `Hi,\n\nThanks for your message about ${subject.replace(/^re:\s*/i, "")}. ${detail}\n\nBest,\n${name}\n\nGenerated sandbox reply. This conversation receives only one automatic reply.`, date: Date.now() + 1, read: false,
        inReplyTo: mail.messageId || `<${id}@sandbox.test>` });
      labels.add("INBOX");
    }
    await refreshThread(threadId, [...labels]);
  });
  window.dispatchEvent(new Event("suitemail-sync-done"));
  return { id };
}

export function sandboxMessageAsParsed(m: DbMessage) {
  return { id: m.id, threadId: m.thread_id, fromAddress: m.from_address, fromName: m.from_name,
    toAddresses: m.to_addresses, ccAddresses: m.cc_addresses, bccAddresses: m.bcc_addresses, replyTo: m.reply_to,
    subject: m.subject, snippet: m.snippet ?? "", date: m.date, isRead: m.is_read === 1, isStarred: m.is_starred === 1,
    bodyHtml: m.body_html, bodyText: m.body_text, rawSize: m.raw_size ?? 0, internalDate: m.internal_date ?? m.date,
    labelIds: [], hasAttachments: false, attachments: [], listUnsubscribe: null, listUnsubscribePost: null, authResults: null };
}


export function sandboxAttachmentBase64(content: ArrayBuffer | Uint8Array | string): string {
  if (typeof content === "string") return content;
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
