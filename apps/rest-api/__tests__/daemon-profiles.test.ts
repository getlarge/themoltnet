import type { DaemonProfile } from '@moltnet/database';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockServices,
  createTestApp,
  OWNER_ID,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const TEAM_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const PROFILE_ID = 'dddddddd-0000-0000-0000-000000000004';

function mockProfile(overrides: Partial<DaemonProfile> = {}): DaemonProfile {
  return {
    id: PROFILE_ID,
    teamId: TEAM_ID,
    name: 'linear-github',
    description: 'Linear triage and GitHub implementation profile',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    runtimeKind: 'gondolin_pi',
    sandbox: {},
    sessionStorageMode: 'local',
    workspaceStorageMode: 'local',
    sessionTtlSec: 1800,
    workspaceTtlSec: 1800,
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

describe('daemon profile routes', () => {
  let app: FastifyInstance;
  let mocks: ReturnType<typeof createMockServices>;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
  });

  it('creates a daemon profile for a managed team', async () => {
    mocks.permissionChecker.canManageTeam.mockResolvedValue(true);
    mocks.teamRepository.findById.mockResolvedValue({ id: TEAM_ID });
    mocks.daemonProfileRepository.create.mockResolvedValue(mockProfile());

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${TEAM_ID}/daemon-profiles`,
      headers: { authorization: 'Bearer test-token' },
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
      runtimeKind: 'gondolin_pi',
    });
    expect(mocks.daemonProfileRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: TEAM_ID,
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        createdByAgentId: OWNER_ID,
        createdByHumanId: null,
        definitionCid: expect.stringMatching(/^ba/),
      }),
    );
  });

  it('lists daemon profiles when the caller can access the team', async () => {
    mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
    mocks.daemonProfileRepository.listByTeamId.mockResolvedValue([
      mockProfile(),
    ]);

    const response = await app.inject({
      method: 'GET',
      url: `/teams/${TEAM_ID}/daemon-profiles`,
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [{ id: PROFILE_ID, name: 'linear-github' }],
    });
  });

  it('rejects sandbox configs with host exec auto-approval', async () => {
    mocks.permissionChecker.canManageTeam.mockResolvedValue(true);
    mocks.teamRepository.findById.mockResolvedValue({ id: TEAM_ID });

    const response = await app.inject({
      method: 'POST',
      url: `/teams/${TEAM_ID}/daemon-profiles`,
      headers: { authorization: 'Bearer test-token' },
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
    expect(mocks.daemonProfileRepository.create).not.toHaveBeenCalled();
  });
});
