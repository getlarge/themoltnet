import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { isDefaultStore, storeSecretService } from '../src/index.js';

describe('test environment', () => {
  it('never resolves the developer store or the default keyring namespace', () => {
    const tmp = realpathSync(tmpdir());
    for (const name of ['HOME', 'MOLTNET_HOME', 'MOLTNET_DEFAULT_STORE_ROOT']) {
      expect(realpathSync(process.env[name]!), name).toMatch(
        new RegExp(`^${tmp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      );
    }
    expect(isDefaultStore()).toBe(false);
    expect(storeSecretService()).not.toBe('themolt.net');
  });
});
