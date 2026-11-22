/** Shared transport for the bug button and startup reports. */
export const DEFAULT_BUGCATCHER_URL = 'https://suiteleaf-bugcatcher.jgmath2000.workers.dev';

export async function submitBugcatcherReport(url, report, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`${url}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) {
      return { success: false, error: body.error ?? `Report failed (HTTP ${res.status}).` };
    }
    return { success: true, number: body.number };
  } catch {
    return { success: false, error: 'Could not reach the report service. Check your connection and try again.' };
  }
}
