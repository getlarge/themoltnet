import type { AuthContext } from '@moltnet/auth';
import { VERIFICATION_METHOD } from '@moltnet/models';
import {
  _resetSigningWorkflowsForTesting,
  createPreviewSignSigningMethodDriver,
  PREVIEW_SIGN_ALGORITHM,
  PREVIEW_SIGN_CREDENTIAL_TYPE,
  PREVIEW_SIGN_PUBLIC_MATERIAL_VERSION,
  PREVIEW_SIGN_RECEIPT_VERSION,
  type PreviewSignPublicMaterialV1,
  registerSigningMethodDriver,
  SigningReceiptInvalidError,
} from '@moltnet/signing-workflows';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSigningService } from './signing-service.js';
import type { SigningServiceDeps } from './signing-service.types.js';
import type { SigningServiceError } from './signing-service-error.js';

const agent = {
  subjectType: 'agent',
  identityId: 'agent-identity',
} as Extract<AuthContext, { subjectType: 'agent' }>;

const human = {
  subjectType: 'human',
  identityId: 'human-identity',
  humanId: 'human-id',
} as Extract<AuthContext, { subjectType: 'human' }>;

const TEAM_ID = 'team-id';
const REGISTRATION_ID = 'registration-id';
const REQUEST_ID = 'request-id';
const CREDENTIAL_ID = 'credential-id';
const IKM = Uint8Array.from({ length: 32 }, (_, index) => 0x40 + index);
const SIGNATURE =
  'MEUCIQCEfiAIvamLdwfaDHCI2epg4Si6E3bAHlRDC6bl2fyNXAIgaRLbpQLIurx8zaf63gYqpcGF8CsP8kTMFNu9q2B2ORY';

function publicMaterial(): PreviewSignPublicMaterialV1 {
  const blindingKey = {
    kty: 2 as const,
    algorithm: -7,
    curve: 1 as const,
    x: 'bTvfMdDbSJiPFtRwSP3SQSPNKG5C0FEtqp9ya07PGN8',
    y: 'Ze1CFpxpZ1-Tb_feX5vZOtvI6nMDaxbo2Qrb-r2t26c',
  };
  return {
    version: PREVIEW_SIGN_PUBLIC_MATERIAL_VERSION,
    outerCredentialId: 'b3V0ZXItY3JlZGVudGlhbA',
    outerPublicKey: blindingKey,
    previewKeyHandle: 'cHJldmlldy1rZXktaGFuZGxl',
    seedPublicKey: {
      kty: -65537,
      algorithm: -65700,
      derivedAlgorithm: -9,
      blindingKey,
      kemKey: {
        kty: 2,
        algorithm: -25,
        curve: 1,
        x: 'w4u91yhhlnM_oXfkO3PP09bXLNEcwLsskjbPhaQtz_U',
        y: '36M5weB9_N_ajXvipaPHOCmR84ff4zKx3Y2m4GIs-zU',
      },
    },
  };
}

function reorderedPublicMaterial(): PreviewSignPublicMaterialV1 {
  const material = publicMaterial();
  const reorder = (key: PreviewSignPublicMaterialV1['outerPublicKey']) => ({
    algorithm: key.algorithm,
    curve: key.curve,
    kty: key.kty,
    y: key.y,
    x: key.x,
  });
  return {
    previewKeyHandle: material.previewKeyHandle,
    seedPublicKey: {
      kemKey: reorder(material.seedPublicKey.kemKey),
      derivedAlgorithm: material.seedPublicKey.derivedAlgorithm,
      blindingKey: reorder(material.seedPublicKey.blindingKey),
      algorithm: material.seedPublicKey.algorithm,
      kty: material.seedPublicKey.kty,
    },
    outerPublicKey: reorder(material.outerPublicKey),
    outerCredentialId: material.outerCredentialId,
    version: material.version,
  };
}

function createDeps(
  overrides: Partial<SigningServiceDeps> = {},
): SigningServiceDeps {
  return {
    signingCredentialRepository: {} as never,
    signingRequestRepository: {
      list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    } as never,
    transactionRunner: {} as never,
    permissionChecker: {
      canAccessTeam: vi.fn().mockResolvedValue(true),
      canManageTeamCredentials: vi.fn().mockResolvedValue(false),
    } as never,
    relationshipReader: {} as never,
    groupRepository: {} as never,
    signingTimeoutSeconds: 300,
    maxPendingSigningRequests: 10,
    ...overrides,
  };
}

function pendingRequest() {
  return {
    id: REQUEST_ID,
    agentId: 'requester-agent',
    verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
    requestedBy: { id: 'requester-agent', type: 'agent' as const },
    signerConstraint: { id: human.humanId, type: 'human' as const },
    teamId: TEAM_ID,
    purpose: 'Approve production deployment',
    claimedByHumanId: null,
    signingCredentialId: null,
    challenge: null,
    methodState: null,
    receipt: null,
    message: 'deployment-cid',
    nonce: 'request-nonce',
    status: 'pending' as const,
    signature: null,
    valid: null,
    workflowId: null,
    createdAt: new Date('2026-08-01T12:00:00.000Z'),
    expiresAt: new Date('2026-08-01T12:05:00.000Z'),
    completedAt: null,
    claimedAt: null,
    rejectedAt: null,
    rejectionReason: null,
  };
}

