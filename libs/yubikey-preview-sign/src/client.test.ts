import { p256 } from '@noble/curves/nist.js';
import { asMap, decodeCbor, encodeCbor, mapBytes } from '@themoltnet/ctap/cbor';
import { describe, expect, it } from 'vitest';

import { concatBytes, fromHex, sha256, toBase64Url, utf8 } from './bytes.js';
import { PreviewSignClient } from './client.js';
import type { CoseArkgSeedPublicKey, EnrollmentRecordV1 } from './types.js';
import { PreviewSignPresence } from './types.js';

function publicEc2(point: Uint8Array, algorithm: number) {
  return {
    kty: 2 as const,
    algorithm,
    curve: 1 as const,
    x: toBase64Url(point.slice(1, 33)),
    y: toBase64Url(point.slice(33)),
  };
}

const seed: CoseArkgSeedPublicKey = {
  kty: -65537,
  algorithm: -65700,
  derivedAlgorithm: -9,
  blindingKey: publicEc2(
    fromHex(
      '046d3bdf31d0db48988f16d47048fdd24123cd286e42d0512daa9f726b4ecf18df65ed42169c69675f936ff7de5f9bd93adbc8ea73036b16e8d90adbfabdaddba7',
    ),
    -7,
  ),
  kemKey: publicEc2(
    fromHex(
      '04c38bbdd7286196733fa177e43b73cfd3d6d72cd11cc0bb2c9236cf85a42dcff5dfa339c1e07dfcdfda8d7be2a5a3c7382991f387dfe332b1dd8da6e0622cfb35',
    ),
    -25,
  ),
  encoded: toBase64Url(Uint8Array.of(1)),
};

describe('PreviewSignClient', () => {
  it('signs an exact digest with a fresh derived key and verifies offline', async () => {
    const outerSecret = new Uint8Array(32).fill(11);
    const outerPublic = p256.getPublicKey(outerSecret, false);
    const previewSecret = fromHex(
      '775d7fe9a6dfba43ce671cb38afca3d272c4d14aff97bd67559eb500a092e5e7',
    );
    const client = new PreviewSignClient({
      now: () => new Date('2029-01-01T00:00:00Z'),
      connect: async () => ({
        device: {
          id: 'test-device',
          path: '/test',
          vendorId: 0x1050,
          productId: 1,
        },
        async cbor(command, request) {
          expect(command).toBe(0x02);
          const decoded = asMap(decodeCbor(request!));
          const digest = mapBytes(
            asMap(asMap(decoded.get(4)).get('previewSign')),
            6,
            'digest',
          );
          const previewSignature = p256.sign(digest, previewSecret, {
            format: 'der',
            prehash: false,
          });
          const authData = concatBytes(
            sha256(utf8('preview-sign.local')),
            Uint8Array.of(0x85),
            new Uint8Array(4),
            encodeCbor(
              new Map([['previewSign', new Map([[6, previewSignature]])]]),
            ),
          );
          const outerSignature = p256.sign(
            concatBytes(authData, mapBytes(decoded, 2, 'client data hash')),
            outerSecret,
            { format: 'der' },
          );
          return encodeCbor(
            new Map<unknown, unknown>([
              [2, authData],
              [3, outerSignature],
            ]),
          );
        },
        async close() {},
      }),
    });
    const enrollment: EnrollmentRecordV1 = {
      version: 'preview-sign.enrollment.v1',
      id: 'enrollment-vector',
      createdAt: '2029-01-01T00:00:00Z',
      device: { id: 'test-device', vendorId: 0x1050, productId: 1 },
      capabilities: {
        versions: ['FIDO_2_1'],
        extensions: ['previewSign'],
        options: {},
        supportsPreviewSign: true,
        supportsCtap23: true,
      },
      outerCredentialId: toBase64Url(Uint8Array.of(1, 2, 3)),
      outerPublicKey: publicEc2(outerPublic, -7),
      previewKeyHandle: toBase64Url(Uint8Array.of(4, 5, 6)),
      seedPublicKey: seed,
      algorithm: -65539,
      attestation: {
        format: 'packed',
        object: toBase64Url(Uint8Array.of(7)),
        verified: false,
        trust: 'unverified',
      },
    };
    const digest = sha256(utf8('approval action'));
    await expect(
      client.signDigest({ enrollment, digest }),
    ).rejects.toMatchObject({ code: 'UNTRUSTED_ENROLLMENT' });
    const signed = await client.signDigest({
      enrollment,
      digest,
      ikm: fromHex(
        '404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f',
      ),
      context: utf8('ARKG-P256.test vectors'),
      presence: PreviewSignPresence.RequireUserVerification,
      allowUnverifiedEnrollment: true,
    });
    expect(
      client.verifyDigest({
        enrollment,
        verificationKey: signed.verificationKey,
        digest,
        signature: signed.signature,
      }),
    ).toBe(true);
    expect(
      client.verifyDigest({
        enrollment,
        verificationKey: signed.verificationKey,
        digest: sha256(utf8('mutated')),
        signature: signed.signature,
      }),
    ).toBe(false);
  });

  it('returns false for malformed untrusted verification records', () => {
    const client = new PreviewSignClient();
    const enrollment = {
      version: 'preview-sign.enrollment.v1',
      id: 'enrollment-vector',
      seedPublicKey: seed,
    } as EnrollmentRecordV1;

    expect(
      client.verifyDigest({
        enrollment,
        verificationKey: {
          version: 'preview-sign.verification-key.v1',
          id: 'malformed',
          enrollmentId: enrollment.id,
          createdAt: '2029-01-01T00:00:00Z',
          algorithm: -9,
          ikm: 'not+base64url',
          context: '',
          additionalArguments: '',
          publicKey: seed.blindingKey,
        },
        digest: new Uint8Array(32),
        signature: new Uint8Array(),
      }),
    ).toBe(false);
  });
});
