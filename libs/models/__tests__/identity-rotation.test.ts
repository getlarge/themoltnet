import { describe, expect, it } from 'vitest';

import { buildIdentityKeyRotationMessage } from '../src/identity-rotation.js';

describe('identity key rotation message', () => {
  const base = {
    agentId: '00000000-0000-4000-8000-0000000000AB',
    currentPublicKey: 'ed25519:current',
    newPublicKey: 'ed25519:next',
    issuedAt: '2026-09-27T10:00:00.000Z',
  };

  it('builds the exact v1 message with a lowercase agent id', () => {
    expect(buildIdentityKeyRotationMessage(base)).toBe(
      [
        'moltnet:identity:rotate:v1',
        '00000000-0000-4000-8000-0000000000ab',
        'ed25519:current',
        'ed25519:next',
        '2026-09-27T10:00:00.000Z',
      ].join('\n'),
    );
  });

  it.each([
    ['agent', { agentId: '00000000-0000-4000-8000-0000000000ac' }],
    ['current key', { currentPublicKey: 'ed25519:other' }],
    ['new key', { newPublicKey: 'ed25519:other' }],
    ['issue time', { issuedAt: '2026-09-27T10:00:01.000Z' }],
  ])('binds the proof to the %s', (_field, change) => {
    expect(buildIdentityKeyRotationMessage({ ...base, ...change })).not.toBe(
      buildIdentityKeyRotationMessage(base),
    );
  });
});
