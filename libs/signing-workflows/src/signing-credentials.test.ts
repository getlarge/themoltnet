import { describe, expect, it } from 'vitest';

import {
  assertNoPrivateSigningMaterial,
  assertSupportedSignerConstraint,
  SigningCredentialError,
} from './signing-credentials.js';

describe('signing credential guards', () => {
  it('rejects nested private key material', () => {
    expect(() =>
      assertNoPrivateSigningMaterial({
        version: 1,
        device: { private_key: 'must-not-cross-the-api' },
      }),
    ).toThrowError(SigningCredentialError);

    try {
      assertNoPrivateSigningMaterial({
        version: 1,
        device: { private_key: 'must-not-cross-the-api' },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(SigningCredentialError);
      expect((error as SigningCredentialError).code).toBe(
        'credential_private_material_rejected',
      );
    }
  });

  it('accepts versioned public material', () => {
    expect(() =>
      assertNoPrivateSigningMaterial({
        version: 1,
        publicKey: 'public',
        certificateChain: ['certificate'],
      }),
    ).not.toThrow();
  });

  it.each(['site', 'station'])(
    'returns a typed capability error for %s constraints',
    (type) => {
      expect(() => assertSupportedSignerConstraint(type)).toThrowError(
        SigningCredentialError,
      );
    },
  );
});
