import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkVerifyIsolation } from '../scripts/check-verify-isolation.js';

describe('./verify isolation', () => {
  it('keeps the source dependency graph isomorphic on every test run', () => {
    expect(
      checkVerifyIsolation(resolve('src/verify-entry.ts'), {
        sourceGraph: true,
      }),
    ).toBeGreaterThan(0);
  });
});
