import { dashboard } from './dashboard.js';

const maxPayloadSize = 256;
const results = new Set(['ready', 'failed']);
const platforms = new Set(['win32', 'darwin', 'linux', 'android']);
const versionPattern = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[a-z0-9.-]{1,24})?$/i;

async function readEvent(body) {
  if (!body) return null;
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxPayloadSize) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    const event = JSON.parse(text + decoder.decode());
    if (event && Object.keys(event).length === 3 && results.has(event.result)
      && platforms.has(event.platform) && typeof event.version === 'string'
      && versionPattern.test(event.version)) return event;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/dashboard') return dashboard(request, env, url);
    if (url.pathname !== '/v1/startup') return new Response(null, { status: 404 });
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
      return new Response(null, { status: 415 });
    }
    if (Number(request.headers.get('content-length')) > maxPayloadSize) return new Response(null, { status: 413 });

    const { success } = await env.RATE_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'unknown' });
    if (!success) return new Response(null, { status: 429 });

    const event = await readEvent(request.body);
    if (!event) return new Response(null, { status: 400 });

    await env.DB.prepare(`
      INSERT INTO daily_startups (day, result, version, platform) VALUES (date('now'), ?, ?, ?)
      ON CONFLICT (day, result, version, platform) DO UPDATE SET count = count + 1
    `).bind(event.result, event.version, event.platform).run();
    return new Response(null, { status: 204 });
  },

  async scheduled(_controller, env) {
    await env.DB.prepare("DELETE FROM daily_startups WHERE day < date('now', '-89 days')").run();
  },
};
