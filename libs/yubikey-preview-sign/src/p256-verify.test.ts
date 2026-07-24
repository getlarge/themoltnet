import { p256 } from '@noble/curves/nist.js';
import { describe, expect, it } from 'vitest';

import { toBase64Url } from './bytes.js';
import { PreviewSignError } from './errors.js';
import {
  normalizeP256DerSignature,
  verifyP256PrehashedSignature,
} from './p256-verify.js';

function publicKey(secret: Uint8Array) {
  const point = p256.getPublicKey(secret, false);
  return {
    kty: 2 as const,
    algorithm: -9,
    curve: 1 as const,
    x: toBase64Url(point.slice(1, 33)),
    y: toBase64Url(point.slice(33)),
  };
}

describe('P-256 prehashed verification', () => {
  const secret = new Uint8Array(32).fill(7);
  const digest = new Uint8Array(32).fill(9);
  const signature = p256.sign(digest, secret, {
    format: 'der',
    prehash: false,
  });

  it('rejects a valid signature under a substituted key', () => {
    expect(
      verifyP256PrehashedSignature(
        digest,
        signature,
        publicKey(new Uint8Array(32).fill(8)),
      ),
    ).toBe(false);
  });

  it('rejects a structurally valid tampered signature', () => {
    const parsed = p256.Signature.fromBytes(signature, 'der');
    const tampered = new p256.Signature(parsed.r ^ 1n, parsed.s).toBytes('der');

    expect(
      verifyP256PrehashedSignature(digest, tampered, publicKey(secret)),
    ).toBe(false);
  });

  it('rejects a mutated digest', () => {
    const mutated = Uint8Array.from(digest);
    mutated[0] ^= 0xff;

    expect(
      verifyP256PrehashedSignature(mutated, signature, publicKey(secret)),
    ).toBe(false);
  });

  it('surfaces malformed DER as a verification error', () => {
    expect(() =>
      verifyP256PrehashedSignature(
        digest,
        Uint8Array.of(0x30, 0x01, 0x00),
        publicKey(secret),
      ),
    ).toThrow(PreviewSignError);
  });

  it('rejects high-S signatures until they are canonicalized', () => {
    const parsed = p256.Signature.fromBytes(signature, 'der');
    const highS = new p256.Signature(
      parsed.r,
      p256.Point.CURVE().n - parsed.s,
    ).toBytes('der');

    expect(verifyP256PrehashedSignature(digest, highS, publicKey(secret))).toBe(
      false,
    );
    expect(
      verifyP256PrehashedSignature(
        digest,
        normalizeP256DerSignature(highS),
        publicKey(secret),
      ),
    ).toBe(true);
  });
});
