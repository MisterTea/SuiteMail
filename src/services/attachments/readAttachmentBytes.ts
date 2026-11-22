import { getEmailProvider } from "../email/providerFactory";
import { loadCachedAttachment } from "./cacheManager";
import type { DbAttachment } from "../db/attachments";

type AttachmentSource = Pick<DbAttachment, "message_id" | "account_id" | "gmail_attachment_id" | "imap_part_id" | "local_path">;

export async function readAttachmentBytes(attachment: AttachmentSource): Promise<Uint8Array<ArrayBuffer> | null> {
  if (attachment.local_path) {
    const cached = await loadCachedAttachment(attachment.local_path);
    if (cached) return new Uint8Array(cached);
  }
  const part = attachment.gmail_attachment_id ?? attachment.imap_part_id;
  if (!part) return null;
  const provider = await getEmailProvider(attachment.account_id);
  const { data } = await provider.fetchAttachment(attachment.message_id, part);
  return Uint8Array.from(atob(data.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
}
