import { getDb, withTransaction } from "../db/connection";
import { getSetting } from "../db/settings";
import { getVipSenders } from "../db/notificationVips";
import { queueNewEmailNotification, shouldNotifyForMessage } from "./notificationManager";

interface Arrival {
  thread_id: string;
  from_name: string | null;
  from_address: string | null;
  subject: string | null;
  snippet: string | null;
  category: string | null;
}

/** Gmail reports arrivals through history. Other providers use newly inserted inbox messages. */
export async function notifyNewlySyncedMail(accountId: string, previousSync: number | null, hadCursor: boolean): Promise<void> {
  if (!hadCursor) {
    const db = await getDb();
    await db.execute("DELETE FROM new_mail_notifications WHERE account_id = $1", [accountId]);
    return;
  }

  const [smart, categories, vipSenders] = await Promise.all([
    getSetting("smart_notifications"),
    getSetting("notify_categories"),
    getVipSenders(accountId),
  ]);
  const allowed = new Set((categories ?? "Primary").split(","));
  let fresh: Arrival[] = [];
  await withTransaction(async (db) => {
    fresh = await db.select<Arrival[]>(
      `SELECT m.thread_id, m.from_name, m.from_address, m.subject, m.snippet, category.category
       FROM new_mail_notifications arrival
       JOIN messages m ON m.account_id = arrival.account_id AND m.id = arrival.message_id
       JOIN threads t ON t.account_id = m.account_id AND t.id = m.thread_id
       LEFT JOIN labels inbox ON inbox.account_id = m.account_id AND inbox.id = 'INBOX'
       LEFT JOIN thread_categories category ON category.account_id = t.account_id AND category.thread_id = t.id
       WHERE arrival.account_id = $1 AND m.is_read = 0 AND COALESCE(t.is_muted, 0) = 0 AND m.date >= $2
         AND (
           lower(m.imap_folder) = 'inbox' OR m.imap_folder = inbox.imap_folder_path
           OR (m.imap_folder IS NULL AND EXISTS (
             SELECT 1 FROM thread_labels tl WHERE tl.account_id = t.account_id AND tl.thread_id = t.id AND tl.label_id = 'INBOX'
           ))
         )
         AND EXISTS (
           SELECT 1 FROM thread_labels tl WHERE tl.account_id = t.account_id AND tl.thread_id = t.id AND tl.label_id = 'INBOX'
         )`,
      [accountId, Math.max(0, (previousSync ?? 0) - 86400)],
    );
    await db.execute("DELETE FROM new_mail_notifications WHERE account_id = $1", [accountId]);
  });
  for (const message of fresh) {
    const address = message.from_address ?? undefined;
    if (shouldNotifyForMessage(smart !== "false", allowed, vipSenders, message.category, address)) {
      queueNewEmailNotification(
        message.from_name ?? address ?? "New mail",
        message.subject ?? "",
        message.thread_id,
        accountId,
        address,
        message.snippet ?? "",
      );
    }
  }
}
