/* eslint-disable @typescript-eslint/unbound-method */
import { KetoNamespace, type PermissionChecker } from '@moltnet/auth';
import type { TaskRepository } from '@moltnet/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createTaskAnalyticsService,
  TaskAnalyticsServiceError,
} from './task-analytics.service.js';

const TEAM_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const AGENT_ID = '550e8400-e29b-41d4-a716-446655440000';
const PROFILE_ID = 'dddddddd-0000-0000-0000-000000000004';
const DIARY_ID = 'cccccccc-0000-0000-0000-000000000003';

describe('createTaskAnalyticsService', () => {
  let permissionChecker: PermissionChecker;
  let taskRepository: TaskRepository;

  beforeEach(() => {
    permissionChecker = {
      canAccessTeam: vi.fn().mockResolvedValue(true),
    } as unknown as PermissionChecker;
    taskRepository = {
      getTaskActivityAnalytics: vi.fn().mockResolvedValue({
        groups: [],
        overall: {
          abortedAttemptCount: 0,
          acceptedAttemptCount: 0,
          acceptedTaskCount: 0,
          attemptCount: 0,
          cancelledAttemptCount: 0,
          entryGetCount: 0,
          entrySearchCount: 0,
          extraAttemptCount: 0,
          extraTokensBeforeAcceptance: 0,
          failedAttemptCount: 0,
          failedToolCallCount: 0,
          firstAttemptAcceptedTaskCount: 0,
          highFrictionAttemptCount: 0,
          knowledgeToolCallCount: 0,
          medianTimeToAcceptedMs: null,
          medianToolCallsPerAttempt: null,
          medianTurnsPerAttempt: null,
          messageCount: 0,
          packGetCount: 0,
          retryAttemptCount: 0,
          retryRecoveredTaskCount: 0,
          taskCount: 0,
          terminalFailureTaskCount: 0,
          timeoutAttemptCount: 0,
          toolCallCount: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          turnCount: 0,
        },
        statsComplete: true,
      }),
      recomputeAttemptActivityStats: vi.fn(),
    } as unknown as TaskRepository;
  });

  it('checks team access before reading analytics', async () => {
    vi.mocked(permissionChecker.canAccessTeam).mockResolvedValue(false);
    const service = createTaskAnalyticsService({
      permissionChecker,
      taskRepository,
    });

    await expect(
      service.getActivityAnalytics({
        callerId: AGENT_ID,
        callerNs: KetoNamespace.Agent,
        completedAfter: '2026-04-01T00:00:00.000Z',
        completedBefore: '2026-05-01T00:00:00.000Z',
        teamId: TEAM_ID,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(taskRepository.getTaskActivityAnalytics).not.toHaveBeenCalled();
  });

  it('rejects inverted date ranges', async () => {
    const service = createTaskAnalyticsService({
      permissionChecker,
      taskRepository,
    });

    await expect(
      service.getActivityAnalytics({
        callerId: AGENT_ID,
        callerNs: KetoNamespace.Agent,
        completedAfter: '2026-05-01T00:00:00.000Z',
        completedBefore: '2026-04-01T00:00:00.000Z',
        teamId: TEAM_ID,
      }),
    ).rejects.toBeInstanceOf(TaskAnalyticsServiceError);
  });

  it('delegates analytics filters to the task repository', async () => {
    const service = createTaskAnalyticsService({
      permissionChecker,
      taskRepository,
    });

    await service.getActivityAnalytics({
      callerId: AGENT_ID,
      callerNs: KetoNamespace.Agent,
      claimedByAgentIds: [AGENT_ID],
      completedAfter: '2026-04-01T00:00:00.000Z',
      completedBefore: '2026-05-01T00:00:00.000Z',
      diaryIds: [DIARY_ID],
      groupBy: 'profile',
      profileIds: [PROFILE_ID],
      tags: ['observability'],
      taskTypes: ['fulfill_brief'],
      teamId: TEAM_ID,
    });

    expect(taskRepository.getTaskActivityAnalytics).toHaveBeenCalledWith({
      claimedByAgentIds: [AGENT_ID],
      completedAfter: new Date('2026-04-01T00:00:00.000Z'),
      completedBefore: new Date('2026-05-01T00:00:00.000Z'),
      diaryIds: [DIARY_ID],
      groupBy: 'profile',
      profileIds: [PROFILE_ID],
      tags: ['observability'],
      taskTypes: ['fulfill_brief'],
      teamId: TEAM_ID,
    });
  });

  it('delegates attempt stats recomputation', async () => {
    const service = createTaskAnalyticsService({
      permissionChecker,
      taskRepository,
    });

    await service.recomputeAttemptActivityStats('task-1', 2);

    expect(taskRepository.recomputeAttemptActivityStats).toHaveBeenCalledWith(
      'task-1',
      2,
    );
  });
});
