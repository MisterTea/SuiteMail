// Exercise the real Electron startup with isolated account storage.
import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const cache = path.resolve('node_modules/.cache');
await mkdir(cache, { recursive: true });
const fixture = await mkdtemp(path.join(cache, 'startup-test-'));
const mainURL = pathToFileURL(path.resolve('electron/main.js')).href;
try {
  for (const scenario of ['healthy', 'failed-load', 'stalled']) {
    const userData = await mkdtemp(path.join(os.tmpdir(), 'suitemail-startup-'));
    const entry = path.join(fixture, `${scenario}.mjs`);
    await writeFile(entry, `
      import { app, BrowserWindow, dialog } from 'electron';
      app.setPath('userData', ${JSON.stringify(userData)});
      globalThis.startupErrors = [];
      dialog.showMessageBox = async (_parent, options) => {
        globalThis.startupErrors.push(options);
        return new Promise(() => {});
      };
      const loadFile = BrowserWindow.prototype.loadFile;
      BrowserWindow.prototype.loadFile = function(file, ...args) {
        if (file.endsWith('/dist/index.html') && ${JSON.stringify(scenario)} !== 'healthy') {
          if (${JSON.stringify(scenario)} === 'failed-load') return Promise.reject(new Error('Test: missing page'));
          return new Promise(() => {});
        }
        return loadFile.call(this, file, ...args);
      };
      await import(${JSON.stringify(mainURL)});
    `);
    let app;
    try {
      app = await electron.launch({ args: [entry], env: { ...process.env, NODE_ENV: 'production' } });
      if (scenario === 'healthy') {
        const page = app.windows().find(page => page.url().includes('/dist/index.html')) || await app.waitForEvent('window', {
          predicate: page => page.url().includes('/dist/index.html'),
        }).catch(() => app.windows().find(page => page.url().includes('/dist/index.html')));
        assert.ok(page, 'Main window should load');
        await page.locator('#root').filter({ hasText: /SuiteMail/ }).waitFor({ timeout: 15000 });
        await page.waitForTimeout(5500);
        assert.equal(await app.evaluate(() => globalThis.startupErrors.length), 0);
        assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1, 'Splash should close');
      } else {
        await app.firstWindow();
        const deadline = Date.now() + 8000;
        let errors = [];
        while (Date.now() < deadline) {
          errors = await app.evaluate(() => globalThis.startupErrors);
          if (errors.length) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.equal(errors.length, 1, 'Startup must display one helpful error');
        assert.match(errors[0].detail, scenario === 'stalled' ? /five seconds/ : /missing page/);
        assert.deepEqual(errors[0].buttons, ['Restart SuiteMail', 'Report Bug', 'Quit']);
      }
      console.log(`PASS ${scenario}`);
    } finally {
      if (app) {
        await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
        await app.close().catch(() => {});
      }
      await rm(userData, { recursive: true, force: true });
    }
  }
} finally {
  await rm(fixture, { recursive: true, force: true });
}
