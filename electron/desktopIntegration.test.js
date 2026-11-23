import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAutostart, createComposeShortcut, createMailtoQueue, backgroundWindow, cancelBackgrounding, desktopExecArg, queryGlobalShortcutPortal } from './desktopIntegration.js';

test('detects unsupported Wayland portals without treating missing diagnostic tools as a denial', async () => {
  assert.equal(await queryGlobalShortcutPortal(async () => ({ stdout: '<interface name="org.freedesktop.portal.GlobalShortcuts"/>' })), true);
  assert.equal(await queryGlobalShortcutPortal(async () => ({ stdout: '<interface name="org.freedesktop.portal.FileChooser"/>' })), false);
  assert.equal(await queryGlobalShortcutPortal(async () => { throw new Error('gdbus missing'); }), null);
});

test('Linux autostart uses XDG configuration, quotes AppImage paths, and persists across instances', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'suitemail-autostart-'));
  try {
    const env = { XDG_CONFIG_HOME: path.join(home, 'xdg'), APPIMAGE: '/home/test/Mail $ "special" 100%.AppImage' };
    const app = { isPackaged: true, getPath: () => '/unused/executable' };
    const options = { platform: 'linux', env, home };
    const startup = createAutostart(app, options);
    assert.equal(await startup.get(), false);
    assert.equal(await startup.set(true), true);
    const entry = await fs.readFile(path.join(env.XDG_CONFIG_HOME, 'autostart/com.suitemail.app.desktop'), 'utf8');
    assert.ok(entry.includes(`Exec=${desktopExecArg(env.APPIMAGE)} --hidden\n`));
    assert.ok(entry.includes('100%%.AppImage'));
    assert.equal(desktopExecArg('/home/Test User/SuiteMail.AppImage'), '"/home/Test User/SuiteMail.AppImage"');
    assert.equal(await createAutostart(app, options).get(), true);
    env.APPIMAGE_EXTRACT_AND_RUN = '1';
    await startup.set(true);
    assert.match(await fs.readFile(path.join(env.XDG_CONFIG_HOME, 'autostart/com.suitemail.app.desktop'), 'utf8'), /Exec=env APPIMAGE_EXTRACT_AND_RUN=1 /);
    assert.equal(await startup.set(false), false);
    assert.equal(await startup.set(false), false);
    await assert.rejects(createAutostart({ isPackaged: false }, options).set(true), /installed builds/);
    assert.throws(() => desktopExecArg('/bad\npath'), /Invalid/);
  } finally { await fs.rm(home, { recursive: true, force: true }); }
});

test('shortcut conflicts preserve the working binding; replacement and cleanup unregister it', () => {
  const bindings = new Map();
  let composed = 0;
  const shortcut = createComposeShortcut({
    register(key, callback) { if (key === 'taken') return false; bindings.set(key, callback); return true; },
    unregister(key) { bindings.delete(key); },
  }, () => composed++);
  shortcut.register('Control+M');
  assert.throws(() => shortcut.register('taken'), /Could not register/);
  bindings.get('Control+M')();
  assert.equal(composed, 1);
  shortcut.register('Control+N');
  assert.deepEqual([...bindings.keys()], ['Control+N']);
  shortcut.unregister();
  assert.equal(bindings.size, 0);
});

test('cold and warm mailto links are queued until ready and delivered exactly once', () => {
  const received = [];
  const queue = createMailtoQueue(['app', 'MAILTO:first@example.com'], url => received.push(url));
  queue.push(['--hidden', 'mailto:second@example.com']);
  assert.equal(queue.hasPending(), true);
  assert.deepEqual(received, []);
  queue.ready();
  queue.ready();
  queue.push(['mailto:third@example.com']);
  assert.deepEqual(received, ['MAILTO:first@example.com', 'mailto:second@example.com', 'mailto:third@example.com']);
});

test('Linux backgrounding remains reachable even when a tray object exists', async () => {
  const calls = [];
  const window = Object.fromEntries(['showInactive', 'minimize', 'hide'].map(name => [name, () => calls.push(name)]));
  window.isVisible = () => true;
  window.isDestroyed = () => false;
  await backgroundWindow(window, 'linux', true);
  assert.deepEqual(calls.splice(0), ['minimize']);
  await backgroundWindow(window, 'win32', false);
  assert.deepEqual(calls.splice(0), ['showInactive', 'minimize']);
  await backgroundWindow(window, 'win32', true);
  assert.deepEqual(calls, ['hide']);
});

test('hidden Linux startup maps its surface before minimizing; activation cancels a pending minimize', async () => {
  for (const activate of [false, true]) {
    const calls = [];
    let painted;
    const frame = new Promise(resolve => { painted = resolve; });
    const window = {
      isVisible: () => false, isDestroyed: () => false,
      show: () => calls.push('show'), minimize: () => calls.push('minimize'),
      webContents: { executeJavaScript: () => frame },
    };
    const pending = backgroundWindow(window, 'linux', true);
    assert.deepEqual(calls, ['show']);
    if (activate) cancelBackgrounding(window);
    painted();
    await pending;
    assert.deepEqual(calls, activate ? ['show'] : ['show', 'minimize']);
  }
});
