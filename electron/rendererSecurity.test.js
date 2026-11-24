import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createRendererSecurity, isExternalUrl } from './rendererSecurity.js';

test('only the app and its pop-outs receive access to desktop IPC', () => {
  let invoke;
  const opened = [];
  const security = createRendererSecurity({
    ipcMain: { handle: (_channel, handler) => { invoke = handler; } },
    appUrl: 'file:///app/dist/index.html',
    preload: '/app/electron/preload.cjs',
    openExternal: async (url) => opened.push(url),
  });
  const contents = () => Object.assign(new EventEmitter(), {
    setWindowOpenHandler(handler) { this.openWindow = handler; },
  });
  const main = contents();
  security.protect(main);
  security.handle('test', (_event, value) => value);
  const appFrame = { url: 'file:///app/dist/index.html#/settings', parent: null };
  assert.equal(invoke({ sender: main, senderFrame: appFrame }, 'ok'), 'ok');
  assert.throws(() => invoke({ sender: contents(), senderFrame: appFrame }), /Untrusted/);
  assert.throws(() => invoke({ sender: main, senderFrame: { ...appFrame, parent: appFrame } }), /Untrusted/);

  const popup = main.openWindow({ url: 'file:///app/dist/index.html?compose=true' });
  assert.equal(popup.action, 'allow');
  assert.equal(popup.overrideBrowserWindowOptions.webPreferences.preload, '/app/electron/preload.cjs');
  const child = contents();
  main.emit('did-create-window', { webContents: child });
  assert.equal(invoke({ sender: child, senderFrame: appFrame }, 'ok'), 'ok');

  assert.deepEqual(main.openWindow({ url: 'https://example.org/' }), { action: 'deny' });
  assert.deepEqual(opened, ['https://example.org/']);
  assert.equal(isExternalUrl('file:///app/dist/index.html'), false);
  assert.equal(isExternalUrl('mailto:hello@example.org'), true);
});
