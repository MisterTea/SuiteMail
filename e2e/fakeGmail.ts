/**
 * In-memory Gmail API stand-in used by e2e/fakeServer.ts and the sync efficiency benchmark.
 *
 * Implements the subset of the Gmail REST API that SuiteMail's sync uses, with Gmail's per-method quota
 * costs, history records, the multipart batch endpoint, and messages.batchModify. Every call is logged
 * so tests can count HTTP requests and quota units.
 */

export interface FakeGmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  internalDate: number;
  from: string;
  to: string;
  subject: string;
  body: string;
  attachment?: { filename: string; mimeType: string; size: number };
}

interface HistoryRecord {
  id: number;
  messagesAdded?: { message: { id: string; threadId: string; labelIds: string[] } }[];
  messagesDeleted?: { message: { id: string; threadId: string } }[];
  labelsAdded?: { message: { id: string; threadId: string; labelIds: string[] }; labelIds: string[] }[];
  labelsRemoved?: { message: { id: string; threadId: string; labelIds: string[] }; labelIds: string[] }[];
}

export interface FakeGmailCall {
  method: string;
  path: string;
  units: number;
  /** True when the call arrived inside a multipart batch request. */
  batched: boolean;
}

export interface FakeGmailResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Gmail quota units per method (https://developers.google.com/workspace/gmail/api/reference/quota). */
export function gmailMethodUnits(method: string, path: string, format: string | null): number {
  const resource = path.replace(/^\/gmail\/v1\/users\/[^/]+/, "");
  const light = format === "metadata" || format === "minimal";
  if (method === "GET") {
    if (/^\/threads\/[^/]+$/.test(resource)) return light ? 40 : 120;
    if (resource === "/threads") return 10;
    if (/^\/messages\/[^/]+\/attachments\//.test(resource)) return 20;
    if (/^\/messages\/[^/]+$/.test(resource)) return light ? 20 : 60;
    if (resource === "/messages") return 5;
    if (resource === "/history") return 2;
    if (resource === "/profile" || resource === "/labels") return 1;
    return 1;
  }
  if (resource === "/messages/batchModify" || resource === "/messages/batchDelete") return 50;
  if (/^\/threads\/[^/]+\/modify$/.test(resource)) return 10;
  if (/^\/messages\/[^/]+\/modify$/.test(resource)) return 5;
  if (/^\/threads\/[^/]+$/.test(resource) && method === "DELETE") return 20;
  if (resource === "/messages/send") return 100;
  return 5;
}

function b64url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function json(status: number, value: unknown): FakeGmailResponse {
  return { status, headers: { "content-type": "application/json; charset=UTF-8" }, body: JSON.stringify(value) };
}

/** Small deterministic PRNG so seeded mailboxes are identical between runs. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export class FakeGmail {
  readonly messages = new Map<string, FakeGmailMessage>();
  readonly calls: FakeGmailCall[] = [];
  httpRequests = 0;
  historyId = 1000;
  private history: HistoryRecord[] = [];
  private nextId = 1;
  /** Return 429 for every Nth sub-request inside batches (0 = never). Used to test partial failures. */
  batchRateLimitEvery = 0;
  private batchSubRequests = 0;

  constructor(readonly email = "user@gmail.test") {}

  private newId(): string {
    return (0x18c0000000 + this.nextId++).toString(16);
  }

  /** Seed `threadCount` threads spread over the last `days` days; `recentThreads` of them in the last 30 days. */
  seed(options: { threadCount: number; recentThreads: number; days?: number; now?: number; seed?: number }): void {
    const random = prng(options.seed ?? 42);
    const now = options.now ?? Date.now();
    const days = options.days ?? 365;
    for (let t = 0; t < options.threadCount; t++) {
      const recent = t < options.recentThreads;
      const ageDays = recent ? random() * 29 : 31 + random() * (days - 33);
      const start = now - ageDays * 86_400_000;
      const count = 1 + Math.floor(random() * 4); // 1-4 messages, ~2.5 average
      const inbox = recent || random() < 0.3;
      const unread = recent && random() < 0.5;
      let threadId = "";
      for (let m = 0; m < count; m++) {
        const id = this.newId();
        if (m === 0) threadId = id; // Gmail uses the first message's ID as the thread ID.
        // About one reply in five is the user's own (SENT only, no INBOX), as in real conversations.
        const sent = m > 0 && random() < 0.2;
        const labels = sent
          ? ["SENT"]
          : [inbox ? "INBOX" : "", unread && m === count - 1 ? "UNREAD" : "", random() < 0.05 ? "STARRED" : "", random() < 0.15 ? "Label_1" : ""].filter(Boolean);
        this.messages.set(id, {
          id,
          threadId,
          labelIds: labels,
          internalDate: Math.floor(start + m * 3_600_000),
          from: `Sender ${t % 37} <sender${t % 37}@example.com>`,
          to: this.email,
          subject: `Thread ${t} subject`,
          body: `Body of message ${m} in thread ${t}. `.repeat(40),
          attachment: random() < 0.1 ? { filename: `file-${id}.pdf`, mimeType: "application/pdf", size: 20_000 } : undefined,
        });
      }
    }
    this.historyId += 1;
  }

  threadIds(): string[] {
    return [...new Set([...this.messages.values()].map((m) => m.threadId))];
  }

  threadMessages(threadId: string): FakeGmailMessage[] {
    return [...this.messages.values()].filter((m) => m.threadId === threadId).sort((a, b) => a.internalDate - b.internalDate);
  }

  private record(record: Omit<HistoryRecord, "id">): void {
    this.historyId += 1;
    this.history.push({ id: this.historyId, ...record });
  }

  /** Deliver a message. Without `threadId` it starts a new conversation. */
  deliver(options: { threadId?: string; subject?: string; labels?: string[]; at?: number } = {}): FakeGmailMessage {
    const id = this.newId();
    const threadId = options.threadId ?? id;
    const previous = options.threadId ? this.threadMessages(options.threadId) : [];
    const message: FakeGmailMessage = {
      id,
      threadId,
      labelIds: options.labels ?? ["INBOX", "UNREAD"],
      internalDate: options.at ?? Date.now(),
      from: "New Sender <new@example.com>",
      to: this.email,
      subject: options.subject ?? (previous[0] ? `Re: ${previous[0].subject}` : `New thread ${id}`),
      body: `Fresh body ${id}. `.repeat(20),
    };
    this.messages.set(id, message);
    this.record({ messagesAdded: [{ message: { id, threadId, labelIds: [...message.labelIds] } }] });
    return message;
  }

  modifyMessages(ids: string[], add: string[] = [], remove: string[] = []): void {
    const added: HistoryRecord["labelsAdded"] = [];
    const removed: HistoryRecord["labelsRemoved"] = [];
    for (const id of ids) {
      const message = this.messages.get(id);
      if (!message) continue;
      const addNow = add.filter((label) => !message.labelIds.includes(label));
      const removeNow = remove.filter((label) => message.labelIds.includes(label));
      message.labelIds = [...message.labelIds.filter((label) => !removeNow.includes(label)), ...addNow];
      const ref = { id, threadId: message.threadId, labelIds: [...message.labelIds] };
      if (addNow.length) added.push({ message: ref, labelIds: addNow });
      if (removeNow.length) removed.push({ message: ref, labelIds: removeNow });
    }
    if (added.length || removed.length) {
      this.record({ ...(added.length ? { labelsAdded: added } : {}), ...(removed.length ? { labelsRemoved: removed } : {}) });
    }
  }

  modifyThread(threadId: string, add: string[] = [], remove: string[] = []): void {
    this.modifyMessages(this.threadMessages(threadId).map((m) => m.id), add, remove);
  }

  deleteMessage(id: string): void {
    const message = this.messages.get(id);
    if (!message) return;
    this.messages.delete(id);
    this.record({ messagesDeleted: [{ message: { id, threadId: message.threadId } }] });
  }

  resetLog(): void {
    this.calls.length = 0;
    this.httpRequests = 0;
  }

  totals(): { httpRequests: number; calls: number; units: number } {
    return { httpRequests: this.httpRequests, calls: this.calls.length, units: this.calls.reduce((sum, c) => sum + c.units, 0) };
  }

  private messageResource(message: FakeGmailMessage, format: string): Record<string, unknown> {
    const headers = [
      { name: "From", value: message.from },
      { name: "To", value: message.to },
      { name: "Subject", value: message.subject },
      { name: "Date", value: new Date(message.internalDate).toUTCString() },
      { name: "Message-ID", value: `<${message.id}@example.com>` },
    ];
    const base = {
      id: message.id,
      threadId: message.threadId,
      labelIds: [...message.labelIds],
      snippet: message.body.slice(0, 100),
      historyId: String(this.historyId),
      internalDate: String(message.internalDate),
      sizeEstimate: message.body.length * 2,
    };
    if (format === "minimal") return base;
    const mimeType = message.attachment ? "multipart/mixed" : "multipart/alternative";
    if (format === "metadata") return { ...base, payload: { partId: "", mimeType, filename: "", headers } };
    const textParts = [
      { partId: "0.0", mimeType: "text/plain", filename: "", headers: [], body: { size: message.body.length, data: b64url(message.body) } },
      { partId: "0.1", mimeType: "text/html", filename: "", headers: [], body: { size: message.body.length + 7, data: b64url(`<p>${message.body}</p>`) } },
    ];
    const parts = message.attachment
      ? [
          { partId: "0", mimeType: "multipart/alternative", filename: "", headers: [], body: { size: 0 }, parts: textParts },
          { partId: "1", mimeType: message.attachment.mimeType, filename: message.attachment.filename, headers: [{ name: "Content-Disposition", value: "attachment" }], body: { size: message.attachment.size, attachmentId: `att-${message.id}` } },
        ]
      : textParts;
    return { ...base, payload: { partId: "", mimeType, filename: "", headers, body: { size: 0 }, parts } };
  }

  private threadSummaries(query: URLSearchParams): FakeGmailMessage[][] {
    const after = query.get("q")?.match(/after:(\d+)\/(\d+)\/(\d+)/);
    const afterMs = after ? new Date(Number(after[1]), Number(after[2]) - 1, Number(after[3])).getTime() : 0;
    const labelIds = query.get("labelIds")?.split(",").filter(Boolean) ?? [];
    return this.threadIds()
      .map((id) => this.threadMessages(id))
      .filter((messages) => messages.length > 0 && messages.at(-1)!.internalDate >= afterMs)
      .filter((messages) => labelIds.every((label) => messages.some((m) => m.labelIds.includes(label))))
      .sort((a, b) => b.at(-1)!.internalDate - a.at(-1)!.internalDate);
  }

  /** Handle one (non-batch) Gmail REST call. `path` includes the query string. */
  private call(method: string, path: string, body: string, batched: boolean): FakeGmailResponse {
    const url = new URL(path, "https://gmail.googleapis.com");
    const resource = url.pathname.replace(/^\/gmail\/v1\/users\/[^/]+/, "");
    const format = url.searchParams.get("format");
    this.calls.push({ method, path: url.pathname + url.search, units: gmailMethodUnits(method, url.pathname, format), batched });

    if (method === "GET" && resource === "/profile") {
      return json(200, { emailAddress: this.email, messagesTotal: this.messages.size, threadsTotal: this.threadIds().length, historyId: String(this.historyId) });
    }
    if (method === "GET" && resource === "/labels") {
      return json(200, { labels: ["INBOX", "SENT", "TRASH", "SPAM", "STARRED", "UNREAD", "IMPORTANT", "DRAFT"].map((id) => ({ id, name: id, type: "system" })).concat([{ id: "Label_1", name: "Projects", type: "user" }]) });
    }
    if (method === "GET" && resource === "/threads") {
      const all = this.threadSummaries(url.searchParams);
      const max = Math.min(500, Number(url.searchParams.get("maxResults") || 100));
      const offset = Number(url.searchParams.get("pageToken") || 0);
      const page = all.slice(offset, offset + max);
      return json(200, {
        threads: page.map((messages) => ({ id: messages[0]!.threadId, snippet: messages.at(-1)!.body.slice(0, 100), historyId: String(this.historyId) })),
        ...(offset + max < all.length ? { nextPageToken: String(offset + max) } : {}),
        resultSizeEstimate: all.length,
      });
    }
    let match = resource.match(/^\/threads\/([^/]+)$/);
    if (match && method === "GET") {
      const messages = this.threadMessages(decodeURIComponent(match[1]!));
      if (!messages.length) return json(404, { error: { code: 404, message: "Requested entity was not found." } });
      return json(200, { id: messages[0]!.threadId, historyId: String(this.historyId), messages: messages.map((m) => this.messageResource(m, format || "full")) });
    }
    if (match && method === "DELETE") {
      for (const message of this.threadMessages(decodeURIComponent(match[1]!))) this.deleteMessage(message.id);
      return { status: 204, headers: {}, body: "" };
    }
    match = resource.match(/^\/messages\/([^/]+)$/);
    if (match && method === "GET") {
      const message = this.messages.get(decodeURIComponent(match[1]!));
      if (!message) return json(404, { error: { code: 404, message: "Requested entity was not found." } });
      return json(200, this.messageResource(message, format || "full"));
    }
    match = resource.match(/^\/threads\/([^/]+)\/modify$/);
    if (match && method === "POST") {
      const threadId = decodeURIComponent(match[1]!);
      const request = JSON.parse(body || "{}") as { addLabelIds?: string[]; removeLabelIds?: string[] };
      if (!this.threadMessages(threadId).length) return json(404, { error: { code: 404, message: "Requested entity was not found." } });
      this.modifyThread(threadId, request.addLabelIds, request.removeLabelIds);
      return json(200, { id: threadId, messages: this.threadMessages(threadId).map((m) => this.messageResource(m, "minimal")) });
    }
    if (method === "POST" && resource === "/messages/batchModify") {
      const request = JSON.parse(body || "{}") as { ids?: string[]; addLabelIds?: string[]; removeLabelIds?: string[] };
      if (!request.ids?.length || request.ids.length > 1000) return json(400, { error: { code: 400, message: "Invalid ids" } });
      this.modifyMessages(request.ids, request.addLabelIds, request.removeLabelIds);
      return { status: 204, headers: {}, body: "" };
    }
    if (method === "GET" && resource === "/history") {
      const start = Number(url.searchParams.get("startHistoryId"));
      const oldest = this.history[0]?.id ?? this.historyId;
      if (!Number.isFinite(start) || start < oldest - 1_000_000) return json(404, { error: { code: 404, message: "historyId too old" } });
      const types = url.searchParams.getAll("historyTypes");
      const keys = { messageAdded: "messagesAdded", messageDeleted: "messagesDeleted", labelAdded: "labelsAdded", labelRemoved: "labelsRemoved" } as const;
      const wanted = types.length ? types.map((t) => keys[t as keyof typeof keys]).filter(Boolean) : Object.values(keys);
      const records = this.history
        .filter((record) => record.id > start)
        .map((record) => {
          const filtered: Record<string, unknown> = { id: String(record.id) };
          const refs: { id: string; threadId: string }[] = [];
          for (const key of wanted) {
            const entries = record[key];
            if (!entries?.length) continue;
            filtered[key] = entries;
            for (const entry of entries) refs.push({ id: entry.message.id, threadId: entry.message.threadId });
          }
          filtered.messages = refs;
          return refs.length ? filtered : null;
        })
        .filter(Boolean);
      const max = Math.min(500, Number(url.searchParams.get("maxResults") || 100));
      const offset = Number(url.searchParams.get("pageToken") || 0);
      return json(200, {
        history: records.slice(offset, offset + max),
        historyId: String(this.historyId),
        ...(offset + max < records.length ? { nextPageToken: String(offset + max) } : {}),
      });
    }
    return json(404, { error: { code: 404, message: `Unsupported fake Gmail call ${method} ${resource}` } });
  }

  /** Parse a multipart/mixed batch request and answer with a multipart/mixed response. */
  private batch(contentType: string, body: string): FakeGmailResponse {
    const boundary = contentType.match(/boundary="?([^";]+)"?/i)?.[1];
    if (!boundary) return json(400, { error: { code: 400, message: "Missing boundary" } });
    const parts = body.split(`--${boundary}`).slice(1).filter((part) => !part.startsWith("--"));
    if (parts.length > 100) return json(400, { error: { code: 400, message: "Too many requests in batch" } });
    const responseBoundary = `batch_fake_${parts.length}`;
    let output = "";
    for (const raw of parts) {
      const part = raw.replace(/^\r?\n/, "");
      const [partHeaders, ...rest] = part.split(/\r?\n\r?\n/);
      const contentId = partHeaders!.match(/Content-ID:\s*<?([^>\r\n]+)>?/i)?.[1] ?? "";
      const http = rest.join("\r\n\r\n");
      const [requestLine, ...afterLine] = http.split(/\r?\n/);
      const [method, path] = requestLine!.trim().split(/\s+/);
      const blank = afterLine.findIndex((line) => line.trim() === "");
      const requestBody = blank >= 0 ? afterLine.slice(blank + 1).join("\n").trim() : "";
      this.batchSubRequests += 1;
      const response = this.batchRateLimitEvery > 0 && this.batchSubRequests % this.batchRateLimitEvery === 0
        ? json(429, { error: { code: 429, message: "Too many concurrent requests for user", errors: [{ reason: "rateLimitExceeded" }] } })
        : this.call(method!, path!, requestBody, true);
      const reason = response.status === 200 ? "OK" : response.status === 204 ? "No Content" : response.status === 404 ? "Not Found" : response.status === 429 ? "Too Many Requests" : "Error";
      output += `--${responseBoundary}\r\nContent-Type: application/http\r\nContent-ID: <response-${contentId}>\r\n\r\n`;
      output += `HTTP/1.1 ${response.status} ${reason}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${response.body}\r\n`;
    }
    output += `--${responseBoundary}--\r\n`;
    return { status: 200, headers: { "content-type": `multipart/mixed; boundary=${responseBoundary}` }, body: output };
  }

  /** Entry point for one HTTP request (either a REST call or a batch). */
  handle(method: string, url: string, headers: Record<string, string>, body = ""): FakeGmailResponse {
    this.httpRequests += 1;
    const parsed = new URL(url, "https://gmail.googleapis.com");
    if (parsed.pathname === "/batch/gmail/v1" && method === "POST") {
      const contentType = Object.entries(headers).find(([name]) => name.toLowerCase() === "content-type")?.[1] ?? "";
      return this.batch(contentType, body);
    }
    return this.call(method, parsed.pathname + parsed.search, body, false);
  }
}
