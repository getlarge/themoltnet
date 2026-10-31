import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  checkProtocolIsolation,
  checkVerifyIsolation,
} from '../scripts/check-verify-isolation.js';

describe('entry-point isolation', () => {
  it('keeps the ./verify source dependency graph isomorphic', () => {
    expect(
      checkVerifyIsolation(resolve('src/verify-entry.ts'), {
        sourceGraph: true,
      }),
    ).toBeGreaterThan(0);
  });

  it('keeps the ./protocol source graph hardware-transport-free', () => {
    expect(
      checkProtocolIsolation(resolve('src/protocol-entry.ts'), {
        sourceGraph: true,
      }),
    ).toBeGreaterThan(0);
  });
});
