import type { AuthContext } from '@moltnet/auth';
import {
  registerSigningMethodDriver,
  VERIFICATION_METHOD,
} from '@moltnet/signing-workflows';
import type { FastifyInstance } from 'fastify';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMockServices,
  createTestApp,
  type MockServices,
  OWNER_ID,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const HUMAN_ID = '660e8400-e29b-41d4-a716-446655440001';
const TEAM_ID = '770e8400-e29b-41d4-a716-446655440002';
const CREDENTIAL_ID = '880e8400-e29b-41d4-a716-446655440003';
const GROUP_ID = 'aa0e8400-e29b-41d4-a716-446655440005';
const DIGEST = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const SIGNATURE =
  'MEUCIQCEfiAIvamLdwfaDHCI2epg4Si6E3bAHlRDC6bl2fyNXAIgaRLbpQLIurx8zaf63gYqpcGF8CsP8kTMFNu9q2B2ORY';

const publicMaterial = {
  version: 1 as const,
  outerCredentialId: 'b3V0ZXItY3JlZGVudGlhbA',
  outerPublicKey: {
    kty: 2 as const,
    algorithm: -7 as const,
    curve: 1 as const,
    x: 'bTvfMdDbSJiPFtRwSP3SQSPNKG5C0FEtqp9ya07PGN8',
    y: 'Ze1CFpxpZ1-Tb_feX5vZOtvI6nMDaxbo2Qrb-r2t26c',
  },
  previewKeyHandle: 'cHJldmlldy1rZXktaGFuZGxl',
  seedPublicKey: {
    kty: -65537 as const,
    algorithm: -65700 as const,
    derivedAlgorithm: -9 as const,
    blindingKey: {
      kty: 2 as const,
      algorithm: -7 as const,
      curve: 1 as const,
      x: 'bTvfMdDbSJiPFtRwSP3SQSPNKG5C0FEtqp9ya07PGN8',
      y: 'Ze1CFpxpZ1-Tb_feX5vZOtvI6nMDaxbo2Qrb-r2t26c',
    },
    kemKey: {
      kty: 2 as const,
      algorithm: -25 as const,
      curve: 1 as const,
      x: 'w4u91yhhlnM_oXfkO3PP09bXLNEcwLsskjbPhaQtz_U',
      y: '36M5weB9_N_ajXvipaPHOCmR84ff4zKx3Y2m4GIs-zU',
    },
  },
};

const previewSignChallenge = {
  verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
  version: 1,
  envelope: 'ZW52ZWxvcGU',
  digest: DIGEST,
  additionalArguments: 'YXJndW1lbnRz',
  outerCredentialId: publicMaterial.outerCredentialId,
  outerPublicKey: publicMaterial.outerPublicKey,
  previewKeyHandle: publicMaterial.previewKeyHandle,
};

const previewSignEvidence = {
  version: 1,
  operation: 'signing-request' as const,
  requestId: CREDENTIAL_ID,
  credentialId: CREDENTIAL_ID,
  teamId: TEAM_ID,
  claimantId: HUMAN_ID,
  verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
  nonce: '990e8400-e29b-41d4-a716-446655440004',
  purpose: 'Approve production deployment',
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
  envelope: 'ZW52ZWxvcGU',
  digest: DIGEST,
  additionalArgumentsHash: DIGEST,
  derivedPublicKey: {
    ...publicMaterial.outerPublicKey,
    algorithm: -9,
  },
  signature: SIGNATURE,
  proofHash: DIGEST,
};

const previewSignReceipt = {
  verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
  value: { version: 1, signature: SIGNATURE },
};

const humanAuth: AuthContext = {
  subjectType: 'human',
  identityId: OWNER_ID,
  humanId: HUMAN_ID,
  clientId: null,
  scopes: [],
  currentTeamId: TEAM_ID,
};

