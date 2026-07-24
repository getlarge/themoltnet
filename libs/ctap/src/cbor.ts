import cbor from 'cbor';

import { CtapError, invariant } from './errors.js';

export type CborMap = Map<unknown, unknown>;

export interface DecodedCbor {
  value: unknown;
  bytesRead: number;
}

function encodeValue(value: unknown): unknown {
  if (value instanceof Uint8Array && !Buffer.isBuffer(value)) {
    return Buffer.from(value);
  }
  if (Array.isArray(value)) {
    return value.map(encodeValue);
  }
  if (value instanceof Map) {
    return new Map(
      [...value].map(([key, item]) => [encodeValue(key), encodeValue(item)]),
    );
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, encodeValue(item)]),
    );
  }
  return value;
}

function decode(value: Uint8Array, extendedResults: boolean): unknown {
  try {
    return cbor.decodeFirstSync(Buffer.from(value), {
      preferMap: true,
      max_depth: 32,
      extendedResults,
    });
  } catch (error) {
    throw new CtapError('INVALID_RESPONSE', 'Invalid CBOR value', undefined, {
      cause: error,
    });
  }
}

export function encodeCbor(value: unknown): Uint8Array {
  return new Uint8Array(cbor.encodeCanonical(encodeValue(value)));
}

export function decodeCbor(value: Uint8Array): unknown {
  return decode(value, false);
}

export function decodeCborPrefix(value: Uint8Array): DecodedCbor {
  const decoded = decode(value, true) as { value: unknown; length: number };
  return { value: decoded.value, bytesRead: decoded.length };
}

export function asMap(value: unknown, field = 'CBOR value'): CborMap {
  invariant(
    value instanceof Map,
    'INVALID_RESPONSE',
    `${field} must be a CBOR map`,
  );
  return value;
}

export function mapNumber(map: CborMap, key: unknown, field: string): number {
  const value = map.get(key);
  invariant(
    typeof value === 'number',
    'INVALID_RESPONSE',
    `${field} must be a number`,
  );
  return value;
}

export function mapBytes(
  map: CborMap,
  key: unknown,
  field: string,
): Uint8Array {
  const value = map.get(key);
  invariant(
    value instanceof Uint8Array || Buffer.isBuffer(value),
    'INVALID_RESPONSE',
    `${field} must be bytes`,
  );
  return new Uint8Array(value);
}

export function mapString(map: CborMap, key: unknown, field: string): string {
  const value = map.get(key);
  invariant(
    typeof value === 'string',
    'INVALID_RESPONSE',
    `${field} must be a string`,
  );
  return value;
}
