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
    expect(() =>
      sanitizeForPersistence({ output: `ory_pat_${'a'.repeat(30)}` }),
    ).toThrow('token-like material');
  });

  it('checks raw, escaped, base64, and percent-encoded sentinel forms', () => {
    const sentinel = 'sec"ret\\value';
    const options = { sensitiveValues: [sentinel] };
    const forms = [
      sentinel,
      JSON.stringify(sentinel).slice(1, -1),
      Buffer.from(sentinel).toString('base64'),
      encodeURIComponent(sentinel),
    ];

    for (const form of forms) {
      expect(() =>
        sanitizeForPersistence(
          { nested: [{ output: `prefix:${form}:suffix` }] },
          options,
        ),
      ).toThrow('synthetic credential sentinel');
    }
    expect(() =>
      sanitizeForPersistence({ output: 'safe' }, { sensitiveValues: [] }),
    ).not.toThrow();
  });

  it('sanitizes object keys as well as values', () => {
    expect(() =>
      sanitizeForPersistence(
        { 'host-only-sentinel': 'safe' },
        { sensitiveValues: ['host-only-sentinel'] },
      ),
    ).toThrow('synthetic credential sentinel');
  });

  it('refuses bare and nested unknown home-directory paths', () => {
    expect(() =>
      sanitizeForPersistence({ output: '/Users/someone/private/file' }),
    ).toThrow('absolute host path');
    expect(() => sanitizeForPersistence({ output: '/home/runner' })).toThrow(
      'absolute host path',
    );
    expect(() =>
      sanitizeForPersistence({ output: String.raw`C:\Users\someone` }),
    ).toThrow('absolute host path');
  });

  it('refuses non-plain objects before canonical persistence', () => {
    expect(() => sanitizeForPersistence({ when: new Date() })).toThrow(
      'non-plain object',
    );
  });
});
