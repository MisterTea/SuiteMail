import{afterEach,describe,it,expect,vi}from'vitest';
import{gmailRequestCost,waitForGmailQuota,pauseGmailQuota,isGmailRateLimit,retryAfterMs}from'./quota';
afterEach(()=>vi.useRealTimers());
describe('Gmail quota handling',()=>{
 it('accounts for current full-thread cost and leaves Calendar requests separate',()=>{
  expect(gmailRequestCost('https://www.googleapis.com/gmail/v1/users/me/threads/t?format=full')).toBe(120);
  expect(gmailRequestCost('https://www.googleapis.com/gmail/v1/users/me/threads/t?format=metadata')).toBe(40);
  expect(gmailRequestCost('https://www.googleapis.com/gmail/v1/users/me/messages/m?format=raw')).toBe(60);
  expect(gmailRequestCost('https://www.googleapis.com/calendar/v3/calendars')).toBe(0);
 });
 it('spaces concurrent full-thread downloads instead of bursting through the per-user quota',async()=>{
  vi.useFakeTimers();const done:number[]=[];
  const pending=[1,2,3].map(i=>waitForGmailQuota('pace',120).then(()=>{done.push(i);}));
  await vi.advanceTimersByTimeAsync(0);expect(done).toEqual([1]);
  await vi.advanceTimersByTimeAsync(2999);expect(done).toEqual([1]);
  await vi.advanceTimersByTimeAsync(1);expect(done).toEqual([1,2]);
  await vi.advanceTimersByTimeAsync(3000);await Promise.all(pending);expect(done).toEqual([1,2,3]);
 });
 it('respects a server cooldown without releasing all waiting requests together',async()=>{
  vi.useFakeTimers();await waitForGmailQuota('cool',120);const done:number[]=[];
  const a=waitForGmailQuota('cool',120).then(()=>{done.push(1);});const b=waitForGmailQuota('cool',120).then(()=>{done.push(2);});
  pauseGmailQuota('cool',60000);await vi.advanceTimersByTimeAsync(59999);expect(done).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);expect(done).toEqual([1]);await vi.advanceTimersByTimeAsync(3000);await Promise.all([a,b]);expect(done).toEqual([1,2]);
 });
 it('does not block a different account behind another account cooldown',async()=>{
  vi.useFakeTimers();pauseGmailQuota('limited',60000);await waitForGmailQuota('separate',120);
 });
 it('distinguishes quota 403 from denied access and supports modern ErrorInfo reasons',async()=>{
  const response=(reason:string)=>new Response(JSON.stringify({error:{details:[{reason}]}}),{status:403});
  expect(await isGmailRateLimit(response('RATE_LIMIT_EXCEEDED'))).toBe(true);
  expect(await isGmailRateLimit(response('ACCESS_DENIED'))).toBe(false);
  expect(await isGmailRateLimit(new Response(JSON.stringify({error:{errors:[{reason:'userRateLimitExceeded'}]}}),{status:403}))).toBe(true);
 });
 it('parses both Retry-After formats and ignores malformed values',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-21T15:00:00Z'));
  expect(retryAfterMs('2')).toBe(2000);expect(retryAfterMs('Sat, 21 Nov 2026 15:01:00 GMT')).toBe(60000);expect(retryAfterMs('bad')).toBeUndefined();
 });
});
