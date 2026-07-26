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
  credentialType: 'test-only',
  algorithm: 'test-only',
  publicMaterial: { version: 1, publicKey: 'public' },
  enrollmentEvidence: { version: 1, proofHash: 'proof' },
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
      challenge: {
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        challenge: 'test-challenge',
      },
      verifierState: { expected: 'test-receipt' },
    }),
    verifyReceipt: vi.fn().mockResolvedValue({
      verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
      credentialId: CREDENTIAL_ID,
      proofHash: 'proof',
    }),
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
        credentialType: 'test-only',
        algorithm: 'test-only',
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
        credentialType: 'test-only',
        algorithm: 'test-only',
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

  it('rejects nested private material before persistence', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/crypto/signing-credentials/registrations/${CREDENTIAL_ID}/complete`,
      headers: {
        authorization: 'Bearer human-session',
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: {
        publicMaterial: {
          version: 1,
          nested: { privateKey: 'must-not-persist' },
        },
        receipt: {
          verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
          value: {},
        },
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
        value: { challenge: 'test-challenge' },
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
        value: { receipt: 'test-receipt' },
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
        receipt: {
          verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
          value: { receipt: 'test-receipt' },
        },
      },
    });
    expect(completeResponse.statusCode).toBe(200);
    expect(completeResponse.json()).toMatchObject({
      status: 'completed',
      valid: true,
    });
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
                  value: {},
                },
              }
            : {},
      });

      expect(response.statusCode).toBe(403);
    },
  );
});
