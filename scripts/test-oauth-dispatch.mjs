// Run after npm run build:rust. Exercises the real IPC dispatcher and HTTP form.
import assert from 'node:assert/strict';
import http from 'node:http';
import { loadSupermailCore } from '../electron/loadAddon.js';

const core = loadSupermailCore();
const forms = [];
const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  forms.push(new URLSearchParams(body));
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ access_token: 'test-access', expires_in: forms.length % 2 ? '3600' : 3600, token_type: 'Bearer' }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const tokenUrl = `http://127.0.0.1:${server.address().port}/token`;
  for (const snakeCase of [false, true]) {
    for (const command of ['oauth_refresh_token', 'oauth_exchange_token']) {
      const fields = { tokenUrl, clientId: 'client', clientSecret: 'secret', refreshToken: 'refresh', redirectUri: 'http://localhost', codeVerifier: 'verifier', code: 'code', resource: 'https://outlook.office365.com/' };
      const args = Object.fromEntries(Object.entries(fields).map(([key, value]) => [snakeCase ? key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`) : key, value]));
      const result = JSON.parse(await core.invoke(command, JSON.stringify(args)));
      assert.equal(result.access_token, 'test-access');
      assert.equal(result.expires_in, 3600);
      const form = forms.at(-1);
      assert.equal(form.get('client_id'), 'client');
      assert.equal(form.get('client_secret'), 'secret');
      assert.equal(form.get('resource'), fields.resource);
      if (command === 'oauth_refresh_token') {
        assert.equal(form.get('refresh_token'), 'refresh');
        assert.equal(form.get('grant_type'), 'refresh_token');
      } else {
        assert.equal(form.get('code_verifier'), 'verifier');
        assert.equal(form.get('redirect_uri'), 'http://localhost');
        assert.equal(form.get('grant_type'), 'authorization_code');
      }
    }
  }
  console.log('OAuth exchange and refresh passed for camelCase and snake_case arguments.');
} finally {
  server.close();
}
