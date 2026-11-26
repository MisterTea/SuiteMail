import { iosBytes, iosNative, isIOS } from "@/platform/ios";
import { gmailRequestCost, waitForGmailQuota, pauseGmailQuota, isGmailRateLimit, isGmailRateLimitBody, retryAfterMs, GMAIL_BURST_UNITS } from "./quota";
import { refreshAccessToken, type TokenResponse } from "./auth";
import { getDb } from "../db/connection";
import { encryptValue } from "@/utils/crypto";
import { getCurrentUnixTimestamp } from "@/utils/timestamp";

const GMAIL_API_BASE = "https://www.googleapis.com/gmail/v1";
/** Gmail's batch endpoint. Each call inside still costs its own quota units. */
const GMAIL_BATCH_URL = "https://www.googleapis.com/batch/gmail/v1";
/** Gmail accepts 100 calls per batch but recommends at most 50. */
export const GMAIL_BATCH_LIMIT = 50;
/** messages.batchModify accepts up to 1,000 message IDs. */
const BATCH_MODIFY_LIMIT = 1000;
/** Thread label changes made within this window are sent together in one batch request. */
const MODIFY_COALESCE_MS = 20;
const MAX_RETRY_ATTEMPTS = 3;
const INITIAL_BACKOFF_MS = 1000;

export interface GmailBatchCall {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Path below /gmail/v1/users/me, e.g. "/threads/abc?format=full". */
  path: string;
  body?: unknown;
}

export interface GmailBatchResult<T = unknown> {
  status: number;
  body?: T;
  error?: GmailApiError;
}

/** Build a multipart/mixed batch request body. */
export function buildBatchBody(boundary: string, calls: (GmailBatchCall & { id: string })[]): string {
  let body = "";
  for (const call of calls) {
    const method = call.method ?? "GET";
    body += `--${boundary}\r\nContent-Type: application/http\r\nContent-ID: <${call.id}>\r\n\r\n`;
    body += `${method} /gmail/v1/users/me${call.path}\r\n`;
    if (call.body !== undefined) body += `Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(call.body)}\r\n`;
    body += "\r\n";
  }
  return `${body}--${boundary}--\r\n`;
}

/** Split a multipart/mixed batch response into per-call status and body, keyed by request Content-ID. */
export function parseBatchResponse(contentType: string, text: string): Map<string, { status: number; body: string }> {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  // Fall back to the body's opening delimiter in case a native bridge drops the Content-Type header.
  const boundary = match?.[1] ?? match?.[2] ?? text.match(/^\s*--([^\s-][^\r\n]*?)\s*\r?\n/)?.[1];
  if (!boundary) throw new GmailApiError(502, "Gmail batch response has no multipart boundary");
  const responses = new Map<string, { status: number; body: string }>();
  for (const raw of text.split(`--${boundary}`)) {
    const part = raw.replace(/^\r?\n/, "");
    if (!part.trim() || part.startsWith("--")) continue;
    const headerEnd = part.search(/\r?\n\r?\n/);
    if (headerEnd < 0) continue;
    const id = part.slice(0, headerEnd).match(/Content-ID:\s*<?([^>\r\n]+)>?/i)?.[1]?.trim().replace(/^response-/, "");
    const http = part.slice(headerEnd).replace(/^\r?\n\r?\n/, "");
    const status = Number(http.match(/^HTTP\/[\d.]+\s+(\d{3})/)?.[1]);
    const bodyStart = http.search(/\r?\n\r?\n/);
    const body = bodyStart < 0 ? "" : http.slice(bodyStart).replace(/^\r?\n\r?\n/, "").trim();
    if (id && status) responses.set(id, { status, body });
  }
  return responses;
}

function parseJson(text: string): unknown {
  try { return text ? JSON.parse(text) : undefined; } catch { return undefined; }
}

