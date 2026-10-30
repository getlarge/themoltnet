import { p256 } from '@noble/curves/nist.js';
import { describe, expect, it, vi } from 'vitest';

import {
  createPreviewSignReceipt,
  decodePreviewSignChallenge,
  PREVIEW_SIGN_VERIFICATION_METHOD,
  validatePreviewSignChallenge,
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

  it('normalizes a high-S authenticator signature before creating a receipt', () => {
    const privateKey = new Uint8Array(32).fill(11);
    const digest = new Uint8Array(32).fill(12);
    const low = p256.Signature.fromBytes(
      p256.sign(digest, privateKey, {
        format: 'der',
        prehash: false,
        lowS: true,
      }),
      'der',
    );
    const high = new p256.Signature(
      low.r,
      p256.Point.CURVE().n - low.s,
      low.recovery,
    ).toBytes('der');

    const receipt = createPreviewSignReceipt(high);
    const normalized = p256.Signature.fromBytes(
      Buffer.from(receipt.value.signature, 'base64url'),
      'der',
    );

    expect(normalized.hasHighS()).toBe(false);
    expect(normalized.r).toBe(low.r);
    expect(normalized.s).toBe(low.s);
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

  it('validates a challenge without sending credentials or auth headers', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ valid: true }),
    );
    const challenge = {
      verificationMethod: PREVIEW_SIGN_VERIFICATION_METHOD,
      value: {
        verificationMethod: PREVIEW_SIGN_VERIFICATION_METHOD,
        version: 1 as const,
        envelope: 'ZW52ZWxvcGU',
        digest: 'A'.repeat(43),
        additionalArguments: 'YXJndW1lbnRz',
        outerCredentialId: 'Y3JlZGVudGlhbA',
        outerPublicKey: {
          kty: 2 as const,
          algorithm: -7 as const,
          curve: 1 as const,
          x: 'B'.repeat(43),
          y: 'C'.repeat(43),
        },
        previewKeyHandle: 'a2V5LWhhbmRsZQ',
      },
    };

    await expect(
      validatePreviewSignChallenge({
        apiUrl: 'https://api.themolt.net',
        fetch: fetchMock,
        operation: 'signing-request',
        resourceId: '770e8400-e29b-41d4-a716-446655440002',
        challenge,
      }),
    ).resolves.toEqual({ valid: true });

    const [input, init] = fetchMock.mock.calls[0]!;
    const httpRequest =
      input instanceof Request ? input : new Request(input, init);
    expect(httpRequest.credentials).toBe('omit');
    expect(httpRequest.headers.has('authorization')).toBe(false);
    await expect(httpRequest.clone().json()).resolves.toEqual({
      version: 1,
      operation: 'signing-request',
      resourceId: '770e8400-e29b-41d4-a716-446655440002',
      challenge,
    });
  });
});
