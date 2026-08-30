import { describe, expect, it } from 'vitest';

import { sanitizeForPersistence } from './sanitize.js';

describe('Codex environment evidence sanitization', () => {
  it('replaces known machine paths before persistence', () => {
    const output = sanitizeForPersistence(
      { path: '/private/tmp/moltnet/workspace/file.txt' },
      { machinePaths: ['/private/tmp/moltnet'] },
    );

    expect(output).toContain('$HOST_PATH/workspace/file.txt');
    expect(output).not.toContain('/private/tmp/moltnet');
  });

  it('refuses encoded secrets, private keys, tokens, and host paths', () => {
    const sentinel = 'sec"ret\\value';
    const options = { sensitiveValues: [sentinel] };
    for (const form of [
      sentinel,
      JSON.stringify(sentinel).slice(1, -1),
      Buffer.from(sentinel).toString('base64'),
      encodeURIComponent(sentinel),
    ]) {
      expect(() => sanitizeForPersistence({ output: form }, options)).toThrow(
        'synthetic credential sentinel',
      );
    }
    expect(() =>
      sanitizeForPersistence({ output: '-----BEGIN PRIVATE KEY-----' }),
    ).toThrow('private-key material');
    expect(() =>
      sanitizeForPersistence({ output: `ghp_${'a'.repeat(30)}` }),
    ).toThrow('token-like material');
    expect(() =>
      sanitizeForPersistence({ output: '/Users/someone/private/file' }),
    ).toThrow('absolute host path');
  });

  it('refuses non-plain objects before canonical persistence', () => {
    expect(() => sanitizeForPersistence({ when: new Date() })).toThrow(
      'non-plain object',
    );
  });
});
