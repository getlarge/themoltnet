import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildManifest,
  createRequestHandler,
  ENVIRONMENT,
  PERMISSIONS,
  renderForm,
  REPOSITORY,
  storeCredentials,
} from './create-renovate-app.mjs';

test('manifest is private, webhook-free, and scoped for Renovate', () => {
  const manifest = buildManifest({
    name: 'themoltnet-renovate',
    redirectUrl: 'http://127.0.0.1:1234/callback',
  });
  assert.equal(REPOSITORY, 'getlarge/themoltnet');
  assert.equal(ENVIRONMENT, 'renovate');
  assert.equal(manifest.url, 'https://github.com/getlarge/themoltnet');
  assert.equal(manifest.public, false);
  assert.deepEqual(manifest.default_events, []);
  assert.equal(manifest.hook_attributes.active, false);
  assert.deepEqual(manifest.default_permissions, { ...PERMISSIONS });
  assert.equal(manifest.default_permissions.workflows, 'write');
  assert.equal(manifest.default_permissions.vulnerability_alerts, 'read');
});

test('manifest rejects names that could break the form', () => {
  assert.throws(
    () => buildManifest({ name: '"><script>', redirectUrl: 'x' }),
    /invalid app name/u,
  );
});

test('form escapes the manifest into a single attribute', () => {
  const html = renderForm({
    manifest: { name: 'a"b<c&d' },
    state: 'abc',
  });
  assert.match(
    html,
    /value="\{&quot;name&quot;:&quot;a\\&quot;b&lt;c&amp;d&quot;\}"/u,
  );
  assert.match(html, /settings\/apps\/new\?state=abc/u);
});

test('does not store credentials without a verified main-only Environment', () => {
  const calls = [];
  const lines = [];
  const stored = storeCredentials(
    { slug: 'themoltnet-renovate', client_id: 'client-id', pem: 'PRIVATE KEY' },
    (args, input) => {
      calls.push({ args, input });
      return { ok: true, output: 'false' };
    },
    (line) => lines.push(line),
  );
  assert.equal(stored, false);
  assert.equal(calls.length, 3);
  assert.equal(
    calls.some(({ args }) => args[0] === 'secret'),
    false,
  );
  assert.equal(
    calls.some(({ args }) => args[0] === 'variable'),
    false,
  );
  assert.deepEqual(lines, ['FAILED: main-only Environment\n']);
});

test('stores the private key only through secret stdin after policy verification', () => {
  const calls = [];
  const lines = [];
  const stored = storeCredentials(
    { slug: 'themoltnet-renovate', client_id: 'client-id', pem: 'PRIVATE KEY' },
    (args, input) => {
      calls.push({ args, input });
      return { ok: true, output: args.includes('--jq') ? 'true' : '' };
    },
    (line) => lines.push(line),
  );
  assert.equal(stored, true);
  assert.deepEqual(
    calls.map(({ args }) => args[0]),
    ['api', 'api', 'api', 'variable', 'variable', 'secret'],
  );
  assert.equal(calls[3].args.includes('RENOVATE_APP_BOT_LOGIN'), true);
  assert.equal(calls[3].args.includes('themoltnet-renovate[bot]'), true);
  assert.equal(calls[3].args.includes('--env'), false);
  assert.equal(calls.at(-1).input, 'PRIVATE KEY');
  assert.equal(calls.at(-1).args.includes('PRIVATE KEY'), false);
  assert.equal(lines.join('').includes('PRIVATE KEY'), false);
});

test('does not store the key if the bot login cannot be configured', () => {
  const calls = [];
  const stored = storeCredentials(
    { slug: 'themoltnet-renovate', client_id: 'client-id', pem: 'PRIVATE KEY' },
    (args) => {
      calls.push(args);
      if (args.includes('RENOVATE_APP_BOT_LOGIN')) {
        return { ok: false, output: '' };
      }
      return { ok: true, output: args.includes('--jq') ? 'true' : '' };
    },
    () => {},
  );
  assert.equal(stored, false);
  assert.equal(
    calls.some((args) => args[0] === 'secret'),
    false,
  );
  assert.equal(
    calls.some((args) => args.includes('RENOVATE_APP_CLIENT_ID')),
    false,
  );
});

test('ignores queued requests after closing the callback server', async () => {
  let closed = false;
  let exitCode;
  let conversions = 0;
  const { handler } = createRequestHandler({
    name: 'themoltnet-renovate',
    state: 'expected-state',
    getPort: () => {
      if (closed) throw new Error('address unavailable after close');
      return 1234;
    },
    close: () => {
      closed = true;
    },
    convertApp: async () => {
      conversions += 1;
      return { slug: 'themoltnet-renovate' };
    },
    storeApp: () => true,
    write: () => {},
    setExitCode: (code) => {
      exitCode = code;
    },
  });
  const response = () => ({
    status: undefined,
    writeHead(status) {
      this.status = status;
      return this;
    },
    end() {
      return this;
    },
  });

  const callback = response();
  await handler(
    { url: '/callback?state=expected-state&code=abcdefgh' },
    callback,
  );
  assert.equal(callback.status, 200);
  assert.equal(closed, true);
  assert.equal(exitCode, 0);

  const queuedRequest = response();
  await handler({ url: '/favicon.ico' }, queuedRequest);
  assert.equal(queuedRequest.status, 404);
  const repeatedPage = response();
  await handler({ url: '/' }, repeatedPage);
  assert.equal(repeatedPage.status, 404);
  assert.equal(conversions, 1);
});
