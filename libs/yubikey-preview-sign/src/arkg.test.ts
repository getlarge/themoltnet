import { p256 } from '@noble/curves/nist.js';
import {
  asMap,
  decodeCbor,
  encodeCbor,
  mapBytes,
  mapNumber,
} from '@themoltnet/ctap/cbor';
import { describe, expect, it } from 'vitest';

import {
  deriveArkgPublicKey,
  ESP256_SPLIT_ARKG_PLACEHOLDER,
  parseArkgSeedPublicKey,
} from './arkg.js';
import { fromBase64Url, fromHex, toHex } from './bytes.js';
import { PreviewSignError } from './errors.js';
import {
  verifyP256PrehashedSignature,
  verifyP256Signature,
} from './p256-verify.js';

const vectors = [
  {
    context: 'ARKG-P256.test vectors',
    ikm: '404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f',
    expected:
      '04572a111ce5cfd2a67d56a0f7c684184b16ccd212490dc9c5b579df749647d107dac2a1b197cc10d2376559ad6df6bc107318d5cfb90def9f4a1f5347e086c2cd',
  },
  {
    context: 'ARKG-P256.test vectors',
    ikm: 'a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf',
    expected:
      '04ea7d962c9f44ffe8b18f1058a471f394ef81b674948eefc1865b5c021cf858f577f9632b84220e4a1444a20b9430b86731c37e4dcb285eda38d76bf758918d86',
  },
  {
    context: 'ARKG-P256.test vectors.0',
    ikm: '404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f',
    expected:
      '04b79b65d6bbb419ff97006a1bd52e3f4ad53042173992423e06e52987a037cb61dd82b126b162e4e7e8dc5c9fd86e82769d402a1968c7c547ef53ae4f96e10b0e',
  },
];

const pkBl =
  '046d3bdf31d0db48988f16d47048fdd24123cd286e42d0512daa9f726b4ecf18df65ed42169c69675f936ff7de5f9bd93adbc8ea73036b16e8d90adbfabdaddba7';
const pkKem =
  '04c38bbdd7286196733fa177e43b73cfd3d6d72cd11cc0bb2c9236cf85a42dcff5dfa339c1e07dfcdfda8d7be2a5a3c7382991f387dfe332b1dd8da6e0622cfb35';

function ec2(pointHex: string, algorithm: number) {
  const point = fromHex(pointHex);
  return new Map<unknown, unknown>([
    [1, 2],
    [3, algorithm],
    [-1, 1],
    [-2, point.slice(1, 33)],
    [-3, point.slice(33)],
  ]);
}

function seed() {
  const encoded = encodeCbor(
    new Map<unknown, unknown>([
      [1, -65537],
      [3, -65700],
      [-1, ec2(pkBl, -7)],
      [-2, ec2(pkKem, -25)],
      [-3, -9],
    ]),
  );
  return parseArkgSeedPublicKey(decodeCbor(encoded), encoded);
}

describe('ARKG-P256', () => {
  for (const vector of vectors) {
    it(`matches Yubico vector ${vector.context}/${vector.ikm.slice(0, 4)}`, () => {
      const derived = deriveArkgPublicKey(
        seed(),
        fromHex(vector.ikm),
        new TextEncoder().encode(vector.context),
      );
      const point = `04${toHex(fromBase64Url(derived.publicKey.x))}${toHex(
        fromBase64Url(derived.publicKey.y),
      )}`;

      expect(point).toBe(vector.expected);

      const args = asMap(decodeCbor(derived.additionalArguments));
      expect(mapNumber(args, 3, 'algorithm')).toBe(
        ESP256_SPLIT_ARKG_PLACEHOLDER,
      );
      expect(mapBytes(args, -2, 'context')).toEqual(
        new TextEncoder().encode(vector.context),
      );
      expect(mapBytes(args, -1, 'key handle')).toHaveLength(81);
    });
  }

  it('rejects contexts longer than 64 bytes', () => {
    expect(() =>
      deriveArkgPublicKey(seed(), new Uint8Array(32), new Uint8Array(65)),
    ).toThrowError(/at most 64/);
  });

  it('classifies short caller-supplied IKM as invalid input', () => {
    expect(() =>
      deriveArkgPublicKey(seed(), new Uint8Array(31), new Uint8Array()),
    ).toThrowError(PreviewSignError);
  });

  it('verifies previewSign digests without hashing them twice', () => {
    const secret = new Uint8Array(32).fill(7);
    const point = p256.getPublicKey(secret, false);
    const publicKey = {
      kty: 2 as const,
      algorithm: -9,
      curve: 1 as const,
      x: Buffer.from(point.slice(1, 33)).toString('base64url'),
      y: Buffer.from(point.slice(33)).toString('base64url'),
    };
    const digest = new Uint8Array(32).fill(9);
    const signature = p256.sign(digest, secret, {
      format: 'der',
      prehash: false,
    });

    expect(verifyP256PrehashedSignature(digest, signature, publicKey)).toBe(
      true,
    );
    expect(verifyP256Signature(digest, signature, publicKey)).toBe(false);
  });

  it('surfaces malformed verification keys instead of a mismatch', () => {
    const malformedKey = {
      kty: 2 as const,
      algorithm: -9,
      curve: 1 as const,
      x: 'AA',
      y: 'AA',
    };

    expect(() =>
      verifyP256PrehashedSignature(
        new Uint8Array(32),
        new Uint8Array(64),
        malformedKey,
      ),
    ).toThrow(PreviewSignError);
  });
});
