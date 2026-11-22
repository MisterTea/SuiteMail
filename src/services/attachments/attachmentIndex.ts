import { create, insertMultiple, search } from "@orama/orama";
import { createBackgroundChecker } from "../backgroundCheckers";
import { getDb, withTransaction } from "../db/connection";
import type { AttachmentWithContext } from "../db/attachments";
import { generateLocalDenseVector } from "../ai/embeddingService";
import { readAttachmentBytes } from "./readAttachmentBytes";
import { useUIStore } from "@/stores/uiStore";

const MAX_BYTES = 16 * 1024 * 1024;
const INDEXABLE: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  md: "text/markdown",
  log: "text/plain",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  bmp: "image/bmp",
};

let running = false;
async function indexAttachments(): Promise<void> {
  if (running) return;
  running = true;
  let changed = false;
  try {
    const db = await getDb();
    const online = useUIStore.getState().isOnline;
    const pending = await db.select<(Parameters<typeof readAttachmentBytes>[0] & { id: string; filename: string })[]>(
      `SELECT a.id, a.filename, a.message_id, a.account_id, a.gmail_attachment_id, a.imap_part_id, a.local_path
       FROM attachments a
       JOIN messages m ON m.account_id = a.account_id AND m.id = a.message_id
       LEFT JOIN attachment_index_status s ON a.id = s.attachment_id
       WHERE a.is_inline = 0 AND a.size <= $1
         AND ($2 = 1 OR a.local_path IS NOT NULL)
         AND (a.gmail_attachment_id IS NOT NULL OR a.imap_part_id IS NOT NULL OR a.local_path IS NOT NULL)
         AND (s.attachment_id IS NULL OR s.retry_at <= unixepoch())
         AND (${Object.keys(INDEXABLE).map((ext) => `lower(a.filename) LIKE '%.${ext}'`).join(" OR ")})
       ORDER BY m.date DESC LIMIT 12`, [MAX_BYTES, Number(online)],
    );
    for (const attachment of pending) {
      let retryAt: number | null = null;
      try {
        const bytes = await readAttachmentBytes(attachment);
        const mime = INDEXABLE[attachment.filename.split(".").pop()?.toLowerCase() ?? ""];
        if (bytes?.length && bytes.length <= MAX_BYTES && mime) {
          const { extractAttachmentChunks } = await import("./extractAttachmentText");
          const chunks = (await extractAttachmentChunks(bytes, mime))
            .slice(0, 150)
            .map((chunk) => chunk.replace(/\s+/g, " ").trim().slice(0, 1_500))
            .filter(Boolean);
          if (chunks.length) {
            await withTransaction(async (transaction) => {
              await transaction.execute("DELETE FROM attachment_vectors WHERE attachment_id = $1", [attachment.id]);
              for (const [index, text] of chunks.entries()) {
                await transaction.execute(
                  "INSERT INTO attachment_vectors (attachment_id, chunk, text, vector) VALUES ($1, $2, $3, $4)",
                  [attachment.id, index, text, JSON.stringify(generateLocalDenseVector(text))],
                );
              }
            });
            changed = true;
          }
        }
      } catch (error) {
        console.debug("Attachment indexing failed:", error instanceof Error ? error.message : "Unknown indexing error");
        retryAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
      }
      await db.execute(
        `INSERT INTO attachment_index_status (attachment_id, retry_at)
         SELECT id, $2 FROM attachments WHERE id = $1
         ON CONFLICT(attachment_id) DO UPDATE SET retry_at = excluded.retry_at`,
        [attachment.id, retryAt],
      );
    }
  } finally {
    running = false;
    if (changed) {
      cachedSearch = undefined;
      window.dispatchEvent(new Event("suitemail-attachment-index-updated"));
    }
  }
}

const checker = createBackgroundChecker("AttachmentIndex", indexAttachments, 30_000);
export const startAttachmentIndex = checker.start;
export const stopAttachmentIndex = checker.stop;

const createSearchIndex = () => create({
  schema: { attachmentId: "string", text: "string", embedding: "vector[384]" },
});

let cachedSearch: { accountId: string; index: Promise<ReturnType<typeof createSearchIndex>> } | undefined;

async function loadSearchIndex(accountId: string) {
  const db = await getDb();
  const index = createSearchIndex();
  let cursor = 0;
  while (true) {
    const rows = await db.select<{ rowid: number; attachment_id: string; text: string; vector: string }[]>(
      `SELECT v.rowid, v.attachment_id, v.text, v.vector
       FROM attachment_vectors v
       JOIN attachments a ON a.id = v.attachment_id AND a.account_id = $1
       WHERE v.rowid > $2 ORDER BY v.rowid LIMIT 300`, [accountId, cursor],
    );
    if (!rows.length) return index;
    await insertMultiple(index, rows.flatMap((row) => {
      const embedding: unknown = JSON.parse(row.vector);
      if (!Array.isArray(embedding) || embedding.length !== 384) return [];
      return [{ attachmentId: row.attachment_id, text: row.text, embedding }];
    }));
    cursor = rows[rows.length - 1]!.rowid;
  }
}

export async function searchAttachmentText(query: string, accountId: string): Promise<AttachmentWithContext[]> {
  const term = query.trim();
  if (!term) return [];
  if (!cachedSearch || cachedSearch.accountId !== accountId) {
    const entry = { accountId, index: loadSearchIndex(accountId) };
    cachedSearch = entry;
    void entry.index.catch(() => {
      if (cachedSearch === entry) cachedSearch = undefined;
    });
  }

  const index = await cachedSearch.index;
  const hits = await search(index, {
    mode: "hybrid",
    term,
    vector: { value: generateLocalDenseVector(term), property: "embedding" },
    similarity: 0.4,
    limit: 200,
    properties: ["text"],
  });
  const snippets = new Map<string, string>();
  for (const { document } of hits.hits) {
    if (snippets.has(document.attachmentId)) continue;
    const text = document.text;
    const match = text.toLowerCase().indexOf(term.toLowerCase());
    const start = Math.max(0, match - 50);
    snippets.set(document.attachmentId, text.slice(start, start + 180));
    if (snippets.size === 100) break;
  }
  if (!snippets.size) return [];

  const db = await getDb();
  const attachments = await db.select<AttachmentWithContext[]>(
    `SELECT a.*, m.from_address, m.from_name, m.date, m.subject, m.thread_id
     FROM attachments a JOIN messages m ON m.account_id = a.account_id AND m.id = a.message_id
     WHERE a.account_id = $1 AND a.id IN (SELECT value FROM json_each($2))`,
    [accountId, JSON.stringify([...snippets.keys()])],
  );
  const byId = new Map(attachments.map((attachment) => [attachment.id, attachment]));
  return [...snippets].flatMap(([id, content_match]) => {
    const attachment = byId.get(id);
    return attachment ? [{ ...attachment, content_match }] : [];
  });
}