const credential = {
  id: CREDENTIAL_ID,
  ownerAgentId: null,
  ownerHumanId: HUMAN_ID,
  teamId: TEAM_ID,
  verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
  credentialType: 'preview-sign-arkg',
  algorithm: 'arkg-p256-esp256',
  publicMaterial,
  enrollmentEvidence: {
    ...previewSignEvidence,
    operation: 'credential-registration' as const,
    purpose: 'signing-credential-registration',
  },
  label: 'Test credential',
  status: 'pending_approval' as const,
  approvedByHumanId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  activatedAt: null,
  suspendedAt: null,
  revokedAt: null,
};

function createPendingRequest(
  signerConstraint: {
    id: string;
    type: 'group' | 'human' | 'team-role';
  } = { id: HUMAN_ID, type: 'human' },
) {
  return {
    id: CREDENTIAL_ID,
    agentId: OWNER_ID,
    verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
    requestedBy: { id: OWNER_ID, type: 'agent' as const },
    signerConstraint,
    teamId: TEAM_ID,
    purpose: 'Approve production deployment',
    claimedByHumanId: null,
    signingCredentialId: null,
    challenge: null,
    methodState: null,
    receipt: null,
    message: 'deployment-cid',
    nonce: '990e8400-e29b-41d4-a716-446655440004',
    status: 'pending' as const,
    signature: null,
    valid: null,
    workflowId: null,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 300_000),
    completedAt: null,
    claimedAt: null,
    rejectedAt: null,
    rejectionReason: null,
  };
}

beforeAll(() => {
  registerSigningMethodDriver(VERIFICATION_METHOD.HumanHardwarePreviewSign, {
    verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
    verify: vi.fn().mockResolvedValue(true),
    validatePublicMaterial: vi.fn(),
    prepareClaim: vi.fn().mockResolvedValue({
      challenge: previewSignChallenge,
      verifierState: { expected: 'test-receipt' },
    }),
    verifyReceipt: vi.fn().mockResolvedValue({
      verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
      credentialId: CREDENTIAL_ID,
      proofHash: DIGEST,
      details: previewSignEvidence,
    }),
    isReceiptReplay: vi.fn(
      (receipt, evidence) =>
        receipt['signature'] === SIGNATURE &&
        evidence['signature'] === SIGNATURE,
    ),
  });
});