function activeCredential() {
  return {
    id: CREDENTIAL_ID,
    ownerAgentId: null,
    ownerHumanId: human.humanId,
    teamId: TEAM_ID,
    verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
    credentialType: PREVIEW_SIGN_CREDENTIAL_TYPE,
    algorithm: PREVIEW_SIGN_ALGORITHM,
    publicMaterial: publicMaterial(),
    enrollmentEvidence: { version: 1 },
    label: 'Production key',
    status: 'active' as const,
    approvedByHumanId: 'manager-id',
    createdAt: new Date('2026-08-01T11:00:00.000Z'),
    updatedAt: new Date('2026-08-01T11:05:00.000Z'),
    activatedAt: new Date('2026-08-01T11:05:00.000Z'),
    suspendedAt: null,
    revokedAt: null,
  };
}

function companionChallenge() {
  return {
    verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
    value: {
      verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
      version: 1,
      envelope: 'ZW52ZWxvcGU',
      digest: 'ZGlnaWVzdA',
      additionalArguments: 'YXJrZy1hcmdz',
      outerCredentialId: 'b3V0ZXItY3JlZGVudGlhbA',
      outerPublicKey: publicMaterial().outerPublicKey,
      previewKeyHandle: 'cHJldmlldy1rZXktaGFuZGxl',
    },
  };
}

