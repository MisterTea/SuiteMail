import type { Thread } from "@/stores/threadStore";
import { getThreadLabelIds, type DbThread } from "./threads";

export async function mapDbThread(row: DbThread): Promise<Thread> {
  return {
    id: row.id,
    accountId: row.account_id,
    subject: row.subject,
    snippet: row.snippet,
    lastMessageAt: row.last_message_at ?? 0,
    messageCount: row.message_count,
    isRead: row.is_read === 1,
    isStarred: row.is_starred === 1,
    isPinned: row.is_pinned === 1,
    isMuted: row.is_muted === 1,
    hasAttachments: row.has_attachments === 1,
    labelIds: await getThreadLabelIds(row.account_id, row.id),
    fromName: row.from_name,
    fromAddress: row.from_address,
    toAddresses: row.to_addresses ?? null,
    isFiltered: row.is_filtered == null || row.is_filtered === 1,
  };
}
