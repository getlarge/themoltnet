import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  assertNoPrivateSigningMaterial,
  assertSupportedSignerConstraint,
  SigningCredentialError,
} from './signing-credentials.js';

function captureThrownError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('Expected function to throw');
}

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

  it.each([
    {
      name: 'mixed-case field',
      value: { version: 1, device: { PrivateKey: 'secret' } },
    },
    {
      name: 'array-nested field',
      value: { version: 1, devices: [{ SECRET: 'secret' }] },
    },
    {
      name: 'JWK private scalar',
      value: { version: 1, kty: 'EC', d: 'private-scalar' },
    },
    {
      name: 'PEM value',
      value: {
        version: 1,
        certificate: '-----BEGIN PRIVATE KEY-----\nsecret',
      },
    },
  ])('rejects private material in a $name', ({ value }) => {
    expect(() => assertNoPrivateSigningMaterial(value)).toThrowError(
      SigningCredentialError,
    );
  });

  it('rejects a base64-encoded DER private key value', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const encoded = privateKey
      .export({ format: 'der', type: 'pkcs8' })
      .toString('base64');

    expect(
      captureThrownError(() =>
        assertNoPrivateSigningMaterial({ version: 1, publicKey: encoded }),
      ),
    ).toEqual(
      expect.objectContaining({
        code: 'credential_private_material_rejected',
      }),
    );
  });

  it('rejects excessive nesting without overflowing the stack', () => {
    let value: unknown = 'leaf';
    for (let depth = 0; depth < 100; depth += 1) {
      value = { nested: value };
    }

    expect(
      captureThrownError(() => assertNoPrivateSigningMaterial(value)),
    ).toEqual(
      expect.objectContaining({
        code: 'credential_public_material_invalid',
      }),
    );
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
