/*
 * ARKG-P256 is a TypeScript port of Yubico's experimental python-fido2
 * implementation. See NOTICE for the retained BSD-2-Clause attribution.
 */
import { p256 } from '@noble/curves/nist.js';
import { hkdf } from '@noble/hashes/hkdf';
import { hmac } from '@noble/hashes/hmac';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2';
import { asMap, encodeCbor, mapBytes, mapNumber } from '@themoltnet/ctap/cbor';

import {
  bigintToBytes,
  bytesToBigint,
  concatBytes,
  fromBase64Url,
  sha256,
  toBase64Url,
  utf8,
} from './bytes.js';
import { invariant } from './errors.js';
import type {
  CoseArkgSeedPublicKey,
  CoseEc2PublicKey,
} from './verify-types.js';

export const ARKG_P256_ALGORITHM = -65700 as const;
export const ESP256_ALGORITHM = -9 as const;
export const ESP256_SPLIT_ARKG_PLACEHOLDER = -65539 as const;
export const ARKG_KEY_TYPE = -65537 as const;

const P256_ORDER =
  0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const DST_BL = utf8('ARKG-P256');
const DST_KEM = utf8('ARKG-ECDH.ARKG-P256');
const DST_KEM_ECDH_KG = utf8('ARKG-KEM-ECDH-KG.');
const DST_DERIVE_KEY_KEM = utf8('ARKG-Derive-Key-KEM.');
const DST_KEM_HMAC_MAC = utf8('ARKG-KEM-HMAC-mac.');
const DST_KEM_HMAC_SHARED = utf8('ARKG-KEM-HMAC-shared.');
const DST_DERIVE_KEY_BL = utf8('ARKG-Derive-Key-BL.');
const DST_BL_EC = utf8('ARKG-BL-EC.');
const ZERO_PAD = new Uint8Array(64);

function xor(left: Uint8Array, right: Uint8Array): Uint8Array {
  invariant(
    left.length === right.length,
    'INVALID_RESPONSE',
    'Cannot XOR unequal byte arrays',
  );
  return left.map((value, index) => value ^ (right[index] ?? 0));
}

function expandMessageXmd(
  message: Uint8Array,
  dst: Uint8Array,
  length: number,
): Uint8Array {
  const blocks = Math.ceil(length / 32);
  invariant(
    blocks <= 255 && length <= 65535 && dst.length <= 255,
    'INVALID_RESPONSE',
    'Invalid ARKG hash-to-field size',
  );
  const dstPrime = concatBytes(dst, Uint8Array.of(dst.length));
  const b0 = sha256(
    concatBytes(
      ZERO_PAD,
      message,
      Uint8Array.of((length >>> 8) & 0xff, length & 0xff),
      Uint8Array.of(0),
      dstPrime,
    ),
  );
  let next = b0;
  const output = new Uint8Array(blocks * 32);
  for (let index = 1; index <= blocks; index += 1) {
    const block = sha256(concatBytes(next, Uint8Array.of(index), dstPrime));
    output.set(block, (index - 1) * 32);
    next = xor(b0, block);
  }
  return output.slice(0, length);
}

function hashToScalar(message: Uint8Array, dst: Uint8Array): bigint {
  const scalar = bytesToBigint(expandMessageXmd(message, dst, 48)) % P256_ORDER;
  invariant(
    scalar !== 0n,
    'INVALID_RESPONSE',
    'ARKG derived an invalid zero scalar',
  );
  return scalar;
}

function hkdfSha256(
  input: Uint8Array,
  info: Uint8Array,
  length: number,
): Uint8Array {
  return hkdf(nobleSha256, input, new Uint8Array(), info, length);
}

function ecPoint(key: CoseEc2PublicKey): Uint8Array {
  invariant(
    key.kty === 2 && key.curve === 1,
    'INVALID_RESPONSE',
    'Expected a P-256 EC2 key',
  );
  const x = fromBase64Url(key.x, 'EC x-coordinate');
  const y = fromBase64Url(key.y, 'EC y-coordinate');
  invariant(
    x.length === 32 && y.length === 32,
    'INVALID_RESPONSE',
    'Invalid P-256 coordinate length',
  );
  return concatBytes(Uint8Array.of(4), x, y);
}

export function validateCoseEc2PublicKey(key: CoseEc2PublicKey): void {
  p256.Point.fromBytes(ecPoint(key));
}

function keyFromPoint(point: Uint8Array, algorithm: number): CoseEc2PublicKey {
  invariant(
    point.length === 65 && point[0] === 4,
    'INVALID_RESPONSE',
    'Invalid P-256 point',
  );
  return {
    kty: 2,
    algorithm,
    curve: 1,
    x: toBase64Url(point.slice(1, 33)),
    y: toBase64Url(point.slice(33, 65)),
  };
}

