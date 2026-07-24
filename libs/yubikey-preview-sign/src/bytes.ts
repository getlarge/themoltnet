import { sha256 as nobleSha256 } from '@noble/hashes/sha2';

import { PreviewSignError } from './errors.js';

const textEncoder = new TextEncoder();

/*
 * These helpers intentionally remain isomorphic and private to this package.
 * The similarly named CTAP helpers use Node crypto/Buffer and cannot be pulled
 * into the browser-safe `./verify` dependency graph.
 */
export function utf8(value: string): Uint8Array {
  return textEncoder.encode(value);
}

export function concatBytes(...values: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    values.reduce((total, value) => total + value.length, 0),
  );
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

export function sha256(value: Uint8Array): Uint8Array {
  return nobleSha256(value);
}

export function toBase64Url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

export function fromBase64Url(
  value: string,
  field = 'binary value',
): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) {
    throw new PreviewSignError(
      'INVALID_RESPONSE',
      `${field} is not valid base64url`,
    );
  }
  const padded = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const decoded = Uint8Array.from(binary, (character) =>
    character.charCodeAt(0),
  );
  if (toBase64Url(decoded) !== value) {
    throw new PreviewSignError(
      'INVALID_RESPONSE',
      `${field} is not canonical base64url`,
    );
  }
  return decoded;
}

export function toHex(value: Uint8Array): string {
  return [...value].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function fromHex(value: string): Uint8Array {
  if (!/^(?:[0-9a-fA-F]{2})*$/u.test(value)) {
    throw new PreviewSignError(
      'INVALID_RESPONSE',
      'Invalid hexadecimal string',
    );
  }
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
}

export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export function readU32be(value: Uint8Array, offset: number): number {
  return (
    ((value[offset] ?? 0) * 0x1000000 +
      ((value[offset + 1] ?? 0) << 16) +
      ((value[offset + 2] ?? 0) << 8) +
      (value[offset + 3] ?? 0)) >>>
    0
  );
}

export function bigintToBytes(value: bigint, length: number): Uint8Array {
  return fromHex(value.toString(16).padStart(length * 2, '0'));
}

export function bytesToBigint(value: Uint8Array): bigint {
  return value.length === 0 ? 0n : BigInt(`0x${toHex(value)}`);
}
