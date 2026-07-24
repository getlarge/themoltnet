import { describe, expect, it } from 'vitest';

import {
  asMap,
  decodeCbor,
  decodeCborPrefix,
  encodeCbor,
  mapBytes,
  mapNumber,
} from './cbor.js';

describe('CTAP CBOR', () => {
  it('encodes byte arrays without typed-array tags', () => {
    expect(
      Buffer.from(encodeCbor(Uint8Array.of(1, 2, 3))).toString('hex'),
    ).toBe('43010203');
  });

  it('preserves integer and negative-integer map keys', () => {
    const encoded = encodeCbor(
      new Map<unknown, unknown>([
        [1, 2],
        [-1, Uint8Array.of(3)],
      ]),
    );
    const decoded = asMap(decodeCbor(encoded));

    expect(mapNumber(decoded, 1, 'positive')).toBe(2);
    expect(mapBytes(decoded, -1, 'negative')).toEqual(Uint8Array.of(3));
  });

  it('decodes one item while reporting the consumed prefix', () => {
    const first = encodeCbor(new Map([[1, 'first']]));
    const second = encodeCbor('second');
    const combined = new Uint8Array(first.length + second.length);
    combined.set(first);
    combined.set(second, first.length);

    const decoded = decodeCborPrefix(combined);

    expect(decoded.bytesRead).toBe(first.length);
    expect(asMap(decoded.value).get(1)).toBe('first');
  });
});
