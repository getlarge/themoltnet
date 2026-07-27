import { VERIFICATION_METHOD } from '@moltnet/models';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockServices,
  createTestApp,
  type MockServices,
} from './helpers.js';

const REGISTRATION_ID = '660e8400-e29b-41d4-a716-446655440001';
const TEAM_ID = '770e8400-e29b-41d4-a716-446655440002';
const HUMAN_ID = '880e8400-e29b-41d4-a716-446655440003';

const challenge = {
  verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
  value: {
    verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
    version: 1 as const,
    envelope: 'ZW52ZWxvcGU',
    digest: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    additionalArguments: 'YXJndW1lbnRz',
    outerCredentialId: 'b3V0ZXItY3JlZGVudGlhbA',
    outerPublicKey: {
      kty: 2 as const,
      algorithm: -7 as const,
      curve: 1 as const,
      x: 'bTvfMdDbSJiPFtRwSP3SQSPNKG5C0FEtqp9ya07PGN8',
      y: 'Ze1CFpxpZ1-Tb_feX5vZOtvI6nMDaxbo2Qrb-r2t26c',
    },
    previewKeyHandle: 'cHJldmlldy1rZXktaGFuZGxl',
  },
};

describe('previewSign challenge validation route', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, null);
  });

  it('validates an exact persisted challenge without human authentication', async () => {
    mocks.signingCredentialRepository.findRegistrationById.mockResolvedValue({
      id: REGISTRATION_ID,
      ownerHumanId: HUMAN_ID,
      teamId: TEAM_ID,
      verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
      credentialType: 'preview-sign-arkg',
      algorithm: 'arkg-p256-esp256',
      label: 'Operator key',
      challenge,
      methodState: {
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        value: {},
      },
      expiresAt: new Date(Date.now() + 300_000),
      consumedAt: null,
      createdAt: new Date(),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/crypto/preview-sign/challenges/validate',
      payload: {
        version: 1,
        operation: 'credential-registration',
        resourceId: REGISTRATION_ID,
        challenge,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ valid: true });
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(
      mocks.signingCredentialRepository.findRegistrationById,
    ).toHaveBeenCalledWith(REGISTRATION_ID);
  });

  it('rejects auth material before repository access', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/crypto/preview-sign/challenges/validate',
      headers: { authorization: 'Bearer must-not-cross-loopback' },
      payload: {
        version: 1,
        operation: 'credential-registration',
        resourceId: REGISTRATION_ID,
        challenge,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(
      mocks.signingCredentialRepository.findRegistrationById,
    ).not.toHaveBeenCalled();
  });

  it('rejects unknown nested challenge fields through the TypeBox contract', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/crypto/preview-sign/challenges/validate',
      payload: {
        version: 1,
        operation: 'credential-registration',
        resourceId: REGISTRATION_ID,
        challenge: {
          ...challenge,
          value: {
            ...challenge.value,
            clientChosenDigest: 'must-not-be-accepted',
          },
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(
      mocks.signingCredentialRepository.findRegistrationById,
    ).not.toHaveBeenCalled();
  });

  it('uses one uniform not-found response for missing or stale state', async () => {
    mocks.signingCredentialRepository.findRegistrationById.mockResolvedValue(
      null,
    );

    const response = await app.inject({
      method: 'POST',
      url: '/crypto/preview-sign/challenges/validate',
      payload: {
        version: 1,
        operation: 'credential-registration',
        resourceId: REGISTRATION_ID,
        challenge,
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      status: 404,
      title: 'Not Found',
    });
    expect(JSON.stringify(response.json())).not.toContain(REGISTRATION_ID);
  });
});
