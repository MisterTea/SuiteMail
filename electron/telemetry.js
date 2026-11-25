import fs from 'node:fs';
import path from 'node:path';

const endpoint = 'https://suitemail-telemetry.jgmath2000.workers.dev/v1/startup';

export function createStartupTelemetry({ userData, version, platform, packaged, fetchImpl = fetch }) {
  const consentFile = path.join(userData, '.telemetry-opt-in');
  const declinedFile = path.join(userData, '.telemetry-opt-out');
  const optedInAtLaunch = fs.existsSync(consentFile);
  let recorded = false;
  let pending;

  return {
    get enabled() { return fs.existsSync(consentFile); },
    get shouldPrompt() { return packaged && !this.enabled && !fs.existsSync(declinedFile); },
    setEnabled(enabled) {
      if (typeof enabled !== 'boolean') throw new Error('Expected a telemetry consent boolean');
      if (enabled) {
        fs.writeFileSync(consentFile, '', { mode: 0o600 });
      } else {
        fs.rmSync(consentFile, { force: true });
        pending?.abort();
        fs.writeFileSync(declinedFile, '', { mode: 0o600 });
      }
      return enabled;
    },
    async record(result) {
      if (recorded || !packaged || !optedInAtLaunch || !this.enabled) return;
      recorded = true;
      pending = new AbortController();
      try {
        await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ result, version, platform }),
          redirect: 'error',
          signal: AbortSignal.any([pending.signal, AbortSignal.timeout(3000)]),
        });
      } catch {
        // Diagnostics must not interfere with opening or closing the app.
      } finally {
        pending = undefined;
      }
    },
  };
}
