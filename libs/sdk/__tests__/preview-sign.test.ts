import { describe, expect, it } from 'vitest';

import {
  createPreviewSignReceipt,
  decodePreviewSignChallenge,
  PREVIEW_SIGN_VERIFICATION_METHOD,
} from '../src/preview-sign.js';

describe('previewSign SDK helpers', () => {
  it('decodes the exact server digest without hashing or device access', () => {
    const digest = Uint8Array.from({ length: 32 }, (_, index) => index);

    const decoded = decodePreviewSignChallenge({
      verificationMethod: PREVIEW_SIGN_VERIFICATION_METHOD,
      version: 1,
      envelope: 'ZW52ZWxvcGU',
      digest: Buffer.from(digest).toString('base64url'),
      additionalArguments: 'YXJndW1lbnRz',
      outerCredentialId: 'Y3JlZGVudGlhbA',
      outerPublicKey: {
        kty: 2,
        algorithm: -7,
        curve: 1,
        x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        y: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      },
      previewKeyHandle: 'a2V5LWhhbmRsZQ',
    });

    expect(decoded.digest).toEqual(digest);
    expect(new TextDecoder().decode(decoded.envelope)).toBe('envelope');
  });

  it('creates only the typed receipt fields from a DER signature', () => {
    const signature = Uint8Array.of(
      0x30,
      0x06,
      0x02,
      0x01,
      0x01,
      0x02,
      0x01,
      0x01,
    );

    expect(createPreviewSignReceipt(signature)).toEqual({
      verificationMethod: PREVIEW_SIGN_VERIFICATION_METHOD,
      value: {
        version: 1,
        signature: 'MAYCAQECAQE',
      },
    });
  });

  it('rejects a digest that is not exactly 32 bytes', () => {
    expect(() =>
      decodePreviewSignChallenge({
        verificationMethod: PREVIEW_SIGN_VERIFICATION_METHOD,
        version: 1,
        envelope: 'ZW52ZWxvcGU',
        digest: 'AA',
        additionalArguments: 'YXJndW1lbnRz',
        outerCredentialId: 'Y3JlZGVudGlhbA',
        outerPublicKey: {
          kty: 2,
          algorithm: -7,
          curve: 1,
          x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          y: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        },
        previewKeyHandle: 'a2V5LWhhbmRsZQ',
      }),
    ).toThrow(/exactly 32 bytes/u);
  });
});
