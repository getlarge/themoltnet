import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  computeBytesCid,
  computeBytesCidFromSha256,
  decodeBytesCidToSha256,
} from '../src/bytes-cid.js';
import { computeJsonCid } from '../src/json-cid.js';

describe('decodeBytesCidToSha256', () => {
  it('round-trips the digest of computeBytesCid', async () => {
    const bytes = new TextEncoder().encode('hello artifact');
    const expectedHex = createHash('sha256').update(bytes).digest('hex');

    const cid = await computeBytesCid(bytes);

    expect(decodeBytesCidToSha256(cid)).toEqual(expectedHex);
  });

  it('round-trips a digest through computeBytesCidFromSha256', () => {
    const digest = createHash('sha256').update('payload').digest();

    const cid = computeBytesCidFromSha256(digest);

    expect(decodeBytesCidToSha256(cid)).toEqual(digest.toString('hex'));
  });

  it('rejects a non-raw-codec CID', async () => {
    const jsonCid = await computeJsonCid({ some: 'value' });

    expect(() => decodeBytesCidToSha256(jsonCid)).toThrow(/raw-bytes sha2-256/);
  });

  it('rejects malformed input', () => {
    expect(() => decodeBytesCidToSha256('not-a-cid')).toThrow();
    expect(() => decodeBytesCidToSha256('')).toThrow();
  });
});
