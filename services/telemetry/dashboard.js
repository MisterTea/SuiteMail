const dashboardHeaders = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
const periods = [7, 30, 90];
const platformNames = { win32: 'Windows', darwin: 'macOS', linux: 'Linux', android: 'Android' };
const numberFormat = new Intl.NumberFormat('en-US');
const percentFormat = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });
const encoder = new TextEncoder();

async function matchesPassword(authorization, password) {
  const encoded = /^Basic +([a-z0-9+/]+={0,2})$/i.exec(authorization)?.[1];
  if (!encoded || encoded.length > 1024) return false;

  let credentials;
  try {
    credentials = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  } catch {
    return false;
  }

  const [actual, expected] = await Promise.all([
    crypto.subtle.digest('SHA-256', credentials),
    crypto.subtle.digest('SHA-256', encoder.encode(`admin:${password}`)),
  ]);
  return crypto.subtle.timingSafeEqual(actual, expected);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function failureRate(failed, reported) {
  return reported > 0 ? percentFormat.format(failed / reported) : '—';
}

function renderDashboard(rows, days) {
  const totals = rows.reduce((totals, row) => ({
    reported: totals.reported + row.reported,
    failed: totals.failed + row.failed,
  }), { reported: 0, failed: 0 });
  const periodLinks = periods.map((period) => (
    `<a href="/dashboard?days=${period}"${period === days ? ' aria-current="page"' : ''}>${period} days</a>`
  )).join('');
  const tableRows = rows.map(({ version, platform, reported, failed }) => `
        <tr>
          <td>${escapeHtml(version)}</td>
          <td>${escapeHtml(platformNames[platform] ?? platform)}</td>
          <td>${numberFormat.format(reported)}</td>
          <td>${numberFormat.format(reported - failed)}</td>
          <td>${numberFormat.format(failed)}</td>
          <td>${failureRate(failed, reported)}</td>
        </tr>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Startup diagnostics · SuiteMail</title>
  <style>
    :root { color-scheme: light; font: 100%/1.5 system-ui, sans-serif; background: #f3f7f6; color: #142d2a; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    main { max-width: 70rem; margin: auto; padding: clamp(1rem, 4vw, 3rem); }
    h1 { margin: 0; font-size: clamp(1.8rem, 5vw, 2.6rem); letter-spacing: -.045em; }
    p { margin: .35rem 0 0; color: #48615e; }
    header { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 1rem; }
    nav { display: flex; flex-wrap: wrap; gap: .25rem; padding: .25rem; }
    nav a { padding: .4rem .7rem; border-radius: .45rem; color: #254c46; font-weight: 600; text-decoration: none; }
    nav a:hover { background: #dcebe7; }
    nav a[aria-current] { background: #14574b; color: #fff; }
    :focus-visible { outline: .15rem solid #167868; outline-offset: .2rem; }
    dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr)); gap: .75rem; margin: 1.5rem 0; }
    dl div, .panel { background: #fff; border: 1px solid #d8e3df; border-radius: .65rem; }
    dl div { padding: .85rem 1rem; }
    dt { color: #48615e; }
    dd { margin: .15rem 0 0; font-size: 1.65rem; font-weight: 650; }
    .panel { overflow-x: auto; }
    table { border-collapse: collapse; width: 100%; white-space: nowrap; }
    caption { padding: .85rem 1rem; text-align: left; font-weight: 650; }
    th, td { text-align: left; padding: .65rem 1rem; border-top: 1px solid #d8e3df; }
    th { background: #e8f0ee; color: #254c46; }
    th:nth-child(n+3), td:nth-child(n+3) { text-align: right; }
    dd, td { font-variant-numeric: tabular-nums; }
    .empty { margin: 0; padding: 1rem; }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>SuiteMail startup diagnostics</h1>
        <p>Opt-in startup reports for the last ${days} days, including today (UTC).</p>
      </div>
      <nav aria-label="Reporting period">${periodLinks}</nav>
    </header>
    <dl>
      <div><dt>Reported launches</dt><dd>${numberFormat.format(totals.reported)}</dd></div>
      <div><dt>Failed launches</dt><dd>${numberFormat.format(totals.failed)}</dd></div>
      <div><dt>Failure rate</dt><dd>${failureRate(totals.failed, totals.reported)}</dd></div>
    </dl>
    ${rows.length ? `
    <div class="panel" role="region" aria-label="Startup reports by version and OS" tabindex="0">
      <table>
        <caption>By version and OS</caption>
        <thead><tr>
          <th scope="col">Version</th><th scope="col">OS</th><th scope="col">Reported</th>
          <th scope="col">Ready</th><th scope="col">Failed</th><th scope="col">Failure rate</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>` : '<div class="panel"><p class="empty">No startup reports in this period.</p></div>'}
  </main>
</body>
</html>`;
}

export async function dashboard(request, env, url) {
  const respond = (status, headers = {}, body = null) => new Response(body, {
    status,
    headers: { ...dashboardHeaders, ...headers },
  });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return respond(405, { Allow: 'GET, HEAD' });
  }
  if (!env.DASHBOARD_PASSWORD) return respond(503);

  const authorization = request.headers.get('Authorization');
  if (authorization) {
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const { success } = await env.RATE_LIMITER.limit({ key: `dashboard:${ip}` });
    if (!success) return respond(429);
  }
  if (!authorization || !await matchesPassword(authorization, env.DASHBOARD_PASSWORD)) {
    return respond(401, { 'WWW-Authenticate': 'Basic realm="SuiteMail diagnostics", charset="UTF-8"' });
  }

  const headers = { 'Content-Type': 'text/html; charset=utf-8' };
  if (request.method === 'HEAD') return respond(200, headers);

  const days = periods.find((period) => String(period) === url.searchParams.get('days')) ?? 30;
  const { results } = await env.DB.prepare(`
    SELECT version, platform, SUM(count) AS reported,
      SUM(CASE WHEN result = 'failed' THEN count ELSE 0 END) AS failed
    FROM daily_startups
    WHERE day >= date('now', ?)
    GROUP BY version, platform
    ORDER BY reported DESC, version DESC, platform
  `).bind(`-${days - 1} days`).all();
  return respond(200, headers, renderDashboard(results, days));
}
