import { hkdf } from '@noble/hashes/hkdf';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2';

import { bytesToBigint, concatBytes, sha256, utf8 } from './bytes.js';
import { invariant } from './errors.js';

export const P256_ORDER =
  0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
export const DST_BL = utf8('ARKG-P256');
export const DST_KEM = utf8('ARKG-ECDH.ARKG-P256');
export const DST_KEM_ECDH_KG = utf8('ARKG-KEM-ECDH-KG.');
export const DST_DERIVE_KEY_KEM = utf8('ARKG-Derive-Key-KEM.');
export const DST_KEM_HMAC_MAC = utf8('ARKG-KEM-HMAC-mac.');
export const DST_KEM_HMAC_SHARED = utf8('ARKG-KEM-HMAC-shared.');
export const DST_DERIVE_KEY_BL = utf8('ARKG-Derive-Key-BL.');
export const DST_BL_EC = utf8('ARKG-BL-EC.');

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

export function hashToScalar(message: Uint8Array, dst: Uint8Array): bigint {
  const scalar = bytesToBigint(expandMessageXmd(message, dst, 48)) % P256_ORDER;
  invariant(
    scalar !== 0n,
    'INVALID_RESPONSE',
    'ARKG derived an invalid zero scalar',
  );
  return scalar;
}

export function hkdfSha256(
  input: Uint8Array,
  info: Uint8Array,
  length: number,
): Uint8Array {
  return hkdf(nobleSha256, input, new Uint8Array(), info, length);
}