interface QueuedModify {
  threadId: string;
  addLabelIds?: string[];
  removeLabelIds?: string[];
  resolve: (thread: GmailThread) => void;
  reject: (error: unknown) => void;
}

export class GmailApiError extends Error {
  constructor(public readonly status: number, body: string) {
    super(`Gmail API error: ${status} ${body}`);
    this.name = "GmailApiError";
  }
}

export type GoogleTokenProvider = (invalidToken?: string) => Promise<{accessToken: string; expiresAt: number}>;

interface TokenInfo {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/**
 * Gmail API client with automatic token refresh.
 */
export class GmailClient {
  private accountId: string;
  private clientId: string;
  private clientSecret?: string;
  private tokenInfo: TokenInfo;
  private refreshPromise: Promise<void> | null = null;

  constructor(accountId: string, clientId: string, tokenInfo: TokenInfo, clientSecret?: string, private tokenProvider?: GoogleTokenProvider) {
    this.accountId = accountId;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.tokenInfo = tokenInfo;
  }

  private async getValidToken(): Promise<string> {
    const now = getCurrentUnixTimestamp();
    // Refresh if token expires within 5 minutes
    if (this.tokenInfo.expiresAt - now < 300) {
      // Mutex: only one refresh at a time; concurrent callers await the same promise
      if (!this.refreshPromise) {
        this.refreshPromise = this.refreshToken().finally(() => {
          this.refreshPromise = null;
        });
      }
      await this.refreshPromise;
    }
    return this.tokenInfo.accessToken;
  }

  private async refreshToken(invalidToken?: string): Promise<void> {
    if (this.tokenProvider) {
      const token = await this.tokenProvider(invalidToken);
      this.tokenInfo = {...this.tokenInfo, ...token};
      if (isIOS()) return; // The native token provider persists authorization in Keychain.
      const db = await getDb();
      await db.execute(
        "UPDATE accounts SET access_token = $1, token_expires_at = $2, updated_at = unixepoch() WHERE id = $3",
        [await encryptValue(token.accessToken), token.expiresAt, this.accountId],
      );
      return;
    }
    const tokens: TokenResponse = await refreshAccessToken(
      this.tokenInfo.refreshToken,
      this.clientId,
      this.clientSecret,
    );

    const expiresAt = getCurrentUnixTimestamp() + tokens.expires_in;

    this.tokenInfo = {
      accessToken: tokens.access_token,
      refreshToken: this.tokenInfo.refreshToken,
      expiresAt,
    };

    // Persist the new token (encrypted)
    const db = await getDb();
    const encAccessToken = await encryptValue(tokens.access_token);
    await db.execute(
      "UPDATE accounts SET access_token = $1, token_expires_at = $2, updated_at = unixepoch() WHERE id = $3",
      [encAccessToken, expiresAt, this.accountId],
    );
  }

  private async fetch(url: string, options: RequestInit): Promise<Response> {
    if (!isIOS()) return fetch(url, options);
    const response = await iosNative.googleRequest({
      account: this.accountId,
      url,
      method: options.method,
      headers: Object.fromEntries(new Headers(options.headers)),
      body: typeof options.body === "string" ? options.body : undefined,
    });
    return new Response(response.status === 204 || response.status === 205 || response.status === 304
      ? null : iosBytes(response.body), { status: response.status, headers: response.headers });
  }

  /**
   * Pace requests and retry both Gmail quota 403s and HTTP 429 responses.
   * Uses Retry-After header when available, otherwise exponential backoff.
   */
  private async fetchWithRetry(
    url: string,
    options: RequestInit,
  ): Promise<Response> {
    let lastResponse: Response | undefined;
    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
      await waitForGmailQuota(this.accountId, gmailRequestCost(url, options.method || "GET"));
      const response = await this.fetch(url, options);
      if (!(await isGmailRateLimit(response))) return response;

      lastResponse = response;
      const retryAfter = retryAfterMs(response.headers.get("Retry-After"));
      const delayMs = retryAfter ?? (response.status === 403 ? 60_000 : INITIAL_BACKOFF_MS) * Math.pow(2, attempt);
      pauseGmailQuota(this.accountId, delayMs);
      if (attempt === MAX_RETRY_ATTEMPTS - 1) break;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return lastResponse!;
  }

