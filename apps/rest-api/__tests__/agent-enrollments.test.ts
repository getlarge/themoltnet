import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createMockServices,
  createTestApp,
  HUMAN_AUTH_CONTEXT,
  type MockServices,
  OWNER_ID,
  resetMockServices,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const TEAM_ID = '660e8400-e29b-41d4-a716-446655440001';
const ENROLLMENT_ID = '770e8400-e29b-41d4-a716-446655440002';
const TOKEN = 'a'.repeat(43);

function enrollment() {
  return {
    id: ENROLLMENT_ID,
    tokenHash: 'f'.repeat(64),
    teamId: TEAM_ID,
    creatorAgentId: OWNER_ID,
    creatorHumanId: null,
    expiresAt: new Date('2026-08-14T12:15:00.000Z'),
    redeemedAt: null,
    revokedAt: null,
    resultingAgentId: null,
    createdAt: new Date('2026-08-14T12:00:00.000Z'),
  };
}

describe.each([
  ['agent', VALID_AUTH_CONTEXT],
  ['human', HUMAN_AUTH_CONTEXT],
] as const)('agent enrollments as %s manager', (_kind, authContext) => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeAll(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, authContext);
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    resetMockServices(mocks);
    mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
    mocks.permissionChecker.canManageTeamMembers.mockResolvedValue(true);
    mocks.teamRepository.findById.mockResolvedValue({
      id: TEAM_ID,
      personal: false,
    });
  });

  it('creates a short-lived token and returns it exactly once', async () => {
    mocks.agentEnrollmentRepository.create.mockResolvedValue({
      enrollment: enrollment(),
      token: TOKEN,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/agent-enrollments',
      headers: {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: { expiresInMinutes: 15 },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(
      expect.objectContaining({
        id: ENROLLMENT_ID,
        teamId: TEAM_ID,
        token: TOKEN,
      }),
    );
    expect(mocks.agentEnrollmentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: TEAM_ID, expiresAt: expect.any(Date) }),
    );
  });

  it('revokes an unused enrollment', async () => {
    mocks.agentEnrollmentRepository.revoke.mockResolvedValue(enrollment());
    const response = await app.inject({
      method: 'DELETE',
      url: `/agent-enrollments/${ENROLLMENT_ID}`,
      headers: {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      },
    });
    expect(response.statusCode).toBe(204);
    expect(mocks.agentEnrollmentRepository.revoke).toHaveBeenCalledWith(
      ENROLLMENT_ID,
      TEAM_ID,
    );
  });
});

describe('agent enrollment authorization', () => {
  it('forbids an ordinary team member', async () => {
    const mocks = createMockServices();
    mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
    mocks.permissionChecker.canManageTeamMembers.mockResolvedValue(false);
    const app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
    const response = await app.inject({
      method: 'POST',
      url: '/agent-enrollments',
      headers: {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: {},
    });
    expect(response.statusCode).toBe(403);
    expect(mocks.agentEnrollmentRepository.create).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects enrollment creation for personal teams', async () => {
    const mocks = createMockServices();
    mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
    mocks.permissionChecker.canManageTeamMembers.mockResolvedValue(true);
    mocks.teamRepository.findById.mockResolvedValue({
      id: TEAM_ID,
      personal: true,
    });
    const app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
    const response = await app.inject({
      method: 'POST',
      url: '/agent-enrollments',
      headers: {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
