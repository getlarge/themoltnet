import { describe, expect, it } from 'vitest';

import {
  buildSelfRegistrationMessage,
  buildTeamRegistrationMessage,
} from '../src/registration.js';

describe('registration messages', () => {
  it('builds the exact unversioned self-registration message', () => {
    expect(
      buildSelfRegistrationMessage({
        idempotencyKey: 'nonce',
        publicKey: 'ed25519:public',
        credentialType: 'oauth2',
      }),
    ).toBe('moltnet:register:self\nnonce\ned25519:public\noauth2');
  });

  it('builds the exact team message with a lowercase token hash', () => {
    expect(
      buildTeamRegistrationMessage({
        enrollmentTokenHash: 'ABCDEF',
        idempotencyKey: 'nonce',
        publicKey: 'ed25519:public',
        credentialType: 'agent_key',
      }),
    ).toBe('moltnet:register:team\nabcdef\nnonce\ned25519:public\nagent_key');
  });

  it.each([
    ['nonce', { idempotencyKey: 'other' }],
    ['public key', { publicKey: 'ed25519:other' }],
    ['credential type', { credentialType: 'agent_key' as const }],
  ])('binds the self-registration proof to the %s', (_field, change) => {
    const base = {
      idempotencyKey: 'nonce',
      publicKey: 'ed25519:public',
      credentialType: 'oauth2' as const,
    };
    expect(buildSelfRegistrationMessage({ ...base, ...change })).not.toBe(
      buildSelfRegistrationMessage(base),
    );
  });

  it('binds team registration to the enrollment token hash', () => {
    const base = {
      enrollmentTokenHash: 'a'.repeat(64),
      idempotencyKey: 'nonce',
      publicKey: 'ed25519:public',
      credentialType: 'oauth2' as const,
    };
    expect(
      buildTeamRegistrationMessage({
        ...base,
        enrollmentTokenHash: 'b'.repeat(64),
      }),
    ).not.toBe(buildTeamRegistrationMessage(base));
  });
});
