import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  advancePin,
  fetchReleases,
  latestRelease,
  pinFiles,
} from '../../release/sync-daemon-consumer-pins.mjs';

const workflow = [
  'on:',
  '  workflow_call:',
  '    inputs:',
  '      runtime-ref:',
  '        type: string',
  "        default: ''",
  '      daemon-version:',
  '        type: string',
  "        default: '0.72.2'",
  '',
].join('\n');

const assets = [
  'moltnet-agent-linux-x64.tar.gz',
  'moltnet-agent-linux-x64.tar.gz.sha256',
  'moltnet-agent-linux-x64.tar.gz.sha256.sig',
].map((name) => ({ name }));

function release(tag, overrides = {}) {
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    assets,
    ...overrides,
  };
}

for (const [name, newline] of [
  ['LF', '\n'],
  ['CRLF', '\r\n'],
]) {
  test(`advances only the daemon-version default and never rolls back (${name})`, () => {
    const source = workflow.replaceAll('\n', newline);
    const advanced = advancePin(source, '0.73.1');
    assert.equal(advanced, source.replace("'0.72.2'", "'0.73.1'"));
    assert.equal(advancePin(advanced, '0.73.1'), advanced);
    assert.equal(advancePin(advanced, '0.72.2'), advanced);
    assert.throws(
      () =>
        advancePin(
          `      runtime-ref:${newline}        default: ''${newline}`,
          '0.73.1',
        ),
      /daemon pin not found/,
    );
  });
}

test('picks the newest published daemon release by version', () => {
  assert.equal(
    latestRelease([
      release('cli-v3.20.0'),
      release('agent-daemon-v0.9.0'),
      release('agent-daemon-v0.10.0', { draft: true }),
      release('agent-daemon-v0.11.0', { prerelease: true }),
      release('agent-daemon-v0.10.0-rc.1'),
      release('agent-daemon-v0.8.5'),
    ]),
    '0.9.0',
  );
  assert.throws(() => latestRelease([release('cli-v3.20.0')]), /No published/);
});

test('retains the pin while the runner bundle is incomplete', () => {
  assert.equal(
    latestRelease([
      release('agent-daemon-v0.74.0', { assets: assets.slice(0, 2) }),
      release('agent-daemon-v0.73.1'),
    ]),
    undefined,
  );
});

test('authenticates the release listing and fails closed on errors', async () => {
  let headers;
  await fetchReleases(async (_url, init) => {
    headers = init.headers;
    return { ok: true, json: async () => [] };
  }, 'token');
  assert.equal(headers.authorization, 'Bearer token');
  await assert.rejects(
    fetchReleases(async () => ({ ok: false, status: 403 }), undefined),
    /Cannot list GitHub releases \(403\)/,
  );
});

test('every pin file carries a daemon pin', async () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
  for (const file of pinFiles) {
    const source = await readFile(join(root, file), 'utf8');
    assert.doesNotThrow(() => advancePin(source, '0.0.0'), file);
  }
});
