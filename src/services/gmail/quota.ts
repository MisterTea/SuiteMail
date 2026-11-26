// Gmail allows 6,000 quota units per user per minute. SuiteMail budgets 4,500 units/minute with a 1,000-unit
// burst, so even a full burst plus a minute of steady use stays under the limit and leaves room for another device.
// https://developers.google.com/workspace/gmail/api/reference/quota
export const GMAIL_UNITS_PER_MINUTE = 4500;
export const GMAIL_BURST_UNITS = 1000;
const UNITS_PER_MS = GMAIL_UNITS_PER_MINUTE / 60_000;

/** Quota units Gmail charges for one REST call (0 for non-Gmail URLs such as Calendar). */
export function gmailRequestCost(url: string, method = 'GET'): number {
  const parsed = new URL(url, 'https://www.googleapis.com');
  if (!parsed.pathname.startsWith('/gmail/v1/')) return 0;
  const resource = parsed.pathname.replace(/^.*\/users\/[^/]+/, '');
  const format = parsed.searchParams.get('format') || '';
  const light = format === 'metadata' || format === 'minimal';
  if (method === 'GET') {
    if (/^\/threads\/[^/]+$/.test(resource)) return light ? 40 : 120;
    if (resource === '/threads') return 10;
    if (/\/attachments\//.test(resource)) return 20;
    if (/^\/messages\/[^/]+$/.test(resource)) return light ? 20 : 60;
    if (/^\/drafts\/[^/]+$/.test(resource)) return light ? 20 : 60;
    if (resource === '/history') return 2;
    if (resource === '/messages' || resource === '/drafts') return 5;
    return 1; // profile, labels, settings reads
  }
  if (resource === '/messages/batchModify' || resource === '/messages/batchDelete') return 50;
  if (resource === '/messages/send' || resource === '/drafts/send') return 100;
  if (/^\/threads\/[^/]+\/modify$/.test(resource)) return 10;
  if (/^\/threads\/[^/]+\/(trash|untrash)$/.test(resource)) return resource.endsWith('/untrash') ? 10 : 20;
  if (/^\/threads\/[^/]+$/.test(resource)) return 20; // threads.delete
  if (/^\/messages\/[^/]+\/modify$/.test(resource)) return 5;
  if (/^\/messages\/[^/]+\/trash$/.test(resource)) return 20;
  if (/^\/messages\/[^/]+$/.test(resource)) return 10; // messages.delete
  if (resource === '/drafts') return 10;
  if (/^\/drafts\/[^/]+$/.test(resource)) return method === 'PUT' ? 15 : 10;
  if (resource === '/watch' || resource === '/stop') return 100;
  return 5; // labels and settings writes
}

interface Bucket { tokens: number; updatedAt: number }
const buckets = new Map<string, Bucket>();
const cooldownUntil = new Map<string, number>();
const reservations = new Map<string, Promise<void>>();

function refill(accountId: string, now: number): Bucket {
  const bucket = buckets.get(accountId) ?? { tokens: GMAIL_BURST_UNITS, updatedAt: now };
  if (now > bucket.updatedAt) {
    bucket.tokens = Math.min(GMAIL_BURST_UNITS, bucket.tokens + (now - bucket.updatedAt) * UNITS_PER_MS);
    bucket.updatedAt = now;
  }
  buckets.set(accountId, bucket);
  return bucket;
}

/**
 * Wait until `cost` units are available for this account (token bucket, FIFO per account).
 * A request costing more than the burst (e.g. a 50-call batch) waits for a full bucket and then
 * borrows the rest, so later requests wait for the debt to refill and the average rate is unchanged.
 */
export async function waitForGmailQuota(accountId: string, cost: number): Promise<void> {
  if (!cost) return;
  const previous = reservations.get(accountId) || Promise.resolve();
  const reservation = previous.then(async () => {
    // Recheck after every wait: a response on another request may start a cooldown.
    while (true) {
      const now = Date.now();
      const cooldown = cooldownUntil.get(accountId) || 0;
      if (cooldown > now) { await new Promise(resolve => setTimeout(resolve, cooldown - now)); continue; }
      const bucket = refill(accountId, now);
      const needed = Math.min(cost, GMAIL_BURST_UNITS);
      if (bucket.tokens >= needed) { bucket.tokens -= cost; return; }
      await new Promise(resolve => setTimeout(resolve, Math.ceil((needed - bucket.tokens) / UNITS_PER_MS)));
    }
  });
  reservations.set(accountId, reservation.catch(() => {}));
  await reservation;
}

/** Stop all requests for this account until `delayMs` from now, then resume at the steady rate (no burst). */
export function pauseGmailQuota(accountId: string, delayMs: number): void {
  const until = Date.now() + delayMs;
  cooldownUntil.set(accountId, Math.max(until, cooldownUntil.get(accountId) || 0));
  buckets.set(accountId, { tokens: 0, updatedAt: cooldownUntil.get(accountId)! });
}

export async function isGmailRateLimit(response: Response): Promise<boolean> {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;
  try {
    return isGmailRateLimitBody(await response.clone().json());
  } catch { return false; }
}

/** True when a 403 error body is a quota error rather than denied access. */
export function isGmailRateLimitBody(body: unknown): boolean {
  const error = (body as { error?: { errors?: { reason?: string }[]; details?: { reason?: string }[] } } | null)?.error;
  const reasons = [...(error?.errors || []), ...(error?.details || [])].map(e => e.reason);
  return reasons.some(reason => ['rateLimitExceeded', 'userRateLimitExceeded', 'RATE_LIMIT_EXCEEDED'].includes(reason || ''));
}

export function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}
