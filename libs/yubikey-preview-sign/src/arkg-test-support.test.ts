import { p256 } from '@noble/curves/nist.js';
import { describe, expect, it } from 'vitest';

import {
  ARKG_KEY_TYPE,
  ARKG_P256_ALGORITHM,
  deriveArkgPublicKey,
  ESP256_ALGORITHM,
} from './arkg.js';
import { deriveArkgPrivateKeyForTesting } from './arkg-test-support.js';
import type { CoseArkgSeedPublicKey } from './verify-types.js';

const BLINDING_SECRET = new Uint8Array(32).fill(7);
const KEM_SECRET = new Uint8Array(32).fill(8);

function ec2<const Algorithm extends -25 | -7>(
  secret: Uint8Array,
  algorithm: Algorithm,
) {
  const point = p256.getPublicKey(secret, false);
  return {
    kty: 2 as const,
    algorithm,
    curve: 1 as const,
    x: Buffer.from(point.slice(1, 33)).toString('base64url'),
    y: Buffer.from(point.slice(33)).toString('base64url'),
  };
}

describe('ARKG workspace test support', () => {
  it('reconstructs the private half of the production public derivation', () => {
    const seed: CoseArkgSeedPublicKey = {
      kty: ARKG_KEY_TYPE,
      algorithm: ARKG_P256_ALGORITHM,
      derivedAlgorithm: ESP256_ALGORITHM,
      blindingKey: ec2(BLINDING_SECRET, -7),
      kemKey: ec2(KEM_SECRET, -25),
      encoded: '',
    };
    const derived = deriveArkgPublicKey(
      seed,
      new Uint8Array(32).fill(10),
      new Uint8Array(32).fill(11),
    );

    const privateKey = deriveArkgPrivateKeyForTesting({
      blindingSecret: BLINDING_SECRET,
      kemSecret: KEM_SECRET,
      additionalArguments: derived.additionalArguments,
    });
    const point = p256.getPublicKey(privateKey, false);

    expect(Buffer.from(point.slice(1, 33)).toString('base64url')).toBe(
      derived.publicKey.x,
    );
    expect(Buffer.from(point.slice(33)).toString('base64url')).toBe(
      derived.publicKey.y,
    );
  });
});
