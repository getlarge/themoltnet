import { type RuntimeProfile, UniqueViolationError } from '@moltnet/database';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createMockServices,
  createTestApp,
  OWNER_ID,
  resetMockServices,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const TEAM_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const PROFILE_ID = 'dddddddd-0000-0000-0000-000000000004';

function mockProfile(overrides: Partial<RuntimeProfile> = {}): RuntimeProfile {
  return {
    id: PROFILE_ID,
    teamId: TEAM_ID,
    name: 'linear-github',
    description: 'Linear triage and GitHub implementation profile',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    thinkingLevel: null,
    temperature: null,
    topP: null,
    topK: null,
    maxOutputTokens: null,
    runtimeKind: 'gondolin_pi',
    sandbox: {},
    sessionStorageMode: 'local',
    workspaceStorageMode: 'local',
    defaultWorkspaceMode: null,
    allowedWorkspaceModes: ['none', 'shared_mount', 'dedicated_worktree'],
    sessionTtlSec: 1800,
    workspaceTtlSec: 1800,
    leaseTtlSec: 300,
    heartbeatIntervalMs: 60_000,
    maxBatchSize: 50,
    maxTurns: 0,
    maxBashTimeouts: 3,
    requiredEnv: ['LINEAR_API_KEY', 'GITHUB_TOKEN'],
    requiredTools: ['linear.issue.get', 'github.pr.create'],
    context: [
      {
        slug: 'linear-github-workflow',
        binding: 'skill',
        content: 'Use Linear for brief intake and GitHub for delivery.',
      },
    ],
    revision: 1,
    definitionCid: 'bafyprofile',
    createdByAgentId: OWNER_ID,
    createdByHumanId: null,
    createdAt: new Date('2026-06-12T10:00:00.000Z'),
    updatedAt: new Date('2026-06-12T10:00:00.000Z'),
    ...overrides,
  };
}

