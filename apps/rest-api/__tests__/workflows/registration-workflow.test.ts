import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { registerStep, registerWorkflow, startWorkflow } = vi.hoisted(() => ({
  registerStep: vi.fn((fn) => fn),
  registerWorkflow: vi.fn((fn) => fn),
  startWorkflow: vi.fn((fn) => async (...args: unknown[]) => ({
    getResult: async () => fn(...args),
  })),
}));

vi.mock('@moltnet/database', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DBOS: {
    registerStep,
    registerWorkflow,
    startWorkflow,
    workflowID: 'registration-test',
  },
}));

import {
  EnrollmentValidationError,
  initRegistrationWorkflow,
  issueRegistrationCredential,
  registrationWorkflow,
  setRegistrationDeps,
} from '../../src/workflows/registration-workflow.js';

const IDENTITY_ID = '550e8400-e29b-41d4-a716-446655440000';
const TEAM_ID = '660e8400-e29b-41d4-a716-446655440000';
const PUBLIC_KEY = 'ed25519:dGVzdA==';
const FINGERPRINT = 'AAAA-BBBB-CCCC-DDDD';
const TOKEN_HASH = 'f'.repeat(64);

function createDeps() {
  const diary = {
    id: '770e8400-e29b-41d4-a716-446655440000',
    name: 'Private',
    teamId: TEAM_ID,
  };
  return {
    identityApi: {
      listIdentitySchemas: vi.fn().mockResolvedValue([
        {
          id: 'agent-v1',
          schema: { $id: 'https://schemas.themolt.net/agent.json' },
        },
        {
          id: 'agent-v2',
          schema: { $id: 'https://schemas.themolt.net/agent-v2.json' },
        },
      ]),
      createIdentity: vi.fn().mockResolvedValue({ id: IDENTITY_ID }),
      listIdentities: vi.fn().mockResolvedValue([]),
      deleteIdentity: vi.fn(),
    },
    oauth2Api: {
      createOAuth2Client: vi.fn(),
      deleteOAuth2Client: vi.fn(),
      setOAuth2Client: vi.fn(),
    },
    agentRepository: {
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    diaryRepository: {
      listByCreator: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue(diary),
      delete: vi.fn().mockResolvedValue(true),
    },
    teamRepository: {
      findInviteByCode: vi.fn().mockResolvedValue({
        id: 'invite-1',
        teamId: TEAM_ID,
        expiresAt: new Date('2030-01-01'),
        role: 'member',
      }),
      findInviteById: vi.fn().mockResolvedValue({
        id: 'invite-1',
        teamId: TEAM_ID,
        expiresAt: new Date('2030-01-01'),
        role: 'member',
      }),
      findById: vi.fn().mockResolvedValue({
        id: TEAM_ID,
        personal: false,
        status: 'active',
      }),
      claimInvite: vi
        .fn()
        .mockResolvedValue({ id: 'invite-1', teamId: TEAM_ID }),
      revertInviteClaim: vi.fn(),
      findPersonalByCreator: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: TEAM_ID }),
      delete: vi.fn().mockResolvedValue(true),
    },
    relationshipWriter: {
      registerAgent: vi.fn(),
      removeAgentRelations: vi.fn(),
      grantTeamOwners: vi.fn(),
      grantTeamManagers: vi.fn(),
      grantTeamExecutors: vi.fn(),
      grantTeamMembers: vi.fn(),
      removeTeamMemberRelation: vi.fn(),
      grantDiaryTeam: vi.fn(),
      removeDiaryRelations: vi.fn(),
    },
    issueAgentKey: vi.fn().mockResolvedValue({
      key: {
        id: 'key-id',
        agentId: IDENTITY_ID,
        teamId: TEAM_ID,
        name: 'Bootstrap credential',
        scopes: [],
        status: 'active',
        createdAt: null,
        expiresAt: null,
        lastUsedAt: null,
        updatedAt: null,
        revocationReason: null,
        revocationDescription: null,
      },
      secret: 'agent-secret',
    }),
    transactionRunner: {
      runInTransaction: vi.fn(async (fn) => fn()),
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe('registration workflow', () => {
  beforeAll(() => initRegistrationWorkflow());

  beforeEach(() => vi.clearAllMocks());

  it('self-registers with a personal team, private diary, and OAuth2 credential', async () => {
    const deps = createDeps();
    setRegistrationDeps(deps as never);

    const workflowResult = await registrationWorkflow.registerAgent({
      publicKey: PUBLIC_KEY,
      fingerprint: FINGERPRINT,
      credentialType: 'oauth2',
      idempotencyKey: 'nonce',
      mode: { type: 'self' },
    });

    expect(workflowResult).toEqual({
      identityId: IDENTITY_ID,
      identityOwnedForCompensation: true,
      publicKey: PUBLIC_KEY,
      fingerprint: FINGERPRINT,
      teamId: TEAM_ID,
      credentialType: 'oauth2',
      credentialIdempotencyKey: 'nonce',
    });
    expect(deps.oauth2Api.createOAuth2Client).not.toHaveBeenCalled();
    const result = await issueRegistrationCredential(workflowResult);
    expect(result.credential).toEqual({
      type: 'oauth2',
      clientId: `moltnet-agent-${IDENTITY_ID}`,
      clientSecret: expect.any(String),
    });
    expect(deps.teamRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ personal: true }),
    );
    expect(deps.identityApi.createIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        createIdentityBody: expect.objectContaining({ schema_id: 'agent-v2' }),
      }),
    );
    expect(deps.relationshipWriter.grantTeamOwners).toHaveBeenCalledOnce();
    expect(deps.diaryRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Private', visibility: 'private' }),
    );
    expect(deps.issueAgentKey).not.toHaveBeenCalled();
  });

  it('atomically claims a team invite and grants its role', async () => {
    const deps = createDeps();
    setRegistrationDeps(deps as never);

    const workflowResult = await registrationWorkflow.registerAgent({
      publicKey: PUBLIC_KEY,
      fingerprint: FINGERPRINT,
      credentialType: 'agent_key',
      idempotencyKey: 'nonce',
      mode: {
        type: 'team_invite',
        inviteId: 'invite-1',
        inviteCodeHash: TOKEN_HASH,
      },
    });

    expect(deps.issueAgentKey).not.toHaveBeenCalled();
    const result = await issueRegistrationCredential(workflowResult);
    expect(result.credential).toEqual(
      expect.objectContaining({ type: 'agent_key', secret: 'agent-secret' }),
    );
    expect(deps.teamRepository.claimInvite).toHaveBeenCalledWith('invite-1');
    expect(deps.relationshipWriter.grantTeamMembers).toHaveBeenCalledWith(
      TEAM_ID,
      IDENTITY_ID,
      'Agent',
    );
    expect(deps.relationshipWriter.grantTeamOwners).not.toHaveBeenCalled();
    expect(deps.teamRepository.create).not.toHaveBeenCalled();
    expect(deps.diaryRepository.create).not.toHaveBeenCalled();
    expect(deps.issueAgentKey).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'nonce',
        recoverReplayByRotation: true,
        teamId: TEAM_ID,
      }),
    );
  });

  it('honors an executor team invite for managed-agent enrollment', async () => {
    const deps = createDeps();
    deps.teamRepository.findInviteById.mockResolvedValue({
      id: 'invite-1',
      teamId: TEAM_ID,
      expiresAt: new Date('2030-01-01'),
      role: 'executor',
    });
    setRegistrationDeps(deps as never);

    await registrationWorkflow.registerAgent({
      publicKey: PUBLIC_KEY,
      fingerprint: FINGERPRINT,
      credentialType: 'oauth2',
      idempotencyKey: 'executor-nonce',
      mode: {
        type: 'team_invite',
        inviteId: 'invite-1',
        inviteCodeHash: TOKEN_HASH,
      },
    });

    expect(deps.relationshipWriter.grantTeamExecutors).toHaveBeenCalledWith(
      TEAM_ID,
      IDENTITY_ID,
      'Agent',
    );
    expect(deps.relationshipWriter.grantTeamMembers).not.toHaveBeenCalled();
  });

  it('reconciles a lost Kratos create response through the public-key identifier', async () => {
    const deps = createDeps();
    deps.identityApi.createIdentity.mockRejectedValueOnce({
      response: { status: 409 },
    });
    deps.identityApi.listIdentities.mockResolvedValueOnce([
      {
        id: IDENTITY_ID,
        schema_id: 'agent-v2',
        traits: { public_key: PUBLIC_KEY },
      },
    ]);
    setRegistrationDeps(deps as never);

    const result = await registrationWorkflow.registerAgent({
      publicKey: PUBLIC_KEY,
      fingerprint: FINGERPRINT,
      credentialType: 'oauth2',
      idempotencyKey: 'nonce',
      mode: { type: 'self' },
    });

    expect(result.identityId).toBe(IDENTITY_ID);
    expect(deps.identityApi.listIdentities).toHaveBeenCalledWith({
      consistency: 'strong',
      credentialsIdentifier: PUBLIC_KEY,
    });
    expect(deps.agentRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ identityId: IDENTITY_ID }),
    );
  });

  it('preserves a pre-existing Kratos identity while compensating owned resources', async () => {
    const deps = createDeps();
    deps.identityApi.createIdentity.mockRejectedValueOnce({
      response: { status: 409 },
    });
    deps.identityApi.listIdentities.mockResolvedValueOnce([
      {
        id: IDENTITY_ID,
        schema_id: 'agent-v2',
        traits: { public_key: PUBLIC_KEY },
        metadata_admin: {
          moltnet_registration_workflow_id: 'another-registration',
        },
      },
    ]);
    deps.relationshipWriter.registerAgent.mockRejectedValueOnce(
      new Error('Keto unavailable'),
    );
    setRegistrationDeps(deps as never);

    await expect(
      registrationWorkflow.registerAgent({
        publicKey: PUBLIC_KEY,
        fingerprint: FINGERPRINT,
        credentialType: 'oauth2',
        idempotencyKey: 'nonce',
        mode: { type: 'self' },
      }),
    ).rejects.toThrow('Keto unavailable');

    expect(deps.identityApi.deleteIdentity).not.toHaveBeenCalled();
    expect(deps.agentRepository.delete).toHaveBeenCalledWith(IDENTITY_ID);
  });

  it('allows only one winner when an invite claim loses a concurrent race', async () => {
    const deps = createDeps();
    deps.teamRepository.claimInvite.mockResolvedValueOnce(null);
    setRegistrationDeps(deps as never);

    await expect(
      registrationWorkflow.registerAgent({
        publicKey: PUBLIC_KEY,
        fingerprint: FINGERPRINT,
        credentialType: 'oauth2',
        idempotencyKey: 'nonce',
        mode: {
          type: 'team_invite',
          inviteId: 'invite-1',
          inviteCodeHash: TOKEN_HASH,
        },
      }),
    ).rejects.toThrow(EnrollmentValidationError);
    expect(deps.oauth2Api.createOAuth2Client).not.toHaveBeenCalled();
    expect(deps.identityApi.deleteIdentity).toHaveBeenCalledWith({
      id: IDENTITY_ID,
    });
  });

  it('does not persist or compensate registration when HTTP credential issuance fails', async () => {
    const deps = createDeps();
    deps.oauth2Api.createOAuth2Client.mockRejectedValueOnce(
      new Error('Hydra unavailable'),
    );
    deps.teamRepository.findPersonalByCreator.mockResolvedValue({
      id: TEAM_ID,
    });
    deps.diaryRepository.listByCreator.mockResolvedValue([
      { id: 'diary-id', name: 'Private', teamId: TEAM_ID },
    ]);
    setRegistrationDeps(deps as never);

    const workflowResult = await registrationWorkflow.registerAgent({
      publicKey: PUBLIC_KEY,
      fingerprint: FINGERPRINT,
      credentialType: 'oauth2',
      idempotencyKey: 'nonce',
      mode: { type: 'self' },
    });
    await expect(issueRegistrationCredential(workflowResult)).rejects.toThrow(
      'Hydra unavailable',
    );
    expect(deps.teamRepository.delete).not.toHaveBeenCalled();
    expect(deps.agentRepository.delete).not.toHaveBeenCalled();
    expect(deps.identityApi.deleteIdentity).not.toHaveBeenCalled();
  });

  it('keeps a redeemed enrollment retryable when HTTP credential issuance fails', async () => {
    const deps = createDeps();
    deps.issueAgentKey.mockRejectedValueOnce(new Error('Talos unavailable'));
    setRegistrationDeps(deps as never);

    const workflowResult = await registrationWorkflow.registerAgent({
      publicKey: PUBLIC_KEY,
      fingerprint: FINGERPRINT,
      credentialType: 'agent_key',
      idempotencyKey: 'nonce',
      mode: {
        type: 'team_invite',
        inviteId: 'invite-1',
        inviteCodeHash: TOKEN_HASH,
      },
    });
    await expect(issueRegistrationCredential(workflowResult)).rejects.toThrow(
      'Talos unavailable',
    );
    expect(deps.teamRepository.revertInviteClaim).not.toHaveBeenCalled();
    expect(deps.agentRepository.delete).not.toHaveBeenCalled();
    expect(deps.identityApi.deleteIdentity).not.toHaveBeenCalled();
  });
});
