// Current Gmail quotas: 6,000 units/user/minute; full threads.get costs 120 units.
// Use 2,400 units/minute to leave room for interactive actions and another device.
// https://developers.google.com/workspace/gmail/api/reference/quota
const nextRequest = new Map<string, number>();
export function gmailRequestCost(url: string, method = 'GET'): number {
  const parsed = new URL(url);
  if (!parsed.pathname.startsWith('/gmail/v1/')) return 0;
  const resource = parsed.pathname.replace(/^.*\/users\/[^/]+/, '');
  if (method !== 'GET') return 100; // Conservative upper bound for mutations/send.
  if (/^\/threads\/[^/]+$/.test(resource)) return parsed.searchParams.get('format') === 'metadata' || parsed.searchParams.get('format') === 'minimal' ? 40 : 120;
  if (resource === '/threads') return 10;
  if (/\/attachments\//.test(resource)) return 20;
  if (/^\/messages\/[^/]+$/.test(resource)) return ['metadata','minimal'].includes(parsed.searchParams.get('format') || '') ? 20 : 60;
  if (/^\/drafts\/[^/]+$/.test(resource)) return 60;
  if (resource === '/history') return 2;
  if (resource === '/messages' || resource === '/drafts') return 5;
  return 1;
}
const reservations = new Map<string, Promise<void>>();
export async function waitForGmailQuota(accountId: string, cost: number): Promise<void> {
  if (!cost) return;
  const previous = reservations.get(accountId) || Promise.resolve();
  const reservation = previous.then(async () => {
    // Recheck after every wait: a response on another request may extend the cooldown.
    while (true) {
      const start = Math.max(nextRequest.get(accountId)||0, cooldownUntil.get(accountId)||0);
      const delay = start-Date.now();
      if (delay <= 0) break;
      await new Promise(resolve=>setTimeout(resolve,delay));
    }
    nextRequest.set(accountId,Date.now()+cost*25);
  });
  reservations.set(accountId,reservation.catch(()=>{}));
  await reservation;
}
const cooldownUntil = new Map<string,number>();
export function pauseGmailQuota(accountId: string, delayMs: number): void {
  const until = Date.now()+delayMs;
  cooldownUntil.set(accountId,Math.max(until,cooldownUntil.get(accountId)||0));
  nextRequest.set(accountId,Math.max(until,nextRequest.get(accountId)||0));
}
export async function isGmailRateLimit(response: Response): Promise<boolean> {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;
  try {
    const body=await response.clone().json();
    const reasons=[...(body.error?.errors || []).map((e:{reason?:string})=>e.reason),...(body.error?.details || []).map((e:{reason?:string})=>e.reason)];
    return reasons.some(reason=>['rateLimitExceeded','userRateLimitExceeded','RATE_LIMIT_EXCEEDED'].includes(reason));
  } catch { return false; }
}
export function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds=Number(value);
  const ms=Number.isFinite(seconds) ? seconds*1000 : Date.parse(value)-Date.now();
  return Number.isFinite(ms) && ms>=0 ? ms : undefined;
}