export function parseCoseEc2PublicKey(value: unknown): CoseEc2PublicKey {
  const map = asMap(value, 'COSE public key');
  const kty = mapNumber(map, 1, 'COSE kty');
  const algorithm = mapNumber(map, 3, 'COSE algorithm');
  const curve = mapNumber(map, -1, 'COSE curve');
  invariant(
    kty === 2 && curve === 1,
    'INVALID_RESPONSE',
    'Only P-256 EC2 keys are supported',
  );
  const x = mapBytes(map, -2, 'COSE x-coordinate');
  const y = mapBytes(map, -3, 'COSE y-coordinate');
  invariant(
    x.length === 32 && y.length === 32,
    'INVALID_RESPONSE',
    'Invalid P-256 key length',
  );
  return {
    kty: 2,
    algorithm,
    curve: 1,
    x: toBase64Url(x),
    y: toBase64Url(y),
  };
}

export function encodeCoseEc2PublicKey(key: CoseEc2PublicKey): Uint8Array {
  return encodeCbor(
    new Map<unknown, unknown>([
      [1, key.kty],
      [3, key.algorithm],
      [-1, key.curve],
      [-2, fromBase64Url(key.x)],
      [-3, fromBase64Url(key.y)],
    ]),
  );
}

export function parseArkgSeedPublicKey(
  value: unknown,
  encoded: Uint8Array,
): CoseArkgSeedPublicKey {
  const map = asMap(value, 'ARKG seed public key');
  invariant(
    mapNumber(map, 1, 'ARKG key type') === ARKG_KEY_TYPE,
    'INVALID_RESPONSE',
    'Unexpected ARKG key type',
  );
  invariant(
    mapNumber(map, 3, 'ARKG algorithm') === ARKG_P256_ALGORITHM,
    'INVALID_RESPONSE',
    'Unexpected ARKG seed algorithm',
  );
  invariant(
    mapNumber(map, -3, 'ARKG derived algorithm') === ESP256_ALGORITHM,
    'INVALID_RESPONSE',
    'Unexpected ARKG derived algorithm',
  );
  return {
    kty: ARKG_KEY_TYPE,
    algorithm: ARKG_P256_ALGORITHM,
    derivedAlgorithm: ESP256_ALGORITHM,
    blindingKey: parseCoseEc2PublicKey(map.get(-1)),
    kemKey: parseCoseEc2PublicKey(map.get(-2)),
    encoded: toBase64Url(encoded),
  };
}

export interface DerivedArkgPublicKey {
  publicKey: CoseEc2PublicKey;
  additionalArguments: Uint8Array;
  keyHandle: Uint8Array;
}

export function deriveArkgPublicKey(
  seed: CoseArkgSeedPublicKey,
  ikm: Uint8Array,
  context: Uint8Array,
): DerivedArkgPublicKey {
  invariant(
    ikm.length >= 32,
    'INVALID_INPUT',
    'ARKG IKM must contain at least 32 bytes',
  );
  invariant(
    context.length <= 64,
    'INVALID_INPUT',
    'ARKG context must be at most 64 bytes',
  );
  const ephemeralScalar = hashToScalar(
    ikm,
    concatBytes(DST_KEM_ECDH_KG, DST_KEM),
  );
  const ephemeralSecret = bigintToBytes(ephemeralScalar, 32);
  const ephemeralPublic = p256.getPublicKey(ephemeralSecret, false);
  const sharedSecret = p256
    .getSharedSecret(ephemeralSecret, ecPoint(seed.kemKey), true)
    .slice(1);
  const contextPrime = concatBytes(Uint8Array.of(context.length), context);
  const kemContext = concatBytes(DST_DERIVE_KEY_KEM, contextPrime);
  const macKey = hkdfSha256(
    sharedSecret,
    concatBytes(DST_KEM_HMAC_MAC, DST_KEM, kemContext),
    32,
  );
  const tag = hmac(nobleSha256, macKey, ephemeralPublic).slice(0, 16);
  const ikmTau = hkdfSha256(
    sharedSecret,
    concatBytes(DST_KEM_HMAC_SHARED, DST_KEM, kemContext),
    sharedSecret.length,
  );
  const keyHandle = concatBytes(tag, ephemeralPublic);
  const blindingContext = concatBytes(DST_DERIVE_KEY_BL, contextPrime);
  const tau = hashToScalar(
    ikmTau,
    concatBytes(DST_BL_EC, DST_BL, blindingContext),
  );
  const seedPoint = p256.Point.fromBytes(ecPoint(seed.blindingKey));
  const derivedPoint = seedPoint
    .add(p256.Point.BASE.multiply(tau))
    .toBytes(false);
  const publicKey = keyFromPoint(derivedPoint, ESP256_ALGORITHM);
  const additionalArguments = encodeCbor(
    new Map<unknown, unknown>([
      [3, ESP256_SPLIT_ARKG_PLACEHOLDER],
      [-1, keyHandle],
      [-2, context],
    ]),
  );
  return { publicKey, additionalArguments, keyHandle };
}