describe('createSigningService', () => {
  beforeEach(() => {
    _resetSigningWorkflowsForTesting();
    const driver = createPreviewSignSigningMethodDriver({
      randomBytes: () => IKM,
      verifyPrehashedSignature: vi.fn().mockReturnValue(true),
    });
    registerSigningMethodDriver(driver.verificationMethod, driver);
  });

  it('keeps signing credentials and signing requests behind one boundary', () => {
    const service = createSigningService(createDeps());

    expect(service.credentials).toBeDefined();
    expect(service.requests).toBeDefined();
    expect(service.challengeValidation).toBeDefined();
  });

  it('validates an exact unconsumed registration challenge without an auth context', async () => {
    const challenge = companionChallenge();
    const findRegistrationById = vi.fn().mockResolvedValue({
      id: REGISTRATION_ID,
      ownerHumanId: human.humanId,
      teamId: TEAM_ID,
      verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
      credentialType: PREVIEW_SIGN_CREDENTIAL_TYPE,
      algorithm: PREVIEW_SIGN_ALGORITHM,
      label: 'Production key',
      challenge,
      methodState: {
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        value: {},
      },
      expiresAt: new Date('2026-08-01T12:05:00.000Z'),
      consumedAt: null,
      createdAt: new Date('2026-08-01T12:00:00.000Z'),
    });
    const deps = createDeps({
      now: () => new Date('2026-08-01T12:01:00.000Z'),
      signingCredentialRepository: { findRegistrationById } as never,
    });
    const service = createSigningService(deps);

    await expect(
      service.challengeValidation.validateChallenge({
        operation: 'credential-registration',
        resourceId: REGISTRATION_ID,
        challenge,
      }),
    ).resolves.toEqual({ valid: true });
    expect(deps.permissionChecker.canAccessTeam).not.toHaveBeenCalled();
  });

  it.each([
    ['missing registration', null],
    [
      'consumed registration',
      {
        consumedAt: new Date('2026-08-01T12:00:30.000Z'),
        expiresAt: new Date('2026-08-01T12:05:00.000Z'),
      },
    ],
    [
      'expired registration',
      {
        consumedAt: null,
        expiresAt: new Date('2026-08-01T12:00:30.000Z'),
      },
    ],
  ])('returns one uniform error for an invalid %s', async (_name, state) => {
    const challenge = companionChallenge();
    const findRegistrationById = vi.fn().mockResolvedValue(
      state && {
        id: REGISTRATION_ID,
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        challenge,
        ...state,
      },
    );
    const service = createSigningService(
      createDeps({
        now: () => new Date('2026-08-01T12:01:00.000Z'),
        signingCredentialRepository: { findRegistrationById } as never,
      }),
    );

    await expect(
      service.challengeValidation.validateChallenge({
        operation: 'credential-registration',
        resourceId: REGISTRATION_ID,
        challenge,
      }),
    ).rejects.toMatchObject({
      name: 'SigningServiceError',
      code: 'not_found',
      message: 'Signing challenge is not valid',
    });
  });

  it('rejects a mutated challenge with the same uniform error', async () => {
    const challenge = companionChallenge();
    const service = createSigningService(
      createDeps({
        now: () => new Date('2026-08-01T12:01:00.000Z'),
        signingCredentialRepository: {
          findRegistrationById: vi.fn().mockResolvedValue({
            id: REGISTRATION_ID,
            verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
            challenge,
            consumedAt: null,
            expiresAt: new Date('2026-08-01T12:05:00.000Z'),
          }),
        } as never,
      }),
    );

    await expect(
      service.challengeValidation.validateChallenge({
        operation: 'credential-registration',
        resourceId: REGISTRATION_ID,
        challenge: {
          ...challenge,
          value: { ...challenge.value, digest: 'bXV0YXRlZA' },
        },
      }),
    ).rejects.toMatchObject({
      code: 'not_found',
      message: 'Signing challenge is not valid',
    });
  });

  it('validates only a claimed request with its still-active bound credential', async () => {
    const challenge = companionChallenge();
    const credential = activeCredential();
    const request = {
      ...pendingRequest(),
      status: 'claimed' as const,
      claimedByHumanId: human.humanId,
      signingCredentialId: credential.id,
      challenge,
      methodState: {
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        value: {},
      },
      claimedAt: new Date('2026-08-01T12:00:30.000Z'),
    };
    const findActiveCompatible = vi.fn().mockResolvedValue(credential);
    const service = createSigningService(
      createDeps({
        now: () => new Date('2026-08-01T12:01:00.000Z'),
        signingRequestRepository: {
          findById: vi.fn().mockResolvedValue(request),
        } as never,
        signingCredentialRepository: { findActiveCompatible } as never,
      }),
    );

    await expect(
      service.challengeValidation.validateChallenge({
        operation: 'signing-request',
        resourceId: REQUEST_ID,
        challenge,
      }),
    ).resolves.toEqual({ valid: true });
    expect(findActiveCompatible).toHaveBeenCalledWith({
      id: credential.id,
      ownerHumanId: human.humanId,
      teamId: TEAM_ID,
      verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
    });
  });

  it.each(['pending', 'completed', 'rejected', 'expired'] as const)(
    'rejects a request in %s state before credential lookup',
    async (status) => {
      const challenge = companionChallenge();
      const findActiveCompatible = vi.fn();
      const service = createSigningService(
        createDeps({
          now: () => new Date('2026-08-01T12:01:00.000Z'),
          signingRequestRepository: {
            findById: vi.fn().mockResolvedValue({
              ...pendingRequest(),
              status,
              challenge,
            }),
          } as never,
          signingCredentialRepository: { findActiveCompatible } as never,
        }),
      );

      await expect(
        service.challengeValidation.validateChallenge({
          operation: 'signing-request',
          resourceId: REQUEST_ID,
          challenge,
        }),
      ).rejects.toMatchObject({
        code: 'not_found',
        message: 'Signing challenge is not valid',
      });
      expect(findActiveCompatible).not.toHaveBeenCalled();
    },
  );

  it('returns no signable requests for an agent without querying storage', async () => {
    const deps = createDeps();
    const service = createSigningService(deps);

    const result = await service.requests.list({
      actor: agent,
      scope: 'signable',
    });

    expect(result).toEqual({ items: [], total: 0 });
    expect(deps.signingRequestRepository.list).not.toHaveBeenCalled();
  });

  it('validates delegated request metadata before repository writes', async () => {
    const create = vi.fn();
    const service = createSigningService(
      createDeps({
        signingRequestRepository: { create } as never,
      }),
    );

    await expect(
      service.requests.create({
        actor: agent,
        message: 'approve release',
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
      }),
    ).rejects.toMatchObject({
      name: 'SigningServiceError',
      code: 'validation_failed',
    } satisfies Partial<SigningServiceError>);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects creation when the requester has reached the pending cap', async () => {
    const acquirePendingCreateLock = vi.fn().mockResolvedValue(undefined);
    const countActivePendingByAgent = vi.fn().mockResolvedValue(10);
    const create = vi.fn();
    const transactionRunner = {
      runInTransaction: vi.fn(async (task) => task()),
    };
    const service = createSigningService(
      createDeps({
        signingRequestRepository: {
          acquirePendingCreateLock,
          countActivePendingByAgent,
          create,
        } as never,
        transactionRunner: transactionRunner as never,
      }),
    );

    await expect(
      service.requests.create({
        actor: agent,
        message: 'approve release',
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        teamId: TEAM_ID,
        purpose: 'Release approval',
        signerConstraint: { id: human.humanId, type: 'human' },
      }),
    ).rejects.toMatchObject({
      name: 'SigningServiceError',
      code: 'signing_request_limit_reached',
    } satisfies Partial<SigningServiceError>);
    expect(transactionRunner.runInTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      { name: 'create-signing-request' },
    );
    expect(acquirePendingCreateLock).toHaveBeenCalledWith(agent.identityId);
    expect(countActivePendingByAgent).toHaveBeenCalledWith(agent.identityId);
    expect(create).not.toHaveBeenCalled();
  });

  it('creates below the pending cap inside the guarded transaction', async () => {
    const created = pendingRequest();
    const acquirePendingCreateLock = vi.fn().mockResolvedValue(undefined);
    const countActivePendingByAgent = vi.fn().mockResolvedValue(9);
    const create = vi.fn().mockResolvedValue(created);
    const transactionRunner = {
      runInTransaction: vi.fn(async (task) => task()),
    };
    const service = createSigningService(
      createDeps({
        signingRequestRepository: {
          acquirePendingCreateLock,
          countActivePendingByAgent,
          create,
        } as never,
        transactionRunner: transactionRunner as never,
      }),
    );

    await expect(
      service.requests.create({
        actor: agent,
        message: 'approve release',
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        teamId: TEAM_ID,
        purpose: 'Release approval',
        signerConstraint: { id: human.humanId, type: 'human' },
      }),
    ).resolves.toBe(created);
    expect(acquirePendingCreateLock).toHaveBeenCalledBefore(
      countActivePendingByAgent,
    );
    expect(countActivePendingByAgent).toHaveBeenCalledBefore(create);
  });

  it('requires a human actor to approve a credential', async () => {
    const transition = vi.fn();
    const service = createSigningService(
      createDeps({
        signingCredentialRepository: { transition } as never,
      }),
    );

    await expect(
      service.credentials.transition({
        actor: agent,
        teamId: 'team-id',
        credentialId: 'credential-id',
        action: 'approve',
        from: ['pending_approval'],
        to: 'active',
      }),
    ).rejects.toMatchObject({
      name: 'SigningServiceError',
      code: 'forbidden',
    } satisfies Partial<SigningServiceError>);
    expect(transition).not.toHaveBeenCalled();
  });

  it('begins typed previewSign enrollment with public material bound server-side', async () => {
    const createRegistration = vi.fn(async (input) => input);
    const service = createSigningService(
      createDeps({
        createId: () => REGISTRATION_ID,
        now: () => new Date('2026-08-01T12:00:00.000Z'),
        signingCredentialRepository: { createRegistration } as never,
      }),
    );

    const registration = await service.credentials.beginRegistration({
      actor: human,
      teamId: TEAM_ID,
      verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
      credentialType: PREVIEW_SIGN_CREDENTIAL_TYPE,
      algorithm: PREVIEW_SIGN_ALGORITHM,
      publicMaterial: publicMaterial(),
      label: 'Production key',
    });

    expect(registration.challenge).toMatchObject({
      verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
      value: {
        version: 1,
        outerCredentialId: publicMaterial().outerCredentialId,
        previewKeyHandle: publicMaterial().previewKeyHandle,
      },
    });
    expect(registration.challenge.value).not.toHaveProperty('ikm');
    expect(createRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerHumanId: human.humanId,
        teamId: TEAM_ID,
        credentialType: PREVIEW_SIGN_CREDENTIAL_TYPE,
        algorithm: PREVIEW_SIGN_ALGORITHM,
        methodState: {
          verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
          value: expect.not.objectContaining({ ikm: expect.anything() }),
        },
      }),
    );
  });

  it('rejects malformed previewSign material before creating a registration', async () => {
    const createRegistration = vi.fn();
    const service = createSigningService(
      createDeps({
        signingCredentialRepository: { createRegistration } as never,
      }),
    );

    await expect(
      service.credentials.beginRegistration({
        actor: human,
        teamId: TEAM_ID,
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        credentialType: PREVIEW_SIGN_CREDENTIAL_TYPE,
        algorithm: PREVIEW_SIGN_ALGORITHM,
        publicMaterial: {
          ...publicMaterial(),
          seedPublicKey: {
            ...publicMaterial().seedPublicKey,
            derivedAlgorithm: -7,
          },
        },
        label: 'Malformed key',
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(createRegistration).not.toHaveBeenCalled();
  });

  it('verifies enrollment proof before atomically persisting normalized evidence', async () => {
    const now = new Date('2026-08-01T12:00:00.000Z');
    const createRegistration = vi.fn(async (input) => input);
    const create = vi.fn(async (input) => ({
      id: 'credential-id',
      ...input,
    }));
    const consumeRegistration = vi.fn(async (id) => ({ id }));
    const transactionRunner = {
      runInTransaction: vi.fn(async (task) => task()),
    };
    const deps = createDeps({
      createId: () => REGISTRATION_ID,
      now: () => now,
      signingCredentialRepository: {
        createRegistration,
        create,
        consumeRegistration,
      } as never,
      transactionRunner: transactionRunner as never,
    });
    const service = createSigningService(deps);
    await service.credentials.beginRegistration({
      actor: human,
      teamId: TEAM_ID,
      verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
      credentialType: PREVIEW_SIGN_CREDENTIAL_TYPE,
      algorithm: PREVIEW_SIGN_ALGORITHM,
      publicMaterial: publicMaterial(),
      label: 'Production key',
    });
    const registration = createRegistration.mock.calls[0]?.[0];
    deps.signingCredentialRepository.lockRegistrationForCompletion = vi
      .fn()
      .mockResolvedValue({
        ...registration,
        createdAt: now,
        consumedAt: null,
      });

    await service.credentials.completeRegistration({
      actor: human,
      teamId: TEAM_ID,
      registrationId: REGISTRATION_ID,
      publicMaterial: publicMaterial(),
      receipt: {
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        value: {
          version: PREVIEW_SIGN_RECEIPT_VERSION,
          signature: SIGNATURE,
        },
      },
    });

    expect(transactionRunner.runInTransaction).toHaveBeenCalledTimes(1);
    expect(consumeRegistration).toHaveBeenCalledWith(
      REGISTRATION_ID,
      human.humanId,
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        publicMaterial: publicMaterial(),
        enrollmentEvidence: expect.objectContaining({
          version: 1,
          requestId: REGISTRATION_ID,
          credentialId: REGISTRATION_ID,
          signature: SIGNATURE,
        }),
        status: 'pending_approval',
      }),
    );
  });

  it('accepts equivalent enrollment material reconstructed by another serializer', async () => {
    const now = new Date('2026-08-01T12:00:00.000Z');
    const createRegistration = vi.fn(async (input) => input);
    const create = vi.fn(async (input) => ({
      id: CREDENTIAL_ID,
      ...input,
    }));
    const deps = createDeps({
      createId: () => REGISTRATION_ID,
      now: () => now,
      signingCredentialRepository: {
        createRegistration,
        create,
        consumeRegistration: vi.fn(async (id) => ({ id })),
      } as never,
      transactionRunner: {
        runInTransaction: vi.fn(async (task) => task()),
      } as never,
    });
    const service = createSigningService(deps);
    await service.credentials.beginRegistration({
      actor: human,
      teamId: TEAM_ID,
      verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
      credentialType: PREVIEW_SIGN_CREDENTIAL_TYPE,
      algorithm: PREVIEW_SIGN_ALGORITHM,
      publicMaterial: publicMaterial(),
      label: 'Production key',
    });
    const registration = createRegistration.mock.calls[0]?.[0];
    deps.signingCredentialRepository.lockRegistrationForCompletion = vi
      .fn()
      .mockResolvedValue({
        ...registration,
        createdAt: now,
        consumedAt: null,
      });

    await service.credentials.completeRegistration({
      actor: human,
      teamId: TEAM_ID,
      registrationId: REGISTRATION_ID,
      publicMaterial: reorderedPublicMaterial(),
      receipt: {
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        value: {
          version: PREVIEW_SIGN_RECEIPT_VERSION,
          signature: SIGNATURE,
        },
      },
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        publicMaterial: publicMaterial(),
      }),
    );
  });

  it('rejects enrollment material substitution before receipt verification', async () => {
    const verifyPrehashedSignature = vi.fn().mockReturnValue(true);
    _resetSigningWorkflowsForTesting();
    const driver = createPreviewSignSigningMethodDriver({
      randomBytes: () => IKM,
      verifyPrehashedSignature,
    });
    registerSigningMethodDriver(driver.verificationMethod, driver);
    const now = new Date('2026-08-01T12:00:00.000Z');
    const createRegistration = vi.fn(async (input) => input);
    const create = vi.fn();
    const consumeRegistration = vi.fn();
    const deps = createDeps({
      createId: () => REGISTRATION_ID,
      now: () => now,
      signingCredentialRepository: {
        createRegistration,
        create,
        consumeRegistration,
      } as never,
      transactionRunner: {
        runInTransaction: vi.fn(async (task) => task()),
      } as never,
    });
    const service = createSigningService(deps);
    await service.credentials.beginRegistration({
      actor: human,
      teamId: TEAM_ID,
      verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
      credentialType: PREVIEW_SIGN_CREDENTIAL_TYPE,
      algorithm: PREVIEW_SIGN_ALGORITHM,
      publicMaterial: publicMaterial(),
      label: 'Production key',
    });
    const registration = createRegistration.mock.calls[0]?.[0];
    deps.signingCredentialRepository.lockRegistrationForCompletion = vi
      .fn()
      .mockResolvedValue({
        ...registration,
        createdAt: now,
        consumedAt: null,
      });

    await expect(
      service.credentials.completeRegistration({
        actor: human,
        teamId: TEAM_ID,
        registrationId: REGISTRATION_ID,
        publicMaterial: {
          ...publicMaterial(),
          outerCredentialId: Buffer.from('substituted-credential').toString(
            'base64url',
          ),
        },
        receipt: {
          verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
          value: {
            version: PREVIEW_SIGN_RECEIPT_VERSION,
            signature: SIGNATURE,
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(verifyPrehashedSignature).not.toHaveBeenCalled();
    expect(consumeRegistration).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects enrollment material substitution, expiry, and replay', async () => {
    const lockRegistrationForCompletion = vi.fn().mockResolvedValue(null);
    const consumeRegistration = vi.fn();
    const create = vi.fn();
    const service = createSigningService(
      createDeps({
        signingCredentialRepository: {
          lockRegistrationForCompletion,
          consumeRegistration,
          create,
        } as never,
        transactionRunner: {
          runInTransaction: vi.fn(async (task) => task()),
        } as never,
      }),
    );

    await expect(
      service.credentials.completeRegistration({
        actor: human,
        teamId: TEAM_ID,
        registrationId: REGISTRATION_ID,
        publicMaterial: publicMaterial(),
        receipt: {
          verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
          value: {
            version: PREVIEW_SIGN_RECEIPT_VERSION,
            signature: SIGNATURE,
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(consumeRegistration).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('derives and persists one previewSign verifier state at atomic claim', async () => {
    const pending = pendingRequest();
    const claim = vi.fn(async (input) => ({
      ...pending,
      status: 'claimed' as const,
      claimedByHumanId: human.humanId,
      signingCredentialId: CREDENTIAL_ID,
      challenge: input.challenge,
      methodState: input.methodState,
      claimedAt: new Date('2026-08-01T12:01:00.000Z'),
    }));
    const service = createSigningService(
      createDeps({
        now: () => new Date('2026-08-01T12:01:00.000Z'),
        signingRequestRepository: {
          findById: vi.fn().mockResolvedValue(pending),
          claim,
        } as never,
        signingCredentialRepository: {
          findActiveCompatible: vi.fn().mockResolvedValue(activeCredential()),
        } as never,
        relationshipReader: {
          listTeamIdsAndRolesBySubject: vi
            .fn()
            .mockResolvedValue([{ teamId: TEAM_ID, relation: 'members' }]),
          listGroupIdsBySubject: vi.fn().mockResolvedValue([]),
        } as never,
        groupRepository: {
          findByIds: vi.fn().mockResolvedValue(new Map()),
        } as never,
      }),
    );

    const claimed = await service.requests.claim({
      actor: human,
      teamId: TEAM_ID,
      requestId: REQUEST_ID,
      credentialId: CREDENTIAL_ID,
    });

    expect(claimed.challenge).toMatchObject({
      verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
      value: {
        version: 1,
        outerCredentialId: publicMaterial().outerCredentialId,
        previewKeyHandle: publicMaterial().previewKeyHandle,
      },
    });
    expect(claimed.challenge?.value).not.toHaveProperty('ikm');
    expect(claimed.methodState?.value).not.toHaveProperty('ikm');
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it('returns an existing claim without deriving a second ARKG key', async () => {
    const prepareRandom = vi.fn(() => IKM);
    _resetSigningWorkflowsForTesting();
    const driver = createPreviewSignSigningMethodDriver({
      randomBytes: prepareRandom,
      verifyPrehashedSignature: vi.fn().mockReturnValue(true),
    });
    registerSigningMethodDriver(driver.verificationMethod, driver);
    const alreadyClaimed = {
      ...pendingRequest(),
      status: 'claimed' as const,
      claimedByHumanId: human.humanId,
      signingCredentialId: CREDENTIAL_ID,
      challenge: {
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        value: { version: 1, digest: 'existing' },
      },
      methodState: {
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        value: { version: 1, derivedPublicKey: 'existing' },
      },
      claimedAt: new Date('2026-08-01T12:01:00.000Z'),
    };
    const findActiveCompatible = vi.fn();
    const claim = vi.fn();
    const service = createSigningService(
      createDeps({
        now: () => new Date('2026-08-01T12:02:00.000Z'),
        signingRequestRepository: {
          findById: vi.fn().mockResolvedValue(alreadyClaimed),
          claim,
        } as never,
        signingCredentialRepository: { findActiveCompatible } as never,
      }),
    );

    await expect(
      service.requests.claim({
        actor: human,
        teamId: TEAM_ID,
        requestId: REQUEST_ID,
        credentialId: CREDENTIAL_ID,
      }),
    ).resolves.toBe(alreadyClaimed);
    expect(prepareRandom).not.toHaveBeenCalled();
    expect(findActiveCompatible).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });

  it('stores normalized immutable evidence through atomic completion', async () => {
    const pending = pendingRequest();
    const claimInput: { challenge?: unknown; methodState?: unknown } = {};
    const claim = vi.fn(async (input) => {
      Object.assign(claimInput, input);
      return {
        ...pending,
        status: 'claimed' as const,
        claimedByHumanId: human.humanId,
        signingCredentialId: CREDENTIAL_ID,
        challenge: input.challenge,
        methodState: input.methodState,
        claimedAt: new Date('2026-08-01T12:01:00.000Z'),
      };
    });
    const completeClaim = vi.fn(async (input) => ({
      ...pending,
      status: 'completed' as const,
      claimedByHumanId: human.humanId,
      signingCredentialId: CREDENTIAL_ID,
      challenge: claimInput.challenge,
      methodState: claimInput.methodState,
      receipt: input.receipt,
      valid: true,
      completedAt: new Date('2026-08-01T12:02:00.000Z'),
    }));
    const signingRequestRepository = {
      findById: vi.fn().mockResolvedValue(pending),
      claim,
      lockClaimForCompletion: vi.fn(),
      completeClaim,
    };
    const service = createSigningService(
      createDeps({
        now: () => new Date('2026-08-01T12:01:00.000Z'),
        signingRequestRepository: signingRequestRepository as never,
        signingCredentialRepository: {
          findActiveCompatible: vi.fn().mockResolvedValue(activeCredential()),
        } as never,
        relationshipReader: {
          listTeamIdsAndRolesBySubject: vi
            .fn()
            .mockResolvedValue([{ teamId: TEAM_ID, relation: 'members' }]),
          listGroupIdsBySubject: vi.fn().mockResolvedValue([]),
        } as never,
        groupRepository: {
          findByIds: vi.fn().mockResolvedValue(new Map()),
        } as never,
        transactionRunner: {
          runInTransaction: vi.fn(async (task) => task()),
        } as never,
      }),
    );
    const claimed = await service.requests.claim({
      actor: human,
      teamId: TEAM_ID,
      requestId: REQUEST_ID,
      credentialId: CREDENTIAL_ID,
    });
    signingRequestRepository.findById.mockResolvedValue(claimed);
    signingRequestRepository.lockClaimForCompletion.mockResolvedValue(claimed);

    await service.requests.complete({
      actor: human,
      teamId: TEAM_ID,
      requestId: REQUEST_ID,
      receipt: {
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        value: {
          version: PREVIEW_SIGN_RECEIPT_VERSION,
          signature: SIGNATURE,
        },
      },
    });

    expect(completeClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        receipt: {
          verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
          value: expect.objectContaining({
            version: 1,
            requestId: REQUEST_ID,
            credentialId: CREDENTIAL_ID,
            teamId: TEAM_ID,
            claimantId: human.humanId,
            nonce: pending.nonce,
            purpose: pending.purpose,
            signature: SIGNATURE,
          }),
        },
        valid: true,
      }),
    );
  });

  it('verifies a receipt before locking and persists evidence inside the transaction', async () => {
    const claimed = {
      ...pendingRequest(),
      status: 'claimed' as const,
      claimedByHumanId: human.humanId,
      signingCredentialId: CREDENTIAL_ID,
      methodState: {
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        value: { persisted: 'driver-state' },
      },
    };
    const verifyReceipt = vi.fn().mockResolvedValue({
      verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
      credentialId: CREDENTIAL_ID,
      proofHash: 'proof-hash',
      details: { version: 1, signature: SIGNATURE },
    });
    _resetSigningWorkflowsForTesting();
    registerSigningMethodDriver(VERIFICATION_METHOD.HumanHardwarePreviewSign, {
      verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
      validatePublicMaterial: vi.fn(),
      prepareClaim: vi.fn(),
      verify: vi.fn().mockResolvedValue(false),
      verifyReceipt,
    });
    let inTransaction = false;
    const completeClaim = vi.fn(async (input) => {
      expect(inTransaction).toBe(true);
      return {
        ...claimed,
        status: 'completed' as const,
        receipt: input.receipt,
        valid: true,
      };
    });
    const transactionRunner = {
      runInTransaction: vi.fn(async (task) => {
        expect(verifyReceipt).toHaveBeenCalledTimes(1);
        inTransaction = true;
        try {
          return await task();
        } finally {
          inTransaction = false;
        }
      }),
    };
    const service = createSigningService(
      createDeps({
        signingRequestRepository: {
          findById: vi.fn().mockResolvedValue(claimed),
          lockClaimForCompletion: vi.fn().mockResolvedValue(claimed),
          completeClaim,
        } as never,
        signingCredentialRepository: {
          findActiveCompatible: vi.fn().mockResolvedValue(activeCredential()),
        } as never,
        transactionRunner: transactionRunner as never,
      }),
    );

    await service.requests.complete({
      actor: human,
      teamId: TEAM_ID,
      requestId: REQUEST_ID,
      receipt: {
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        value: {
          version: PREVIEW_SIGN_RECEIPT_VERSION,
          signature: SIGNATURE,
        },
      },
    });

    expect(transactionRunner.runInTransaction).toHaveBeenCalledTimes(1);
    expect(completeClaim).toHaveBeenCalledTimes(1);
  });

  it('rejects completion when the locked verifier state changed after verification', async () => {
    const claimed = {
      ...pendingRequest(),
      status: 'claimed' as const,
      claimedByHumanId: human.humanId,
      signingCredentialId: CREDENTIAL_ID,
      methodState: {
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        value: { persisted: 'verified-state' },
      },
    };
    const verifyReceipt = vi.fn().mockResolvedValue({
      verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
      credentialId: CREDENTIAL_ID,
      proofHash: 'proof-hash',
      details: { version: 1, signature: SIGNATURE },
    });
    _resetSigningWorkflowsForTesting();
    registerSigningMethodDriver(VERIFICATION_METHOD.HumanHardwarePreviewSign, {
      verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
      validatePublicMaterial: vi.fn(),
      prepareClaim: vi.fn(),
      verify: vi.fn().mockResolvedValue(false),
      verifyReceipt,
    });
    const completeClaim = vi.fn();
    const service = createSigningService(
      createDeps({
        signingRequestRepository: {
          findById: vi.fn().mockResolvedValue(claimed),
          lockClaimForCompletion: vi.fn().mockResolvedValue({
            ...claimed,
            methodState: {
              ...claimed.methodState,
              value: { persisted: 'changed-state' },
            },
          }),
          completeClaim,
        } as never,
        signingCredentialRepository: {
          findActiveCompatible: vi.fn().mockResolvedValue(activeCredential()),
        } as never,
        transactionRunner: {
          runInTransaction: vi.fn(async (task) => task()),
        } as never,
      }),
    );

    await expect(
      service.requests.complete({
        actor: human,
        teamId: TEAM_ID,
        requestId: REQUEST_ID,
        receipt: {
          verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
          value: {
            version: PREVIEW_SIGN_RECEIPT_VERSION,
            signature: SIGNATURE,
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(verifyReceipt).toHaveBeenCalledTimes(1);
    expect(completeClaim).not.toHaveBeenCalled();
  });

  it('maps an expired method receipt to signing_request_expired', async () => {
    const claimed = {
      ...pendingRequest(),
      status: 'claimed' as const,
      claimedByHumanId: human.humanId,
      signingCredentialId: CREDENTIAL_ID,
      methodState: {
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        value: { persisted: 'driver-state' },
      },
    };
    _resetSigningWorkflowsForTesting();
    registerSigningMethodDriver(VERIFICATION_METHOD.HumanHardwarePreviewSign, {
      verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
      validatePublicMaterial: vi.fn(),
      prepareClaim: vi.fn(),
      verify: vi.fn().mockResolvedValue(false),
      verifyReceipt: vi.fn().mockRejectedValue(
        new SigningReceiptInvalidError('previewSign challenge has expired', {
          reason: 'expired',
        }),
      ),
    });
    const service = createSigningService(
      createDeps({
        signingRequestRepository: {
          findById: vi.fn().mockResolvedValue(claimed),
        } as never,
        signingCredentialRepository: {
          findActiveCompatible: vi.fn().mockResolvedValue(activeCredential()),
        } as never,
      }),
    );

    await expect(
      service.requests.complete({
        actor: human,
        teamId: TEAM_ID,
        requestId: REQUEST_ID,
        receipt: {
          verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
          value: {
            version: PREVIEW_SIGN_RECEIPT_VERSION,
            signature: SIGNATURE,
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'signing_request_expired' });
  });

  it('rejects an expired claimed row before credential or receipt verification', async () => {
    const claimed = {
      ...pendingRequest(),
      status: 'claimed' as const,
      claimedByHumanId: human.humanId,
      signingCredentialId: CREDENTIAL_ID,
      methodState: {
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        value: { persisted: 'driver-state' },
      },
    };
    const findActiveCompatible = vi.fn().mockResolvedValue(activeCredential());
    const verifyReceipt = vi.fn().mockResolvedValue({
      valid: true,
      details: { version: 1 },
    });
    _resetSigningWorkflowsForTesting();
    registerSigningMethodDriver(VERIFICATION_METHOD.HumanHardwarePreviewSign, {
      verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
      validatePublicMaterial: vi.fn(),
      prepareClaim: vi.fn(),
      verify: vi.fn().mockResolvedValue(false),
      verifyReceipt,
    });
    const service = createSigningService(
      createDeps({
        now: () => new Date('2026-08-01T12:06:00.000Z'),
        signingRequestRepository: {
          findById: vi.fn().mockResolvedValue(claimed),
        } as never,
        signingCredentialRepository: { findActiveCompatible } as never,
      }),
    );

    await expect(
      service.requests.complete({
        actor: human,
        teamId: TEAM_ID,
        requestId: REQUEST_ID,
        receipt: {
          verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
          value: {
            version: PREVIEW_SIGN_RECEIPT_VERSION,
            signature: SIGNATURE,
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'signing_request_expired' });
    expect(findActiveCompatible).not.toHaveBeenCalled();
    expect(verifyReceipt).not.toHaveBeenCalled();
  });

  it('refuses completion after credential revocation', async () => {
    const claimed = {
      ...pendingRequest(),
      status: 'claimed' as const,
      claimedByHumanId: human.humanId,
      signingCredentialId: CREDENTIAL_ID,
      methodState: {
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        value: { version: 1 },
      },
    };
    const lockClaimForCompletion = vi.fn();
    const service = createSigningService(
      createDeps({
        signingRequestRepository: {
          findById: vi.fn().mockResolvedValue(claimed),
          lockClaimForCompletion,
        } as never,
        signingCredentialRepository: {
          findActiveCompatible: vi.fn().mockResolvedValue(null),
        } as never,
      }),
    );

    await expect(
      service.requests.complete({
        actor: human,
        teamId: TEAM_ID,
        requestId: REQUEST_ID,
        receipt: {
          verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
          value: {
            version: PREVIEW_SIGN_RECEIPT_VERSION,
            signature: SIGNATURE,
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(lockClaimForCompletion).not.toHaveBeenCalled();
  });
});
