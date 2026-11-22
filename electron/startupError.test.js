import { test } from 'node:test';
import assert from 'node:assert/strict';
import { showStartupError } from './startupError.js';
import { DEFAULT_BUGCATCHER_URL } from './bugcatcher.js';

function fixture(responses, capture = async () => ({ isEmpty: () => false, toDataURL: () => 'data:image/png;base64,test' })) {
  const messages = [];
  const events = [];
  const window = { isDestroyed: () => false, webContents: { capturePage: async () => { events.push('capture'); return capture(); } } };
  return {
    messages, events,
    options: {
      app: { getVersion: () => '0.1.0' }, window, getParent: () => window, detail: 'Test startup failure',
      dialog: { showMessageBox: async (_parent, message) => { events.push('dialog'); messages.push(message); return { response: responses.shift() }; } },
    },
  };
}

test('captures before offering a report; restart and quit never submit', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Must not submit without consent'); };
  try {
    for (const [response, action] of [[0, 'restart'], [2, 'quit']]) {
      const f = fixture([response]);
      assert.equal(await showStartupError(f.options), action);
      assert.deepEqual(f.events, ['capture', 'dialog']);
      assert.match(f.messages[0].detail, /screenshot/);
      assert.equal(f.messages[0].cancelId, 2);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('report button submits screenshot and error to Bugcatcher and confirms issue number', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...JSON.parse(options.body) });
    return { ok: true, json: async () => ({ success: true, number: 42 }) };
  };
  try {
    const f = fixture([1, 0]);
    assert.equal(await showStartupError(f.options), 'restart');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${process.env.VITE_BUGCATCHER_URL ?? DEFAULT_BUGCATCHER_URL}/report`);
    assert.equal(calls[0].type, 'bug');
    assert.equal(calls[0].screenshot, 'data:image/png;base64,test');
    assert.match(calls[0].text, /Test startup failure/);
    assert.match(calls[0].context, /startup.*0.1.0/);
    assert.match(f.messages[1].detail, /filed as #42/);
    assert.deepEqual(f.messages[1].buttons, ['Restart SuiteMail', 'Quit']);
  } finally { globalThis.fetch = originalFetch; }
});

test('failed reports remain available for retry with the same screenshot', async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, options) => {
    bodies.push(options.body);
    if (bodies.length === 1) throw new Error('offline');
    return { ok: true, json: async () => ({ success: true }) };
  };
  try {
    const f = fixture([1, 1, 1]);
    assert.equal(await showStartupError(f.options), 'quit');
    assert.match(f.messages[1].detail, /not been sent.*Report Bug/s);
    assert.equal(bodies[0], bodies[1]);
    assert.equal(f.events.filter(event => event === 'capture').length, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('unavailable or hung screenshot capture still offers error recovery', async () => {
  for (const capture of [async () => { throw new Error('renderer crashed'); }, () => new Promise(() => {})]) {
    const f = fixture([2], capture);
    assert.equal(await showStartupError(f.options), 'quit');
    assert.match(f.messages[0].detail, /screenshot could not be captured/);
  }
});
