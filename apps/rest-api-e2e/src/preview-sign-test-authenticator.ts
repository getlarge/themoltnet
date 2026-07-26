import { createECDH, createHash, hkdfSync } from 'node:crypto';

import type {
  PreviewSignChallenge,
  PreviewSignPublicMaterial,
  PreviewSignReceiptValue,
} from '@moltnet/api-client';
import { p256 } from '@noble/curves/nist.js';
import { asMap, decodeCbor, mapBytes } from '@themoltnet/ctap/cbor';

const P256_ORDER =
  0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const encoder = new TextEncoder();
const DST_BL = encoder.encode('ARKG-P256');
const DST_KEM = encoder.encode('ARKG-ECDH.ARKG-P256');
const DST_KEM_HMAC_SHARED = encoder.encode('ARKG-KEM-HMAC-shared.');
const DST_DERIVE_KEY_KEM = encoder.encode('ARKG-Derive-Key-KEM.');
const DST_DERIVE_KEY_BL = encoder.encode('ARKG-Derive-Key-BL.');
const DST_BL_EC = encoder.encode('ARKG-BL-EC.');
const BLINDING_SECRET = new Uint8Array(32).fill(7);
const KEM_SECRET = new Uint8Array(32).fill(8);
const OUTER_SECRET = new Uint8Array(32).fill(9);

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((length, part) => length + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function sha256(value: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(value).digest());
}

function xor(left: Uint8Array, right: Uint8Array): Uint8Array {
  return left.map((value, index) => value ^ (right[index] ?? 0));
}

function expandMessageXmd(
  message: Uint8Array,
  dst: Uint8Array,
  length: number,
): Uint8Array {
  const dstPrime = concatBytes(dst, Uint8Array.of(dst.length));
  const b0 = sha256(
    concatBytes(
      new Uint8Array(64),
      message,
      Uint8Array.of((length >>> 8) & 0xff, length & 0xff),
      Uint8Array.of(0),
      dstPrime,
    ),
  );
  let next = b0;
  const output = new Uint8Array(Math.ceil(length / 32) * 32);
  for (let index = 1; index <= output.length / 32; index += 1) {
    const block = sha256(concatBytes(next, Uint8Array.of(index), dstPrime));
    output.set(block, (index - 1) * 32);
    next = xor(b0, block);
  }
  return output.slice(0, length);
}

function bytesToBigint(value: Uint8Array): bigint {
  return BigInt(`0x${Buffer.from(value).toString('hex')}`);
}

function bigintToBytes(value: bigint): Uint8Array {
  return Uint8Array.from(
    Buffer.from(value.toString(16).padStart(64, '0'), 'hex'),
  );
}

function hashToScalar(message: Uint8Array, dst: Uint8Array): bigint {
  return bytesToBigint(expandMessageXmd(message, dst, 48)) % P256_ORDER;
}

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

export function previewSignTestPublicMaterial(): PreviewSignPublicMaterial {
  return {
    version: 1,
    outerCredentialId: Buffer.from('e2e-preview-sign-outer').toString(
      'base64url',
    ),
    outerPublicKey: ec2(OUTER_SECRET, -7),
    previewKeyHandle: Buffer.from('e2e-preview-sign-key').toString('base64url'),
    seedPublicKey: {
      kty: -65537,
      algorithm: -65700,
      derivedAlgorithm: -9,
      blindingKey: ec2(BLINDING_SECRET, -7),
      kemKey: ec2(KEM_SECRET, -25),
    },
  };
}

function derivedPrivateKey(additionalArguments: string): Uint8Array {
  const args = asMap(decodeCbor(Buffer.from(additionalArguments, 'base64url')));
  const keyHandle = mapBytes(args, -1, 'ARKG key handle');
  const context = mapBytes(args, -2, 'ARKG context');
  const ephemeralPublic = keyHandle.slice(16);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(KEM_SECRET);
  const sharedSecret = new Uint8Array(ecdh.computeSecret(ephemeralPublic));
  const contextPrime = concatBytes(Uint8Array.of(context.length), context);
  const kemContext = concatBytes(DST_DERIVE_KEY_KEM, contextPrime);
  const ikmTau = new Uint8Array(
    hkdfSync(
      'sha256',
      sharedSecret,
      new Uint8Array(),
      concatBytes(DST_KEM_HMAC_SHARED, DST_KEM, kemContext),
      sharedSecret.length,
    ),
  );
  const tau = hashToScalar(
    ikmTau,
    concatBytes(
      DST_BL_EC,
      DST_BL,
      concatBytes(DST_DERIVE_KEY_BL, contextPrime),
    ),
  );
  return bigintToBytes((bytesToBigint(BLINDING_SECRET) + tau) % P256_ORDER);
}

export function signPreviewSignChallenge(
  challenge: PreviewSignChallenge,
): PreviewSignReceiptValue {
  const digest = Buffer.from(challenge.digest, 'base64url');
  if (digest.length !== 32) {
    throw new Error('previewSign server challenge digest is not 32 bytes');
  }
  const signature = p256.sign(
    digest,
    derivedPrivateKey(challenge.additionalArguments),
    {
      format: 'der',
      prehash: false,
      lowS: true,
    },
  );
  return {
    verificationMethod: 'human-hardware-previewsign',
    value: {
      version: 1,
      signature: Buffer.from(signature).toString('base64url'),
    },
  };
}
