import{afterEach,describe,it,expect,vi}from'vitest';
import{gmailRequestCost,waitForGmailQuota,pauseGmailQuota,isGmailRateLimit,retryAfterMs,GMAIL_BURST_UNITS,GMAIL_UNITS_PER_MINUTE}from'./quota';
afterEach(()=>vi.useRealTimers());
const msPerUnit=60_000/GMAIL_UNITS_PER_MINUTE;
describe('Gmail quota handling',()=>{
 it('uses Gmail per-method costs and leaves Calendar requests separate',()=>{
  const base='https://www.googleapis.com/gmail/v1/users/me';
  expect(gmailRequestCost(`${base}/threads/t?format=full`)).toBe(120);
  expect(gmailRequestCost(`${base}/threads/t?format=metadata`)).toBe(40);
  expect(gmailRequestCost(`${base}/threads/t?format=minimal`)).toBe(40);
  expect(gmailRequestCost(`${base}/messages/m?format=raw`)).toBe(60);
  expect(gmailRequestCost(`${base}/messages/m?format=metadata`)).toBe(20);
  expect(gmailRequestCost(`${base}/history?startHistoryId=1`)).toBe(2);
  expect(gmailRequestCost(`${base}/threads?maxResults=500`)).toBe(10);
  // Writes are no longer all charged as 100 units.
  expect(gmailRequestCost(`${base}/threads/t/modify`,'POST')).toBe(10);
  expect(gmailRequestCost(`${base}/messages/m/modify`,'POST')).toBe(5);
  expect(gmailRequestCost(`${base}/messages/batchModify`,'POST')).toBe(50);
  expect(gmailRequestCost(`${base}/messages/send`,'POST')).toBe(100);
  expect(gmailRequestCost(`${base}/threads/t`,'DELETE')).toBe(20);
  expect(gmailRequestCost(`${base}/drafts/d`,'PUT')).toBe(15);
  expect(gmailRequestCost('https://www.googleapis.com/calendar/v3/calendars')).toBe(0);
  expect(gmailRequestCost('https://www.googleapis.com/batch/gmail/v1','POST')).toBe(0); // Charged per call by the client.
 });
 it('lets a burst through immediately, then paces at the steady per-minute budget',async()=>{
  vi.useFakeTimers();const done:number[]=[];
  // Eight full-thread downloads (960 units) fit in the burst.
  const burst=Array.from({length:8},(_,i)=>waitForGmailQuota('burst',120).then(()=>{done.push(i);}));
  await vi.advanceTimersByTimeAsync(0);expect(done).toHaveLength(8);await Promise.all(burst);
  // 40 units remain; the next 120-unit request waits for 80 more units to refill.
  const next=waitForGmailQuota('burst',120).then(()=>{done.push(8);});
  await vi.advanceTimersByTimeAsync(Math.ceil(80*msPerUnit)-5);expect(done).toHaveLength(8);
  await vi.advanceTimersByTimeAsync(10);await next;expect(done).toHaveLength(9);
 });
 it('lets a request larger than the burst borrow, so later requests wait for the debt',async()=>{
  vi.useFakeTimers();
  await waitForGmailQuota('debt',3000); // e.g. a batch of 25 full threads
  let released=false;const next=waitForGmailQuota('debt',100).then(()=>{released=true;});
  // Bucket is at 1000-3000 = -2000; 100 units are available after 2100 units refill.
  await vi.advanceTimersByTimeAsync(Math.ceil(2100*msPerUnit)-5);expect(released).toBe(false);
  await vi.advanceTimersByTimeAsync(10);await next;expect(released).toBe(true);
 });
 it('respects a server cooldown and resumes without a burst',async()=>{
  vi.useFakeTimers();const done:number[]=[];
  pauseGmailQuota('cool',60000);
  const a=waitForGmailQuota('cool',120).then(()=>{done.push(1);});const b=waitForGmailQuota('cool',120).then(()=>{done.push(2);});
  await vi.advanceTimersByTimeAsync(59999);expect(done).toEqual([]);
  // After the cooldown the bucket starts empty: 120 units take 1.6 s each at 4,500/minute.
  await vi.advanceTimersByTimeAsync(1+Math.ceil(120*msPerUnit));expect(done).toEqual([1]);
  await vi.advanceTimersByTimeAsync(Math.ceil(120*msPerUnit));await Promise.all([a,b]);expect(done).toEqual([1,2]);
 });
 it('does not block a different account behind another account cooldown',async()=>{
  vi.useFakeTimers();pauseGmailQuota('limited',60000);await waitForGmailQuota('separate',GMAIL_BURST_UNITS);
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
