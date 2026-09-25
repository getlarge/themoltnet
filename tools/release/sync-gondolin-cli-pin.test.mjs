import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  advancePin,
  compareVersions,
  verifyPackages,
} from './sync-gondolin-cli-pin.mjs';

test('compares numeric versions and rejects malformed versions', () => {
  assert.equal(compareVersions('3.10.0', '3.9.9'), 1);
  assert.equal(compareVersions('3.5.0', '3.5.0'), 0);
  assert.equal(compareVersions('3.4.9', '3.5.0'), -1);
  assert.throws(() => compareVersions('3.5.0-beta', '3.5.0'));
});

test('advances only newer pins and is idempotent', () => {
  const source = "const MOLTNET_CLI_VERSION = '3.5.0';";
  const advanced = advancePin(source, '3.6.0');
  assert.equal(advanced, "const MOLTNET_CLI_VERSION = '3.6.0';");
  assert.equal(advancePin(advanced, '3.6.0'), advanced);
  assert.equal(advancePin(advanced, '3.5.0'), advanced);
});

test('requires all three published packages', async () => {
  const visited = [];
  await verifyPackages('3.5.0', async (url) => {
    visited.push(url);
    return { ok: true, json: async () => ({ version: '3.5.0' }) };
  });
  assert.equal(visited.length, 3);
  await assert.rejects(
    verifyPackages('3.5.0', async (url) => ({
      ok: !url.includes('arm64'),
      status: 404,
      json: async () => ({ version: '3.5.0' }),
    })),
    /cli-linux-arm64@3.5.0 unavailable/,
  );
});
