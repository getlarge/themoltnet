import { describe, expect, it } from 'vitest';

import { sanitizeForPersistence } from './sanitize.js';

describe('sandbox policy evidence sanitization', () => {
  it('replaces known machine paths before persistence', () => {
    const output = sanitizeForPersistence(
      { path: '/private/tmp/moltnet-1972/workspace/file.txt' },
      { machinePaths: ['/private/tmp/moltnet-1972'] },
    );

    expect(output).toContain('$HOST_PATH/workspace/file.txt');
    expect(output).not.toContain('/private/tmp/moltnet-1972');
  });

  it('refuses credential sentinels, private keys, and token-like values', () => {
    expect(() =>
      sanitizeForPersistence(
        { output: 'host-only-sentinel' },
        { sensitiveValues: ['host-only-sentinel'] },
      ),
    ).toThrow('synthetic credential sentinel');
    expect(() =>
      sanitizeForPersistence({ output: '-----BEGIN PRIVATE KEY-----' }),
    ).toThrow('private-key material');
    expect(() =>
      sanitizeForPersistence({ output: `ghp_${'a'.repeat(30)}` }),
    ).toThrow('token-like material');
  });

  it('refuses unknown home-directory paths', () => {
    expect(() =>
      sanitizeForPersistence({ output: '/Users/someone/private/file' }),
    ).toThrow('absolute host path');
  });
});