describe('signing credential routes', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
    mocks.permissionChecker.canManageTeamCredentials.mockResolvedValue(true);
    mocks.relationshipReader.listTeamIdsAndRolesBySubject.mockResolvedValue([
      { teamId: TEAM_ID, relation: 'members' },
    ]);
    mocks.relationshipReader.listGroupIdsBySubject.mockResolvedValue([]);
    mocks.signingCredentialRepository.lockRegistrationForCompletion.mockResolvedValue(
      {
        id: CREDENTIAL_ID,
        ownerHumanId: HUMAN_ID,
        teamId: TEAM_ID,
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        credentialType: 'preview-sign-arkg',
        algorithm: 'arkg-p256-esp256',
        label: 'Test credential',
        challenge: {
          verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
          value: {},
        },
        methodState: {
          verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
          value: {},
        },
        expiresAt: new Date(Date.now() + 300_000),
        consumedAt: null,
        createdAt: new Date(),
      },
    );
    const owner = {
      id: HUMAN_ID,
      identityId: OWNER_ID,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mocks.humanRepository.findById.mockResolvedValue(owner);
    mocks.humanRepository.findByIds.mockResolvedValue(
      new Map([[HUMAN_ID, owner]]),
    );
    app = await createTestApp(mocks, humanAuth);
  });

  it('begins authenticated self-enrollment with a typed challenge', async () => {
    mocks.signingCredentialRepository.createRegistration.mockResolvedValue({});

    const response = await app.inject({
      method: 'POST',
      url: '/crypto/signing-credentials/registrations',
      headers: {
        authorization: 'Bearer human-session',
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: {
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        credentialType: 'preview-sign-arkg',
        algorithm: 'arkg-p256-esp256',
        publicMaterial,
        label: 'Test credential',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().challenge).toMatchObject({
      verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
    });
    expect(
      mocks.signingCredentialRepository.createRegistration,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerHumanId: HUMAN_ID,
        teamId: TEAM_ID,
      }),
    );
  });

  it('rejects private material before Ajv can strip the unknown field', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/crypto/signing-credentials/registrations/${CREDENTIAL_ID}/complete`,
      headers: {
        authorization: 'Bearer human-session',
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: {
        publicMaterial: {
          ...publicMaterial,
          privateKey: 'must-not-persist',
        },
        receipt: previewSignReceipt,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(
      mocks.signingCredentialRepository.consumeRegistration,
    ).not.toHaveBeenCalled();
    expect(mocks.signingCredentialRepository.create).not.toHaveBeenCalled();
  });

  it('lets a team credential manager approve a pending credential', async () => {
    mocks.signingCredentialRepository.transition.mockResolvedValue({
      credential: {
        ...credential,
        status: 'active',
        approvedByHumanId: HUMAN_ID,
        activatedAt: new Date(),
      },
      fromStatus: 'pending_approval',
    });

    const response = await app.inject({
      method: 'POST',
      url: `/crypto/signing-credentials/${CREDENTIAL_ID}/approve`,
      headers: {
        authorization: 'Bearer human-session',
        'x-moltnet-team-id': TEAM_ID,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'active',
      owner: {
        kind: 'human',
        humanId: HUMAN_ID,
        identityId: OWNER_ID,
      },
    });
    expect(response.json()).not.toHaveProperty('ownerType');
    expect(response.json()).not.toHaveProperty('ownerHumanId');
  });

  it('returns a lifecycle conflict for a bodyless transition', async () => {
    mocks.signingCredentialRepository.transition.mockResolvedValue(null);

    const response = await app.inject({
      method: 'POST',
      url: `/crypto/signing-credentials/${CREDENTIAL_ID}/approve`,
      headers: {
        authorization: 'Bearer human-session',
        'x-moltnet-team-id': TEAM_ID,
      },
    });

    expect(response.statusCode).toBe(409);
  });

  it('forbids an agent credential manager from approving a credential', async () => {
    const agentApp = await createTestApp(mocks, {
      ...VALID_AUTH_CONTEXT,
      currentTeamId: TEAM_ID,
    });

    const response = await agentApp.inject({
      method: 'POST',
      url: `/crypto/signing-credentials/${CREDENTIAL_ID}/approve`,
      headers: {
        authorization: 'Bearer agent-token',
        'x-moltnet-team-id': TEAM_ID,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(mocks.signingCredentialRepository.transition).not.toHaveBeenCalled();
    await agentApp.close();
  });

  it.each(['approve', 'suspend', 'revoke'])(
    'forbids a non-credential-manager from %s',
    async (action) => {
      mocks.permissionChecker.canManageTeamCredentials.mockResolvedValue(false);

      const response = await app.inject({
        method: 'POST',
        url: `/crypto/signing-credentials/${CREDENTIAL_ID}/${action}`,
        headers: {
          authorization: 'Bearer human-session',
          'x-moltnet-team-id': TEAM_ID,
        },
        payload: {},
      });

      expect(response.statusCode).toBe(403);
      expect(
        mocks.signingCredentialRepository.transition,
      ).not.toHaveBeenCalled();
    },
  );

  it('lists credentials with one discriminated owner property', async () => {
    mocks.signingCredentialRepository.list.mockResolvedValue({
      items: [credential],
      total: 1,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/crypto/signing-credentials',
      headers: {
        authorization: 'Bearer human-session',
        'x-moltnet-team-id': TEAM_ID,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items[0]).toMatchObject({
      owner: {
        kind: 'human',
        humanId: HUMAN_ID,
        identityId: OWNER_ID,
      },
    });
    expect(response.json().items[0]).not.toHaveProperty('ownerType');
    expect(response.json().items[0]).not.toHaveProperty('ownerHumanId');
    expect(mocks.humanRepository.findByIds).toHaveBeenCalledWith([HUMAN_ID]);
  });

  it('gets a credential by id with its discriminated owner', async () => {
    mocks.signingCredentialRepository.findById.mockResolvedValue(credential);

    const response = await app.inject({
      method: 'GET',
      url: `/crypto/signing-credentials/${CREDENTIAL_ID}`,
      headers: {
        authorization: 'Bearer human-session',
        'x-moltnet-team-id': TEAM_ID,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: CREDENTIAL_ID,
      owner: {
        kind: 'human',
        humanId: HUMAN_ID,
        identityId: OWNER_ID,
      },
    });
  });

  it('does not reveal a credential from another team', async () => {
    mocks.signingCredentialRepository.findById.mockResolvedValue({
      ...credential,
      teamId: '990e8400-e29b-41d4-a716-446655440009',
    });

    const response = await app.inject({
      method: 'GET',
      url: `/crypto/signing-credentials/${CREDENTIAL_ID}`,
      headers: {
        authorization: 'Bearer human-session',
        'x-moltnet-team-id': TEAM_ID,
      },
    });

    expect(response.statusCode).toBe(404);
  });

  it('lists signable requests with SQL-backed pagination and total', async () => {
    const pending = createPendingRequest({
      id: GROUP_ID,
      type: 'group',
    });
    mocks.relationshipReader.listGroupIdsBySubject.mockResolvedValue([
      GROUP_ID,
    ]);
    mocks.groupRepository.findByIds.mockResolvedValue(
      new Map([[GROUP_ID, { id: GROUP_ID, teamId: TEAM_ID }]]),
    );
    mocks.signingRequestRepository.listSignable.mockResolvedValue({
      items: [pending],
      total: 47,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/crypto/signing-requests?scope=signable&limit=1&offset=20',
      headers: {
        authorization: 'Bearer human-session',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      total: 47,
      limit: 1,
      offset: 20,
    });
    expect(mocks.signingRequestRepository.listSignable).toHaveBeenCalledWith(
      expect.objectContaining({
        teamRoles: [{ teamId: TEAM_ID, role: 'member' }],
        humanIds: [HUMAN_ID, OWNER_ID],
        groups: [{ groupId: GROUP_ID, teamId: TEAM_ID }],
        limit: 1,
        offset: 20,
      }),
    );
    expect(
      mocks.relationshipReader.listTeamIdsAndRolesBySubject,
    ).toHaveBeenCalledTimes(1);
    expect(
      mocks.relationshipReader.listGroupIdsBySubject,
    ).toHaveBeenCalledTimes(1);
  });

  it('runs request → claim → receipt verification → completion', async () => {
    const pending = createPendingRequest();
    const claimed = {
      ...pending,
      status: 'claimed' as const,
      claimedByHumanId: HUMAN_ID,
      signingCredentialId: CREDENTIAL_ID,
      challenge: {
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        value: previewSignChallenge,
      },
      methodState: {
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        value: { expected: 'test-receipt' },
      },
      claimedAt: new Date(),
    };
    const activeCredential = { ...credential, status: 'active' as const };
    mocks.signingRequestRepository.findById
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(claimed);
    mocks.signingCredentialRepository.findActiveCompatible.mockResolvedValue(
      activeCredential,
    );
    mocks.signingRequestRepository.claim.mockResolvedValue(claimed);
    mocks.signingRequestRepository.completeClaim.mockResolvedValue({
      ...claimed,
      status: 'completed',
      receipt: {
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        value: previewSignEvidence,
      },
      valid: true,
      completedAt: new Date(),
    });
    mocks.signingRequestRepository.lockClaimForCompletion.mockResolvedValue(
      claimed,
    );

    mocks.relationshipReader.listTeamIdsAndRolesBySubject.mockResolvedValueOnce(
      [],
    );
    const outsideTeamResponse = await app.inject({
      method: 'POST',
      url: `/crypto/signing-requests/${pending.id}/claim`,
      headers: {
        authorization: 'Bearer human-session',
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: { credentialId: CREDENTIAL_ID },
    });
    expect(outsideTeamResponse.statusCode).toBe(403);
    expect(mocks.signingRequestRepository.claim).not.toHaveBeenCalled();

    const claimResponse = await app.inject({
      method: 'POST',
      url: `/crypto/signing-requests/${pending.id}/claim`,
      headers: {
        authorization: 'Bearer human-session',
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: { credentialId: CREDENTIAL_ID },
    });
    expect(claimResponse.statusCode).toBe(200);
    expect(claimResponse.json().status).toBe('claimed');

    mocks.signingRequestRepository.findById.mockResolvedValue(claimed);
    const completeResponse = await app.inject({
      method: 'POST',
      url: `/crypto/signing-requests/${pending.id}/complete`,
      headers: {
        authorization: 'Bearer human-session',
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: {
        receipt: previewSignReceipt,
      },
    });
    expect(completeResponse.statusCode).toBe(200);
    expect(completeResponse.json()).toMatchObject({
      status: 'completed',
      valid: true,
    });
  });

  it('returns an identical completed request without verifying it again', async () => {
    const completed = {
      ...createPendingRequest(),
      status: 'completed' as const,
      claimedByHumanId: HUMAN_ID,
      signingCredentialId: CREDENTIAL_ID,
      receipt: {
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        value: previewSignEvidence,
      },
      valid: true,
      completedAt: new Date(),
    };
    mocks.signingRequestRepository.findById.mockResolvedValue(completed);

    const response = await app.inject({
      method: 'POST',
      url: `/crypto/signing-requests/${completed.id}/complete`,
      headers: {
        authorization: 'Bearer human-session',
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: { receipt: previewSignReceipt },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: completed.id,
      status: 'completed',
    });
    expect(
      mocks.signingRequestRepository.lockClaimForCompletion,
    ).not.toHaveBeenCalled();
    expect(
      mocks.signingCredentialRepository.findActiveCompatible,
    ).not.toHaveBeenCalled();
  });

  it('resolves a team-role constraint through the signer team relation', async () => {
    const pending = createPendingRequest({
      id: 'manager',
      type: 'team-role',
    });
    mocks.signingRequestRepository.findById.mockResolvedValue(pending);
    mocks.relationshipReader.listTeamIdsAndRolesBySubject.mockResolvedValue([
      { teamId: TEAM_ID, relation: 'managers' },
    ]);
    mocks.signingCredentialRepository.findActiveCompatible.mockResolvedValue({
      ...credential,
      status: 'active',
    });
    mocks.signingRequestRepository.claim.mockResolvedValue({
      ...pending,
      status: 'claimed',
      claimedByHumanId: HUMAN_ID,
      signingCredentialId: CREDENTIAL_ID,
      claimedAt: new Date(),
    });

    const response = await app.inject({
      method: 'POST',
      url: `/crypto/signing-requests/${pending.id}/claim`,
      headers: {
        authorization: 'Bearer human-session',
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: { credentialId: CREDENTIAL_ID },
    });

    expect(response.statusCode).toBe(200);
    expect(
      mocks.relationshipReader.listTeamIdsAndRolesBySubject,
    ).toHaveBeenCalledWith(OWNER_ID);
  });

  it('resolves a group constraint through team-scoped Keto membership', async () => {
    const pending = createPendingRequest({ id: GROUP_ID, type: 'group' });
    mocks.signingRequestRepository.findById.mockResolvedValue(pending);
    mocks.groupRepository.findByIds.mockResolvedValue(
      new Map([
        [
          GROUP_ID,
          {
            id: GROUP_ID,
            name: 'Release approvers',
            teamId: TEAM_ID,
            creatorAgentId: OWNER_ID,
            creatorHumanId: null,
            createdAt: new Date(),
          },
        ],
      ]),
    );
    mocks.relationshipReader.listGroupIdsBySubject.mockResolvedValue([
      GROUP_ID,
    ]);
    mocks.signingCredentialRepository.findActiveCompatible.mockResolvedValue({
      ...credential,
      status: 'active',
    });
    mocks.signingRequestRepository.claim.mockResolvedValue({
      ...pending,
      status: 'claimed',
      claimedByHumanId: HUMAN_ID,
      signingCredentialId: CREDENTIAL_ID,
      claimedAt: new Date(),
    });

    const response = await app.inject({
      method: 'POST',
      url: `/crypto/signing-requests/${pending.id}/claim`,
      headers: {
        authorization: 'Bearer human-session',
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: { credentialId: CREDENTIAL_ID },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.relationshipReader.listGroupIdsBySubject).toHaveBeenCalledWith(
      OWNER_ID,
    );
    expect(mocks.groupRepository.findByIds).toHaveBeenCalledWith([GROUP_ID]);
  });

  it('rejects a claim when no active compatible credential exists', async () => {
    const pending = createPendingRequest();
    mocks.signingRequestRepository.findById.mockResolvedValue(pending);
    mocks.signingCredentialRepository.findActiveCompatible.mockResolvedValue(
      null,
    );

    const response = await app.inject({
      method: 'POST',
      url: `/crypto/signing-requests/${pending.id}/claim`,
      headers: {
        authorization: 'Bearer human-session',
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: { credentialId: CREDENTIAL_ID },
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.signingRequestRepository.claim).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'human',
      constraint: {
        type: 'human' as const,
        id: 'bb0e8400-e29b-41d4-a716-446655440006',
      },
    },
    {
      name: 'team role',
      constraint: { type: 'team-role' as const, id: 'manager' as const },
    },
    {
      name: 'group',
      constraint: { type: 'group' as const, id: GROUP_ID },
    },
  ])(
    'forbids a claim that mismatches the $name constraint',
    async (testCase) => {
      const pending = createPendingRequest(testCase.constraint);
      mocks.signingRequestRepository.findById.mockResolvedValue(pending);

      const response = await app.inject({
        method: 'POST',
        url: `/crypto/signing-requests/${pending.id}/claim`,
        headers: {
          authorization: 'Bearer human-session',
          'x-moltnet-team-id': TEAM_ID,
        },
        payload: { credentialId: CREDENTIAL_ID },
      });

      expect(response.statusCode).toBe(403);
      expect(mocks.signingRequestRepository.claim).not.toHaveBeenCalled();
    },
  );

  it.each(['complete', 'reject'])(
    'forbids a non-claimant from %s',
    async (action) => {
      const claimed = {
        ...createPendingRequest(),
        status: 'claimed' as const,
        claimedByHumanId: 'cc0e8400-e29b-41d4-a716-446655440007',
        signingCredentialId: CREDENTIAL_ID,
        methodState: {
          verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
          value: {},
        },
      };
      mocks.signingRequestRepository.findById.mockResolvedValue(claimed);

      const response = await app.inject({
        method: 'POST',
        url: `/crypto/signing-requests/${claimed.id}/${action}`,
        headers: {
          authorization: 'Bearer human-session',
          'x-moltnet-team-id': TEAM_ID,
        },
        payload:
          action === 'complete'
            ? {
                receipt: {
                  verificationMethod:
                    VERIFICATION_METHOD.HumanHardwarePreviewSign,
                  value: { version: 1, signature: SIGNATURE },
                },
              }
            : {},
      });

      expect(response.statusCode).toBe(403);
    },
  );
});
