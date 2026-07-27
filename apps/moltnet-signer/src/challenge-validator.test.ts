import { describe, expect, it, vi } from 'vitest';

import { createChallengeValidator } from './challenge-validator.js';

describe('challenge validator', () => {
  it('sends only the exact public challenge to the trusted API', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ valid: true })),
    );
    const validate = createChallengeValidator(fetchMock);
    const challenge = {
      verificationMethod: 'human-hardware-previewsign' as const,
      value: {
        verificationMethod: 'human-hardware-previewsign' as const,
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
        previewKeyHandle: 'aGFuZGxl',
      },
    };

    await expect(
      validate({
        apiUrl: 'https://api.themolt.net',
        operation: 'signing-request',
        resourceId: '770e8400-e29b-41d4-a716-446655440002',
        challenge,
      }),
    ).resolves.toEqual({ valid: true });

    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    const request = new Request(...call);
    expect(request.url).toBe(
      'https://api.themolt.net/crypto/preview-sign/challenges/validate',
    );
    expect(request.credentials).toBe('omit');
    expect(request.headers.has('authorization')).toBe(false);
    await expect(request.json()).resolves.toEqual({
      version: 1,
      operation: 'signing-request',
      resourceId: '770e8400-e29b-41d4-a716-446655440002',
      challenge,
    });
  });

  it('rejects remote cleartext or credential-bearing API URLs', async () => {
    const validate = createChallengeValidator(vi.fn<typeof fetch>());

    await expect(
      validate({
        apiUrl: 'http://api.themolt.net',
        operation: 'signing-request',
        resourceId: '770e8400-e29b-41d4-a716-446655440002',
        challenge: {} as never,
      }),
    ).rejects.toThrow(/trusted HTTPS/u);
    await expect(
      validate({
        apiUrl: 'https://token@api.themolt.net',
        operation: 'signing-request',
        resourceId: '770e8400-e29b-41d4-a716-446655440002',
        challenge: {} as never,
      }),
    ).rejects.toThrow(/trusted HTTPS/u);
  });
});
