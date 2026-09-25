import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertSelfHostReady,
  compareVersions,
} from './assert-self-host-ready.mjs';

test('compares released component versions numerically', () => {
  assert.equal(compareVersions('0.62.10', '0.62.3'), 1);
  assert.equal(compareVersions('0.25.4', '0.25.4'), 0);
  assert.equal(compareVersions('0.25.3', '0.25.4'), -1);
});

test('blocks publication until both OAuth-aware components are released', () => {
  assert.throws(
    () =>
      assertSelfHostReady({
        'apps/rest-api': '0.62.2',
        'apps/mcp-server': '0.25.4',
      }),
    /rest-api must be released/,
  );
  assert.throws(
    () =>
      assertSelfHostReady({
        'apps/rest-api': '0.62.3',
        'apps/mcp-server': '0.25.3',
      }),
    /mcp-server must be released/,
  );
  assert.doesNotThrow(() =>
    assertSelfHostReady({
      'apps/rest-api': '0.62.3',
      'apps/mcp-server': '0.25.4',
    }),
  );
});