  async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const token = await this.getValidToken();
    const url = path.startsWith("http")
      ? path
      : `${GMAIL_API_BASE}/users/me${path}`;

    const response = await this.fetchWithRetry(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (response.status === 401) {
      // Token might have been revoked — force refresh through the mutex
      await this.forceRefresh(token);
      const retryToken = this.tokenInfo.accessToken;
      const retry = await this.fetchWithRetry(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${retryToken}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });
      if (!retry.ok) {
        throw new GmailApiError(retry.status, await retry.text());
      }
      if (retry.status === 204) return undefined as T;
      return retry.json();
    }

    if (!response.ok) {
      throw new GmailApiError(response.status, await response.text());
    }

    if (response.status === 204) return undefined as T;
    return response.json();
  }

  /** Refresh a rejected token through the same mutex used for expiry. */
  private async forceRefresh(invalidToken: string): Promise<void> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshToken(invalidToken).finally(() => {
        this.refreshPromise = null;
      });
    }
    await this.refreshPromise;
  }

  /**
   * Run many Gmail calls through the batch endpoint, at most GMAIL_BATCH_LIMIT per HTTP request.
   * Results come back in call order. Calls rejected for quota (429, or 403 rateLimitExceeded) are retried
   * on their own with backoff; other per-call failures are returned as `error` without failing the rest.
   */
  async batch<T = unknown>(calls: GmailBatchCall[]): Promise<GmailBatchResult<T>[]> {
    const results: GmailBatchResult<T>[] = new Array(calls.length);
    if (calls.length === 1) {
      const call = calls[0]!;
      try {
        const body = await this.request<T>(call.path, { method: call.method ?? "GET", ...(call.body !== undefined ? { body: JSON.stringify(call.body) } : {}) });
        results[0] = { status: 200, body };
      } catch (error) {
        if (!(error instanceof GmailApiError)) throw error;
        results[0] = { status: error.status, error };
      }
      return results;
    }
    // Each HTTP request carries at most 50 calls and at most one quota burst of units, so a batch never
    // leaves the account in quota debt long enough to stall an interactive request behind it.
    for (let next = 0; next < calls.length; ) {
      const indices: number[] = [];
      let cost = 0;
      while (next < calls.length && indices.length < GMAIL_BATCH_LIMIT) {
        const callCost = this.callCost(calls[next]!);
        if (indices.length > 0 && cost + callCost > GMAIL_BURST_UNITS) break;
        indices.push(next++);
        cost += callCost;
      }
      await this.runBatch(calls, indices, results);
    }
    return results;
  }

  private callCost(call: GmailBatchCall): number {
    return gmailRequestCost(`${GMAIL_API_BASE}/users/me${call.path}`, call.method ?? "GET");
  }

  private async runBatch<T>(calls: GmailBatchCall[], indices: number[], results: GmailBatchResult<T>[]): Promise<void> {
    let pending = indices;
    let refreshed = false;
    for (let attempt = 0; pending.length > 0; ) {
      const token = await this.getValidToken();
      const boundary = `suitemail_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      const body = buildBatchBody(boundary, pending.map((i) => ({ ...calls[i]!, id: `item-${i}` })));
      const cost = pending.reduce((sum, i) => sum + this.callCost(calls[i]!), 0);
      await waitForGmailQuota(this.accountId, cost);
      const response = await this.fetch(GMAIL_BATCH_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/mixed; boundary=${boundary}` },
        body,
      });
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        await this.forceRefresh(token);
        continue;
      }
      if (await isGmailRateLimit(response)) {
        attempt++;
        const delayMs = retryAfterMs(response.headers.get("Retry-After")) ?? (response.status === 403 ? 60_000 : INITIAL_BACKOFF_MS) * Math.pow(2, attempt - 1);
        pauseGmailQuota(this.accountId, delayMs);
        if (attempt >= MAX_RETRY_ATTEMPTS) throw new GmailApiError(response.status, await response.text());
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      if (!response.ok) throw new GmailApiError(response.status, await response.text());
      const parsed = parseBatchResponse(response.headers.get("Content-Type") ?? "", await response.text());
      const retry: number[] = [];
      let unauthorized = false;
      let quotaLimited = false;
      for (const i of pending) {
        const item = parsed.get(`item-${i}`);
        if (!item) { retry.push(i); continue; }
        if (item.status === 429 || (item.status === 403 && isGmailRateLimitBody(parseJson(item.body)))) { quotaLimited = true; retry.push(i); continue; }
        if (item.status === 401 && !refreshed) { unauthorized = true; retry.push(i); continue; }
        results[i] = item.status >= 200 && item.status < 300
          ? { status: item.status, body: parseJson(item.body) as T }
          : { status: item.status, error: new GmailApiError(item.status, item.body) };
      }
      if (!retry.length) return;
      attempt++;
      if (attempt >= MAX_RETRY_ATTEMPTS) {
        for (const i of retry) results[i] = { status: 429, error: new GmailApiError(429, "Rate limited inside a batch request") };
        return;
      }
      if (unauthorized) { refreshed = true; await this.forceRefresh(token); }
      if (quotaLimited) {
        const delayMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        pauseGmailQuota(this.accountId, delayMs);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      pending = retry;
    }
  }

  /** Fetch many threads in batches. 404 (deleted) threads map to null; any other failure throws. */
  async getThreads(threadIds: string[], format: "full" | "metadata" | "minimal" = "full"): Promise<Map<string, GmailThread | null>> {
    return this.getMany<GmailThread>(threadIds, (id) => `/threads/${encodeURIComponent(id)}?format=${format}`);
  }

  /** Fetch many messages in batches. 404 (deleted) messages map to null; any other failure throws. */
  async getMessages(messageIds: string[], format: "full" | "metadata" | "minimal" | "raw" = "full"): Promise<Map<string, GmailMessage | null>> {
    return this.getMany<GmailMessage>(messageIds, (id) => `/messages/${encodeURIComponent(id)}?format=${format}`);
  }

  private async getMany<T>(ids: string[], path: (id: string) => string): Promise<Map<string, T | null>> {
    const unique = [...new Set(ids)];
    const results = await this.batch<T>(unique.map((id) => ({ path: path(id) })));
    const found = new Map<string, T | null>();
    unique.forEach((id, i) => {
      const result = results[i]!;
      if (result.status === 404) found.set(id, null);
      else if (result.error) throw result.error;
      else found.set(id, result.body ?? null);
    });
    return found;
  }

  /** Add/remove labels on up to 1,000 messages per request (50 quota units each). */
  async batchModifyMessages(messageIds: string[], addLabelIds?: string[], removeLabelIds?: string[]): Promise<void> {
    const ids = [...new Set(messageIds)];
    for (let start = 0; start < ids.length; start += BATCH_MODIFY_LIMIT) {
      await this.request("/messages/batchModify", {
        method: "POST",
        body: JSON.stringify({ ids: ids.slice(start, start + BATCH_MODIFY_LIMIT), addLabelIds, removeLabelIds }),
      });
    }
  }

  private modifyQueue: QueuedModify[] = [];
  private modifyTimer: ReturnType<typeof setTimeout> | null = null;

  private async flushModifies(): Promise<void> {
    this.modifyTimer = null;
    const queued = this.modifyQueue.splice(0);
    if (queued.length === 1) {
      const item = queued[0]!;
      this.request<GmailThread>(`/threads/${item.threadId}/modify`, {
        method: "POST",
        body: JSON.stringify({ addLabelIds: item.addLabelIds, removeLabelIds: item.removeLabelIds }),
      }).then(item.resolve, item.reject);
      return;
    }
    try {
      const results = await this.batch<GmailThread>(queued.map((item) => ({
        method: "POST" as const,
        path: `/threads/${item.threadId}/modify`,
        body: { addLabelIds: item.addLabelIds, removeLabelIds: item.removeLabelIds },
      })));
      queued.forEach((item, i) => {
        const result = results[i]!;
        if (result.error) item.reject(result.error);
        else item.resolve(result.body as GmailThread);
      });
    } catch (error) {
      for (const item of queued) item.reject(error);
    }
  }

  async getProfile(): Promise<{ emailAddress: string; messagesTotal: number; threadsTotal: number; historyId: string }> {
    return this.request("/profile");
  }

  async listLabels(): Promise<{ labels: GmailLabel[] }> {
    return this.request("/labels");
  }

  async listThreads(params: {
    labelIds?: string[];
    maxResults?: number;
    pageToken?: string;
    q?: string;
  } = {}): Promise<{ threads?: GmailThreadStub[]; nextPageToken?: string; resultSizeEstimate?: number }> {
    const searchParams = new URLSearchParams();
    if (params.labelIds) searchParams.set("labelIds", params.labelIds.join(","));
    if (params.maxResults) searchParams.set("maxResults", String(params.maxResults));
    if (params.pageToken) searchParams.set("pageToken", params.pageToken);
    if (params.q) searchParams.set("q", params.q);
    const qs = searchParams.toString();
    return this.request(`/threads${qs ? `?${qs}` : ""}`);
  }

  async getThread(threadId: string, format: "full" | "metadata" | "minimal" = "full"): Promise<GmailThread> {
    return this.request(`/threads/${threadId}?format=${format}`);
  }

  async getMessage(messageId: string, format: "full" | "metadata" | "minimal" | "raw" = "full"): Promise<GmailMessage> {
    return this.request(`/messages/${messageId}?format=${format}`);
  }

  /**
   * Change a thread's labels. Calls made within a few milliseconds of each other (e.g. archiving a
   * multi-selection) are sent together as one batch request; each caller still gets its own result.
   */
  async modifyThread(threadId: string, addLabelIds?: string[], removeLabelIds?: string[]): Promise<GmailThread> {
    return new Promise<GmailThread>((resolve, reject) => {
      this.modifyQueue.push({ threadId, addLabelIds, removeLabelIds, resolve, reject });
      if (!this.modifyTimer) this.modifyTimer = setTimeout(() => void this.flushModifies(), MODIFY_COALESCE_MS);
    });
  }

  async getHistory(
    startHistoryId: string,
    historyTypes: string[] = ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"],
    pageToken?: string,
  ): Promise<{
    history?: GmailHistoryItem[];
    historyId: string;
    nextPageToken?: string;
  }> {
    const params = new URLSearchParams({ startHistoryId });
    for (const ht of historyTypes) {
      params.append("historyTypes", ht);
    }
    if (pageToken) {
      params.set("pageToken", pageToken);
    }
    return this.request(`/history?${params.toString()}`);
  }

  /**
   * Create a new user label.
   */
  async createLabel(name: string, color?: { textColor: string; backgroundColor: string }): Promise<GmailLabel> {
    const body: Record<string, unknown> = {
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    };
    if (color) body.color = color;
    return this.request("/labels", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  /**
   * Update an existing label's name and/or color.
   */
  async updateLabel(labelId: string, updates: { name?: string; color?: { textColor: string; backgroundColor: string } | null }): Promise<GmailLabel> {
    const body: Record<string, unknown> = {};
    if (updates.name !== undefined) body.name = updates.name;
    if (updates.color !== undefined) body.color = updates.color;
    return this.request(`/labels/${labelId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  /**
   * Delete a user label.
   */
  async deleteLabel(labelId: string): Promise<void> {
    const token = await this.getValidToken();
    const url = `${GMAIL_API_BASE}/users/me/labels/${labelId}`;
    const response = await this.fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`Gmail API error: ${response.status} ${await response.text()}`);
    }
  }

  /**
   * Permanently delete a thread (cannot be undone).
   * Used when deleting from Trash.
   */
  async deleteThread(threadId: string): Promise<void> {
    const token = await this.getValidToken();
    const url = `${GMAIL_API_BASE}/users/me/threads/${threadId}`;
    const response = await this.fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`Gmail API error: ${response.status} ${await response.text()}`);
    }
  }

  /**
   * Send an email via Gmail API.
   * Accepts a raw RFC 2822 message encoded as base64url.
   */
  async sendMessage(raw: string, threadId?: string): Promise<GmailMessage> {
    const body: Record<string, string> = { raw };
    if (threadId) body.threadId = threadId;
    return this.request("/messages/send", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  /**
   * Fetch a message attachment's binary data.
   * Returns base64url-encoded data.
   */
  async getAttachment(messageId: string, attachmentId: string): Promise<{ attachmentId: string; size: number; data: string }> {
    return this.request(`/messages/${messageId}/attachments/${attachmentId}`);
  }

  /**
   * Create a draft in Gmail.
   */
  async createDraft(raw: string, threadId?: string): Promise<{ id: string; message: GmailMessage }> {
    const message: Record<string, string> = { raw };
    if (threadId) message.threadId = threadId;
    return this.request("/drafts", {
      method: "POST",
      body: JSON.stringify({ message }),
    });
  }

  /**
   * Update an existing draft.
   */
  async updateDraft(draftId: string, raw: string, threadId?: string): Promise<{ id: string; message: GmailMessage }> {
    const message: Record<string, string> = { raw };
    if (threadId) message.threadId = threadId;
    return this.request(`/drafts/${draftId}`, {
      method: "PUT",
      body: JSON.stringify({ message }),
    });
  }

  /**
   * Delete a draft.
   */
  async deleteDraft(draftId: string): Promise<void> {
    await this.request(`/drafts/${draftId}`, { method: "DELETE" });
  }

  /**
   * List drafts. Returns draft stubs with draft ID and message ID/threadId.
   */
  async listDrafts(): Promise<{ id: string; message: { id: string; threadId: string } }[]> {
    const resp = await this.request<{ drafts?: { id: string; message: { id: string; threadId: string } }[] }>("/drafts?maxResults=500");
    return resp.drafts ?? [];
  }
}

// Gmail API types
export interface GmailLabel {
  id: string;
  name: string;
  type: "system" | "user";
  messageListVisibility?: "show" | "hide";
  labelListVisibility?: "labelShow" | "labelShowIfUnread" | "labelHide";
  messagesTotal?: number;
  messagesUnread?: number;
  threadsTotal?: number;
  threadsUnread?: number;
  color?: { textColor: string; backgroundColor: string };
}

export interface GmailThreadStub {
  id: string;
  snippet: string;
  historyId: string;
}

export interface GmailThread {
  id: string;
  historyId: string;
  messages: GmailMessage[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  historyId: string;
  internalDate: string;
  payload: GmailMessagePart;
  sizeEstimate: number;
}

export interface GmailMessagePart {
  partId: string;
  mimeType: string;
  filename: string;
  headers: GmailHeader[];
  body: { attachmentId?: string; size: number; data?: string };
  parts?: GmailMessagePart[];
}

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailHistoryItem {
  id: string;
  messages?: GmailMessage[];
  messagesAdded?: { message: GmailMessage }[];
  messagesDeleted?: { message: GmailMessage }[];
  labelsAdded?: { message: GmailMessage; labelIds: string[] }[];
  labelsRemoved?: { message: GmailMessage; labelIds: string[] }[];
}
