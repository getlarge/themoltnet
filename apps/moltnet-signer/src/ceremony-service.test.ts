import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { canonicalJsonBytes } from '@moltnet/crypto-service';
import { describe, expect, it, vi } from 'vitest';

import {
  SignerCeremonyError,
  SignerCeremonyService,
  type SignerDevice,
} from './ceremony-service.js';

const CONSOLE_ORIGIN = 'https://console.themolt.net';
const API_URL = 'https://api.themolt.net';
const NOW = new Date('2030-08-01T12:00:00.000Z');
const serverVector = JSON.parse(
  readFileSync(
    new URL(
      '../../../libs/signing-workflows/src/fixtures/preview-sign-server-v1.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as {
  challenge: {
    additionalArguments: string;
    digest: string;
    envelope: string;
    outerCredentialId: string;
    outerPublicKey: {
      algorithm: -7;
      curve: 1;
      kty: 2;
      x: string;
      y: string;
    };
    previewKeyHandle: string;
    verificationMethod: 'human-hardware-previewsign';
    version: 1;
  };
  credential: {
    publicMaterial: {
      outerCredentialId: string;
      outerPublicKey: {
        algorithm: -7;
        curve: 1;
        kty: 2;
        x: string;
        y: string;
      };
      previewKeyHandle: string;
      seedPublicKey: {
        algorithm: -65700;
        blindingKey: {
          algorithm: -7;
          curve: 1;
          kty: 2;
          x: string;
          y: string;
        };
        derivedAlgorithm: -9;
        kemKey: {
          algorithm: -25;
          curve: 1;
          kty: 2;
          x: string;
          y: string;
        };
        kty: -65537;
      };
      version: 1;
    };
  };
  receipt: { signature: string };
  request: {
    expiresAt: string;
    purpose: string;
    requestId: string;
    teamId: string;
  };
};

function device() {
  return {
    enroll: vi.fn(),
    signPreparedDigest: vi.fn(() =>
      Promise.resolve(Buffer.from(serverVector.receipt.signature, 'base64url')),
    ),
  } satisfies SignerDevice;
}

function signingCeremonyRequest() {
  return {
    version: 1 as const,
    operation: 'signing-request' as const,
    resourceId: serverVector.request.requestId,
    challenge: {
      verificationMethod: 'human-hardware-previewsign' as const,
      value: serverVector.challenge,
    },
  };
}

function makeService(options: {
  signerDevice?: SignerDevice;
  validateChallenge?: () => Promise<{ valid: true }>;
}) {
  let sequence = 0;
  return new SignerCeremonyService({
    allowedOrigins: [CONSOLE_ORIGIN],
    apiUrl: API_URL,
    device: options.signerDevice ?? device(),
    validateChallenge:
      options.validateChallenge ??
      vi.fn(() => Promise.resolve({ valid: true as const })),
    now: () => NOW,
    randomToken: () => `test-token-${++sequence}`,
  });
}

describe('SignerCeremonyService', () => {
  it('rejects an unapproved origin before issuing a session or touching a device', () => {
    const signerDevice = device();
    const service = makeService({ signerDevice });

    expect(() =>
      service.createSession({ origin: 'https://attacker.example' }),
    ).toThrowError(
      new SignerCeremonyError('origin_not_allowed', 'Origin is not allowed'),
    );
    expect(signerDevice.enroll).not.toHaveBeenCalled();
    expect(signerDevice.signPreparedDigest).not.toHaveBeenCalled();
  });

  it('requires the origin-bound process capability for every ceremony operation', async () => {
    const service = makeService({});
    service.createSession({ origin: CONSOLE_ORIGIN });

    await expect(
      service.createCeremony({
        origin: CONSOLE_ORIGIN,
        sessionToken: 'wrong-token',
        request: signingCeremonyRequest(),
      }),
    ).rejects.toMatchObject({ code: 'session_invalid' });
  });

  it('validates persisted state before display and again after explicit confirmation', async () => {
    const signerDevice = device();
    const validateChallenge = vi.fn(() =>
      Promise.resolve({ valid: true as const }),
    );
    const service = makeService({ signerDevice, validateChallenge });
    const session = service.createSession({ origin: CONSOLE_ORIGIN });

    const ceremony = await service.createCeremony({
      origin: CONSOLE_ORIGIN,
      sessionToken: session.token,
      request: signingCeremonyRequest(),
    });

    expect(validateChallenge).toHaveBeenCalledTimes(1);
    expect(validateChallenge).toHaveBeenLastCalledWith({
      apiUrl: API_URL,
      operation: 'signing-request',
      resourceId: serverVector.request.requestId,
      challenge: signingCeremonyRequest().challenge,
    });
    expect(signerDevice.signPreparedDigest).not.toHaveBeenCalled();

    const approval = service.getApproval(ceremony.id);
    expect(approval.display).toMatchObject({
      action: serverVector.request.purpose,
      audience: 'moltnet:preview-sign',
      expiresAt: serverVector.request.expiresAt,
      operation: 'signing-request',
      teamId: serverVector.request.teamId,
    });
    await service.confirmCeremony({
      ceremonyId: ceremony.id,
      confirmationToken: approval.confirmationToken,
    });

    expect(validateChallenge).toHaveBeenCalledTimes(2);
    expect(signerDevice.signPreparedDigest).toHaveBeenCalledTimes(1);
  });

  it('passes the exact 32-byte envelope digest and server ARKG arguments without rehashing', async () => {
    const signerDevice = device();
    const service = makeService({ signerDevice });
    const session = service.createSession({ origin: CONSOLE_ORIGIN });
    const ceremony = await service.createCeremony({
      origin: CONSOLE_ORIGIN,
      sessionToken: session.token,
      request: signingCeremonyRequest(),
    });

    await service.confirmCeremony({
      ceremonyId: ceremony.id,
      confirmationToken: service.getApproval(ceremony.id).confirmationToken,
    });

    const envelope = Buffer.from(serverVector.challenge.envelope, 'base64url');
    expect(createHash('sha256').update(envelope).digest('base64url')).toBe(
      serverVector.challenge.digest,
    );
    expect(signerDevice.signPreparedDigest).toHaveBeenCalledWith({
      digest: Buffer.from(serverVector.challenge.digest, 'base64url'),
      additionalArguments: Buffer.from(
        serverVector.challenge.additionalArguments,
        'base64url',
      ),
      outerCredentialId: Buffer.from(
        serverVector.challenge.outerCredentialId,
        'base64url',
      ),
      outerPublicKey: serverVector.challenge.outerPublicKey,
      previewKeyHandle: Buffer.from(
        serverVector.challenge.previewKeyHandle,
        'base64url',
      ),
    });
    expect(
      createHash('sha256')
        .update(Buffer.from(serverVector.challenge.digest, 'base64url'))
        .digest('base64url'),
    ).not.toBe(serverVector.challenge.digest);
  });

  it('rejects mutated, non-canonical, or expired envelopes before device access', async () => {
    const signerDevice = device();
    const service = makeService({ signerDevice });
    const session = service.createSession({ origin: CONSOLE_ORIGIN });
    const request = signingCeremonyRequest();
    const parsed = JSON.parse(
      Buffer.from(request.challenge.value.envelope, 'base64url').toString(
        'utf8',
      ),
    ) as Record<string, unknown>;
    const nonCanonical = Buffer.from(
      JSON.stringify(Object.fromEntries(Object.entries(parsed).reverse())),
    ).toString('base64url');

    for (const challenge of [
      { ...request.challenge.value, digest: 'A'.repeat(43) },
      {
        ...request.challenge.value,
        envelope: nonCanonical,
        digest: createHash('sha256')
          .update(Buffer.from(nonCanonical, 'base64url'))
          .digest('base64url'),
      },
      {
        ...request.challenge.value,
        envelope: Buffer.from(
          canonicalJsonBytes({
            ...parsed,
            expiresAt: '2029-01-01T00:00:00.000Z',
          }),
        ).toString('base64url'),
      },
    ]) {
      await expect(
        service.createCeremony({
          origin: CONSOLE_ORIGIN,
          sessionToken: session.token,
          request: {
            ...request,
            challenge: { ...request.challenge, value: challenge },
          },
        }),
      ).rejects.toMatchObject({ code: 'challenge_invalid' });
    }
    expect(signerDevice.signPreparedDigest).not.toHaveBeenCalled();
  });

  it('returns only public enrollment material and a typed low-S receipt', async () => {
    const signerDevice = device();
    const publicMaterial = {
      version: 1,
      outerCredentialId:
        serverVector.credential.publicMaterial.outerCredentialId,
      outerPublicKey: serverVector.credential.publicMaterial.outerPublicKey,
      previewKeyHandle: serverVector.credential.publicMaterial.previewKeyHandle,
      seedPublicKey: serverVector.credential.publicMaterial.seedPublicKey,
    } as const;
    vi.mocked(signerDevice.enroll).mockResolvedValueOnce(publicMaterial);
    const service = makeService({ signerDevice });
    const session = service.createSession({ origin: CONSOLE_ORIGIN });
    const enrollment = await service.createCeremony({
      origin: CONSOLE_ORIGIN,
      sessionToken: session.token,
      request: {
        version: 1,
        operation: 'credential-enrollment',
        label: 'Operator key',
        teamId: serverVector.request.teamId,
      },
    });

    await service.confirmCeremony({
      ceremonyId: enrollment.id,
      confirmationToken: service.getApproval(enrollment.id).confirmationToken,
    });
    const result = service.getResult({
      ceremonyId: enrollment.id,
      origin: CONSOLE_ORIGIN,
      sessionToken: session.token,
    });

    expect(result).toEqual({
      version: 1,
      status: 'completed',
      operation: 'credential-enrollment',
      publicMaterial,
    });
    expect(result).not.toHaveProperty('attestation');
    expect(result).not.toHaveProperty('device');
    expect(result).not.toHaveProperty('ikm');
  });
});