describe('runtime profile routes', () => {
  let app: FastifyInstance;
  let mocks: ReturnType<typeof createMockServices>;

  beforeAll(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetMockServices(mocks);
  });

  it('creates a runtime profile for a managed team', async () => {
    mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
    mocks.permissionChecker.canManageTeamRuntime.mockResolvedValue(true);
    mocks.teamRepository.findById.mockResolvedValue({ id: TEAM_ID });
    mocks.runtimeProfileRepository.create.mockResolvedValue(
      mockProfile({
        thinkingLevel: 'high',
        temperature: 0.2,
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 12_000,
        sandbox: {
          network: {
            allowedHosts: ['api.linear.app'],
            allowedInternalHosts: ['onboard-api.internal'],
          },
        },
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/runtime-profiles',
      headers: {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: {
        name: 'linear-github',
        description: 'Linear triage and GitHub implementation profile',
        provider: 'Anthropic',
        model: 'Claude-Sonnet-4-5',
        thinkingLevel: 'high',
        temperature: 0.2,
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 12_000,
        sandbox: {
          network: {
            allowedHosts: ['api.linear.app'],
            allowedInternalHosts: ['onboard-api.internal'],
          },
          resumeCommands: [
            {
              run: 'linear issue view "$LINEAR_ISSUE_ID"',
              retries: 1,
            },
          ],
          hostExec: { autoApprove: false },
        },
        defaultWorkspaceMode: 'dedicated_worktree',
        allowedWorkspaceModes: ['none', 'dedicated_worktree'],
        leaseTtlSec: 900,
        heartbeatIntervalMs: 15_000,
        maxBatchSize: 10,
        maxTurns: 30,
        maxBashTimeouts: 2,
        requiredEnv: ['LINEAR_API_KEY', 'GITHUB_TOKEN'],
        requiredTools: ['linear.issue.get', 'github.pr.create'],
        context: [
          {
            slug: 'linear-github-workflow',
            binding: 'skill',
            content: 'Use Linear for brief intake and GitHub for delivery.',
          },
        ],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id: PROFILE_ID,
      name: 'linear-github',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      thinkingLevel: 'high',
      temperature: 0.2,
      topP: 0.9,
      topK: 40,
      maxOutputTokens: 12_000,
      sandbox: {
        network: {
          allowedHosts: ['api.linear.app'],
          allowedInternalHosts: ['onboard-api.internal'],
        },
      },
      runtimeKind: 'gondolin_pi',
      leaseTtlSec: 300,
      heartbeatIntervalMs: 60_000,
      maxBatchSize: 50,
      maxTurns: 0,
      maxBashTimeouts: 3,
      defaultWorkspaceMode: null,
      allowedWorkspaceModes: ['none', 'shared_mount', 'dedicated_worktree'],
    });
    expect(mocks.runtimeProfileRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: TEAM_ID,
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        thinkingLevel: 'high',
        temperature: 0.2,
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 12_000,
        leaseTtlSec: 900,
        heartbeatIntervalMs: 15_000,
        maxBatchSize: 10,
        maxTurns: 30,
        maxBashTimeouts: 2,
        sandbox: expect.objectContaining({
          network: {
            allowedHosts: ['api.linear.app'],
            allowedInternalHosts: ['onboard-api.internal'],
          },
        }),
        defaultWorkspaceMode: 'dedicated_worktree',
        allowedWorkspaceModes: ['none', 'dedicated_worktree'],
        createdByAgentId: OWNER_ID,
        createdByHumanId: null,
        definitionCid: expect.stringMatching(/^ba/),
      }),
    );
  });

  it('rejects runtime profiles whose default workspace mode is not allowed', async () => {
    mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
    mocks.permissionChecker.canManageTeamRuntime.mockResolvedValue(true);
    mocks.teamRepository.findById.mockResolvedValue({ id: TEAM_ID });

    const response = await app.inject({
      method: 'POST',
      url: '/runtime-profiles',
      headers: {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: {
        name: 'repo-less',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        sandbox: {},
        defaultWorkspaceMode: 'shared_mount',
        allowedWorkspaceModes: ['none'],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [
        {
          field: 'defaultWorkspaceMode',
          message:
            'defaultWorkspaceMode must be included in allowedWorkspaceModes',
        },
      ],
    });
    expect(mocks.runtimeProfileRepository.create).not.toHaveBeenCalled();
  });

  it('rejects invalid model option boundaries', async () => {
    mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
    mocks.permissionChecker.canManageTeamRuntime.mockResolvedValue(true);
    mocks.teamRepository.findById.mockResolvedValue({ id: TEAM_ID });

    const cases = [
      { temperature: -0.1 },
      { temperature: 2.1 },
      { topP: -0.1 },
      { topP: 1.1 },
      { topK: 0 },
      { maxOutputTokens: 0 },
      { thinkingLevel: 'extreme' },
    ];

    for (const modelOptions of cases) {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime-profiles',
        headers: {
          authorization: 'Bearer test-token',
          'x-moltnet-team-id': TEAM_ID,
        },
        payload: {
          name: `invalid-${Object.keys(modelOptions)[0]}`,
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          sandbox: {},
          ...modelOptions,
        },
      });

      expect(
        response.statusCode,
        `${JSON.stringify(modelOptions)} -> ${response.body}`,
      ).toBe(400);
    }

    expect(mocks.runtimeProfileRepository.create).not.toHaveBeenCalled();
  });

  it('lists runtime profiles when the caller can access the team', async () => {
    mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
    mocks.runtimeProfileRepository.listByTeamId.mockResolvedValue([
      mockProfile(),
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/runtime-profiles',
      headers: {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [{ id: PROFILE_ID, name: 'linear-github' }],
    });
  });

  it('rejects sandbox configs with host exec auto-approval', async () => {
    mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
    mocks.permissionChecker.canManageTeamRuntime.mockResolvedValue(true);
    mocks.teamRepository.findById.mockResolvedValue({ id: TEAM_ID });

    const response = await app.inject({
      method: 'POST',
      url: '/runtime-profiles',
      headers: {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: {
        name: 'unsafe',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        sandbox: {
          hostExec: { autoApprove: true },
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.runtimeProfileRepository.create).not.toHaveBeenCalled();
  });

  it.each(['allowedHosts', 'allowedInternalHosts'] as const)(
    'rejects malformed runtime egress hosts in %s',
    async (field) => {
      // Arrange
      mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
      mocks.permissionChecker.canManageTeamRuntime.mockResolvedValue(true);
      mocks.teamRepository.findById.mockResolvedValue({ id: TEAM_ID });

      // Act
      const response = await app.inject({
        method: 'POST',
        url: '/runtime-profiles',
        headers: {
          authorization: 'Bearer test-token',
          'x-moltnet-team-id': TEAM_ID,
        },
        payload: {
          name: 'unsafe-network',
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          sandbox: {
            network: { [field]: ['https://example.com'] },
          },
        },
      });

      // Assert
      expect(response.statusCode).toBe(400);
      expect(mocks.runtimeProfileRepository.create).not.toHaveBeenCalled();
    },
  );

  it('returns typed conflict details for duplicate profile names', async () => {
    mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
    mocks.permissionChecker.canManageTeamRuntime.mockResolvedValue(true);
    mocks.teamRepository.findById.mockResolvedValue({ id: TEAM_ID });
    mocks.runtimeProfileRepository.create.mockRejectedValue(
      new UniqueViolationError({
        constraint: 'runtime_profiles_team_name_idx',
        target: {
          resource: 'runtime-profile',
          keys: {
            teamId: TEAM_ID,
            name: 'linear-github',
          },
        },
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/runtime-profiles',
      headers: {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: {
        name: 'linear-github',
        description: 'Linear triage and GitHub implementation profile',
        provider: 'Anthropic',
        model: 'Claude-Sonnet-4-5',
        sandbox: {
          resumeCommands: [
            {
              run: 'linear issue view "$LINEAR_ISSUE_ID"',
              retries: 1,
            },
          ],
          hostExec: { autoApprove: false },
        },
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 'CONFLICT',
      conflict: {
        constraint: 'runtime_profiles_team_name_idx',
        target: {
          resource: 'runtime-profile',
          keys: {
            teamId: TEAM_ID,
            name: 'linear-github',
          },
        },
      },
    });
  });

  it('returns typed conflict details for duplicate profile names on update', async () => {
    mocks.permissionChecker.canManageTeamRuntime.mockResolvedValue(true);
    mocks.runtimeProfileRepository.findById.mockResolvedValue(mockProfile());
    mocks.runtimeProfileRepository.update.mockRejectedValue(
      new UniqueViolationError({
        constraint: 'runtime_profiles_team_name_idx',
        target: {
          resource: 'runtime-profile',
          keys: {
            teamId: TEAM_ID,
            name: 'deploy-bot',
          },
        },
      }),
    );

    const response = await app.inject({
      method: 'PATCH',
      url: `/runtime-profiles/${PROFILE_ID}`,
      headers: { authorization: 'Bearer test-token' },
      payload: {
        name: 'deploy-bot',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 'CONFLICT',
      conflict: {
        constraint: 'runtime_profiles_team_name_idx',
        target: {
          resource: 'runtime-profile',
          keys: {
            teamId: TEAM_ID,
            name: 'deploy-bot',
          },
        },
      },
    });
    expect(mocks.runtimeProfileRepository.update).toHaveBeenCalledWith(
      PROFILE_ID,
      expect.objectContaining({
        name: 'deploy-bot',
      }),
    );
  });

  it('preserves model options when update omits them', async () => {
    mocks.permissionChecker.canManageTeamRuntime.mockResolvedValue(true);
    mocks.runtimeProfileRepository.findById.mockResolvedValue(
      mockProfile({
        thinkingLevel: 'medium',
        temperature: 0.3,
        topP: 0.8,
        topK: 32,
        maxOutputTokens: 16_000,
      }),
    );
    mocks.runtimeProfileRepository.update.mockResolvedValue(
      mockProfile({
        model: 'claude-opus-4-1',
        thinkingLevel: 'medium',
        temperature: 0.3,
        topP: 0.8,
        topK: 32,
        maxOutputTokens: 16_000,
        revision: 2,
      }),
    );

    const response = await app.inject({
      method: 'PATCH',
      url: `/runtime-profiles/${PROFILE_ID}`,
      headers: { authorization: 'Bearer test-token' },
      payload: {
        model: 'Claude-Opus-4-1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      model: 'claude-opus-4-1',
      thinkingLevel: 'medium',
      temperature: 0.3,
      topP: 0.8,
      topK: 32,
      maxOutputTokens: 16_000,
      revision: 2,
    });
    expect(mocks.runtimeProfileRepository.update).toHaveBeenCalledWith(
      PROFILE_ID,
      expect.objectContaining({
        model: 'claude-opus-4-1',
        thinkingLevel: 'medium',
        temperature: 0.3,
        topP: 0.8,
        topK: 32,
        maxOutputTokens: 16_000,
      }),
    );
  });
});
