import type { RuntimeSlot, RuntimeWorkspace } from '@moltnet/database';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockServices,
  createTestApp,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const TEAM_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const OTHER_TEAM_ID = 'bbbbbbbb-0000-0000-0000-000000000099';
const TASK_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const PROFILE_ID = 'dddddddd-0000-0000-0000-000000000004';
const SLOT_ID = 'eeeeeeee-0000-0000-0000-000000000005';
const WORKSPACE_ROW_ID = 'ffffffff-0000-0000-0000-000000000006';
const TEAM_HEADERS = {
  authorization: 'Bearer test-token',
  'x-moltnet-team-id': TEAM_ID,
};

function mockSlot(overrides: Partial<RuntimeSlot> = {}): RuntimeSlot {
  return {
    id: SLOT_ID,
    teamId: TEAM_ID,
    agentName: 'legreffier',
    daemonProfileId: PROFILE_ID,
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    slotKey: 'freeform:correlation:test',
    taskType: 'freeform',
    state: 'active',
    lastTaskId: TASK_ID,
    lastAttemptN: 1,
    sessionDir: '/tmp/session',
    sessionPath: '/tmp/session/0001.jsonl',
    workspaceRowId: WORKSPACE_ROW_ID,
    createdAtMs: 1000,
    lastUsedAtMs: 2000,
    expiresAtMs: 3000,
    createdAt: new Date('2026-06-22T00:00:00.000Z'),
    updatedAt: new Date('2026-06-22T00:00:00.000Z'),
    ...overrides,
  };
}

function mockWorkspace(
  overrides: Partial<RuntimeWorkspace> = {},
): RuntimeWorkspace {
  return {
    id: WORKSPACE_ROW_ID,
    teamId: TEAM_ID,
    workspaceId: 'workspace-a',
    worktreePath: '/tmp/worktree',
    worktreeBranch: 'issue-1414',
    kind: 'origin',
    createdAtMs: 1000,
    lastUsedAtMs: 2000,
    createdAt: new Date('2026-06-22T00:00:00.000Z'),
    updatedAt: new Date('2026-06-22T00:00:00.000Z'),
    ...overrides,
  };
}

describe('runtime slot routes', () => {
  let app: FastifyInstance;
  let mocks: ReturnType<typeof createMockServices>;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
    mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
    mocks.taskRepository.findById.mockResolvedValue({
      id: TASK_ID,
      teamId: TEAM_ID,
    });
    mocks.taskRepository.findAttempt.mockResolvedValue({
      attemptN: 1,
      taskId: TASK_ID,
    });
    mocks.daemonProfileRepository.findById.mockResolvedValue({
      id: PROFILE_ID,
      teamId: TEAM_ID,
    });
  });

  it('begins a team-scoped runtime slot for the authenticated agent', async () => {
    mocks.runtimeSlotRepository.begin.mockResolvedValue(mockSlot());

    const response = await app.inject({
      method: 'POST',
      url: '/runtime-slots/begin',
      headers: TEAM_HEADERS,
      payload: {
        agentName: 'legreffier',
        daemonProfileId: PROFILE_ID,
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        slotKey: 'freeform:correlation:test',
        taskType: 'freeform',
        sessionDir: '/tmp/session',
        sessionPath: '/tmp/session/0001.jsonl',
        workspaceId: 'workspace-a',
        worktreePath: '/tmp/worktree',
        worktreeBranch: 'issue-1414',
        workspaceKind: 'origin',
        lastTaskId: TASK_ID,
        lastAttemptN: 1,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: SLOT_ID,
      teamId: TEAM_ID,
      daemonProfileId: PROFILE_ID,
      sessionPath: '/tmp/session/0001.jsonl',
      state: 'active',
    });
    expect(mocks.runtimeSlotRepository.begin).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: TEAM_ID,
        daemonProfileId: PROFILE_ID,
        lastTaskId: TASK_ID,
        lastAttemptN: 1,
      }),
    );
  });

  it('rejects a slot whose task is outside the declared team', async () => {
    mocks.taskRepository.findById.mockResolvedValue({
      id: TASK_ID,
      teamId: OTHER_TEAM_ID,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/runtime-slots/begin',
      headers: TEAM_HEADERS,
      payload: {
        agentName: 'legreffier',
        daemonProfileId: PROFILE_ID,
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        slotKey: 'freeform:correlation:test',
        taskType: 'freeform',
        lastTaskId: TASK_ID,
        lastAttemptN: 1,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.runtimeSlotRepository.begin).not.toHaveBeenCalled();
  });

  it('rejects a slot whose task attempt does not exist', async () => {
    mocks.taskRepository.findAttempt.mockResolvedValue(null);

    const response = await app.inject({
      method: 'POST',
      url: '/runtime-slots/begin',
      headers: TEAM_HEADERS,
      payload: {
        agentName: 'legreffier',
        daemonProfileId: PROFILE_ID,
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        slotKey: 'freeform:correlation:test',
        taskType: 'freeform',
        lastTaskId: TASK_ID,
        lastAttemptN: 1,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [
        {
          field: 'attemptN',
        },
      ],
    });
    expect(mocks.runtimeSlotRepository.begin).not.toHaveBeenCalled();
  });

  it('finds the latest runtime slot scoped to team and attempt', async () => {
    mocks.runtimeSlotRepository.findLatestByTaskAttempt.mockResolvedValue({
      slot: mockSlot({ state: 'idle' }),
      workspace: mockWorkspace(),
    });

    const response = await app.inject({
      method: 'GET',
      url: `/runtime-slots/latest?taskId=${TASK_ID}&attemptN=1`,
      headers: TEAM_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      slot: {
        id: SLOT_ID,
        teamId: TEAM_ID,
        state: 'idle',
        lastTaskId: TASK_ID,
        lastAttemptN: 1,
        sessionPath: '/tmp/session/0001.jsonl',
      },
      workspace: { workspaceId: 'workspace-a' },
    });
    expect(
      mocks.runtimeSlotRepository.findLatestByTaskAttempt,
    ).toHaveBeenCalledWith(TEAM_ID, TASK_ID, 1);
  });

  it('finishes only the slot currently tied to the provided task attempt', async () => {
    mocks.runtimeSlotRepository.finish.mockResolvedValue(
      mockSlot({ state: 'idle' }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/runtime-slots/finish',
      headers: TEAM_HEADERS,
      payload: {
        agentName: 'legreffier',
        daemonProfileId: PROFILE_ID,
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        slotKey: 'freeform:correlation:test',
        taskId: TASK_ID,
        attemptN: 1,
        sessionPath: '/tmp/session/0002.jsonl',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.runtimeSlotRepository.finish).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: TEAM_ID,
        taskId: TASK_ID,
        attemptN: 1,
        sessionPath: '/tmp/session/0002.jsonl',
      }),
    );
  });

  it('returns 409 when finish races with a newer task attempt on the slot', async () => {
    mocks.runtimeSlotRepository.finish.mockResolvedValue(null);

    const response = await app.inject({
      method: 'POST',
      url: '/runtime-slots/finish',
      headers: TEAM_HEADERS,
      payload: {
        agentName: 'legreffier',
        daemonProfileId: PROFILE_ID,
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        slotKey: 'freeform:correlation:test',
        taskId: TASK_ID,
        attemptN: 1,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 'CONFLICT',
      conflict: {
        target: {
          keys: { slotKey: 'freeform:correlation:test' },
          resource: 'runtime-slot',
        },
      },
    });
  });
});
