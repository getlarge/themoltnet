import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildManifest,
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
    { client_id: 'client-id', pem: 'PRIVATE KEY' },
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
    { client_id: 'client-id', pem: 'PRIVATE KEY' },
    (args, input) => {
      calls.push({ args, input });
      return { ok: true, output: args.includes('--jq') ? 'true' : '' };
    },
    (line) => lines.push(line),
  );
  assert.equal(stored, true);
  assert.deepEqual(
    calls.map(({ args }) => args[0]),
    ['api', 'api', 'api', 'variable', 'secret'],
  );
  assert.equal(calls.at(-1).input, 'PRIVATE KEY');
  assert.equal(calls.at(-1).args.includes('PRIVATE KEY'), false);
  assert.equal(lines.join('').includes('PRIVATE KEY'), false);
});
