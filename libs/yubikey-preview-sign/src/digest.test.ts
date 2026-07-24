import { describe, expect, it } from 'vitest';

import { toHex, utf8 } from './bytes.js';
import { createPreviewSignDigestV1 } from './digest.js';

describe('previewSign digest v1', () => {
  it.each([
    {
      payload: 'Sign this document.',
      digest:
        'a55b8d1a797adbed9ba1a246dcc5ed2772755f13eb8ffc95f0bb5e0fad6f813d',
    },
    {
      payload: 'New message',
      digest:
        '78f5975a5d705e9528dd0e8d41206534b7e8c269b139bb151d5c0ca0928247c3',
    },
  ])(
    'matches the Yubico-style SHA-256 vector for $payload',
    ({ payload, digest }) => {
      expect(toHex(createPreviewSignDigestV1(utf8(payload)))).toBe(digest);
    },
  );

  it('hashes caller-provided bytes without a prefix or CBOR envelope', () => {
    const digest = createPreviewSignDigestV1(Uint8Array.of(0x01, 0x02));

    expect(toHex(digest)).toBe(
      'a12871fee210fb8619291eaea194581cbd2531e4b23759d225f6806923f63222',
    );
  });
});
