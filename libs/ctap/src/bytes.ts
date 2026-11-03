import { createHash, timingSafeEqual } from 'node:crypto';

// Node-only transport primitives; intentionally not part of the root API.
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
  return new Uint8Array(createHash('sha256').update(value).digest());
}

export function toBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

export function u16be(value: number): Uint8Array {
  return Uint8Array.of((value >>> 8) & 0xff, value & 0xff);
}

export function u32be(value: number): Uint8Array {
  return Uint8Array.of(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );
}

export function readU16be(value: Uint8Array, offset: number): number {
  return ((value[offset] ?? 0) << 8) | (value[offset + 1] ?? 0);
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

export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right))
  );
}
