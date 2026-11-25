import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createStartupTelemetry } from './telemetry.js';

test('startup diagnostics require persisted consent and report one result per packaged launch', async (t) => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'suitemail-telemetry-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const calls = [];
  const launch = (packaged = true) => createStartupTelemetry({
    userData,
    packaged,
    version: '1.2.3',
    platform: 'win32',
    fetchImpl: async (_url, options) => calls.push(JSON.parse(options.body)),
  });

  const firstLaunch = launch();
  assert.equal(firstLaunch.enabled, false);
  assert.equal(firstLaunch.shouldPrompt, true);
  assert.equal(launch(false).shouldPrompt, false);
  await firstLaunch.record('ready');
  assert.equal(firstLaunch.setEnabled(true), true);
  await firstLaunch.record('ready');
  await launch(false).record('ready');
  assert.deepEqual(calls, []);

  const nextLaunch = launch();
  assert.equal(nextLaunch.enabled, true);
  assert.equal(nextLaunch.shouldPrompt, false);
  await nextLaunch.record('failed');
  await nextLaunch.record('ready');
  assert.deepEqual(calls, [{ result: 'failed', version: '1.2.3', platform: 'win32' }]);

  const revoked = launch();
  assert.equal(revoked.setEnabled(false), false);
  await revoked.record('ready');
  const afterRevocation = launch();
  assert.equal(afterRevocation.shouldPrompt, false);
  await afterRevocation.record('ready');
  assert.equal(calls.length, 1);
});

test('declining the initial prompt persists without sharing diagnostics', async (t) => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'suitemail-telemetry-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const fetchImpl = t.mock.fn();
  const launch = () => createStartupTelemetry({ userData, packaged: true, fetchImpl });

  const firstLaunch = launch();
  assert.equal(firstLaunch.shouldPrompt, true);
  assert.equal(firstLaunch.setEnabled(false), false);

  const nextLaunch = launch();
  assert.equal(nextLaunch.shouldPrompt, false);
  assert.equal(nextLaunch.enabled, false);
  await nextLaunch.record('ready');
  assert.equal(fetchImpl.mock.callCount(), 0);
});
