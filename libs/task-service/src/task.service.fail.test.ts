import { KetoNamespace } from '@moltnet/auth';
import { DBOS, type Task as DbTask } from '@moltnet/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTaskService } from './task.service.js';

const TASK_ID = '11111111-1111-1111-1111-111111111111';
const TEAM_ID = '00000000-0000-0000-0000-000000000001';
const AGENT_ID = 'a0000000-0000-0000-0000-000000000001';

function makeTask(status: DbTask['status']): DbTask {
  return {
    id: TASK_ID,
    taskType: 'freeform',
    title: null,
    tags: [],
    teamId: TEAM_ID,
    diaryId: null,
    outputKind: 'artifact',
    input: { prompt: 'test' },
    inputSchemaCid: 'bafy-schema',
    inputCid: 'bafy-input',
    taskRefs: [],
    correlationId: null,
    proposedByAgentId: AGENT_ID,
    proposedByHumanId: null,
    acceptedAttemptN: null,
    claimCondition: null,
    requiredExecutorTrustLevel: 'self_declared',
    allowedProfiles: [],
    status,
    claimAgentId: status === 'running' ? AGENT_ID : null,
    claimExpiresAt:
      status === 'running' ? new Date('2026-06-01T00:05:00Z') : null,
    queuedAt: new Date('2026-06-01T00:00:00Z'),
    completedAt: null,
    expiresAt: null,
    cancelledByAgentId: null,
    cancelledByHumanId: null,
    cancelReason: null,
    maxAttempts: 2,
    dispatchTimeoutSec: null,
    runningTimeoutSec: null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
  } as DbTask;
}

describe('createTaskService.failAttempt', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the queued task when a retryable attempt failure requeues', async () => {
    const error = {
      code: 'provider_timeout',
      message: 'provider timed out',
      retryable: true,
    };
    const deps = {
      taskRepository: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(makeTask('running'))
          .mockResolvedValueOnce(makeTask('queued')),
        findAttempt: vi.fn().mockResolvedValue({
          taskId: TASK_ID,
          attemptN: 1,
          claimedByAgentId: AGENT_ID,
          status: 'running',
        }),
      },
      permissionChecker: {
        canReportTask: vi.fn().mockResolvedValue(true),
      },
      logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    };
    const send = vi.spyOn(DBOS, 'send').mockResolvedValue(undefined);
    const service = createTaskService(deps as never);

    const result = await service.failAttempt(
      TASK_ID,
      1,
      AGENT_ID,
      KetoNamespace.Agent,
      error,
    );

    expect(result.status).toBe('queued');
    expect(send).toHaveBeenCalledWith(
      `task:${TASK_ID}:attempt:1`,
      { kind: 'failed', error },
      'progress',
    );
  });
});

describe('createTaskService.appendMessages', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('authorizes the active DB claimant even when Keto report is denied', async () => {
    const deps = {
      taskRepository: {
        findById: vi.fn().mockResolvedValue(makeTask('running')),
        findAttempt: vi.fn().mockResolvedValue({
          taskId: TASK_ID,
          attemptN: 1,
          claimedByAgentId: AGENT_ID,
          status: 'running',
        }),
        appendMessages: vi.fn().mockResolvedValue(undefined),
      },
      permissionChecker: {
        canReportTask: vi.fn().mockResolvedValue(false),
      },
      logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    };
    const service = createTaskService(deps as never);

    const result = await service.appendMessages(
      TASK_ID,
      1,
      AGENT_ID,
      KetoNamespace.Agent,
      [{ kind: 'info', payload: { event: 'started' } }],
    );

    expect(result).toEqual({ count: 1 });
    expect(deps.permissionChecker.canReportTask).not.toHaveBeenCalled();
    expect(deps.taskRepository.appendMessages).toHaveBeenCalledWith([
      expect.objectContaining({
        attemptN: 1,
        kind: 'info',
        payload: { event: 'started' },
        taskId: TASK_ID,
      }),
    ]);
  });

  it('rejects append from a non-current claimant', async () => {
    const deps = {
      taskRepository: {
        findById: vi.fn().mockResolvedValue(makeTask('running')),
        findAttempt: vi.fn().mockResolvedValue({
          taskId: TASK_ID,
          attemptN: 1,
          claimedByAgentId: AGENT_ID,
          status: 'running',
        }),
        appendMessages: vi.fn().mockResolvedValue(undefined),
      },
      permissionChecker: {
        canReportTask: vi.fn().mockResolvedValue(true),
      },
      logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    };
    const service = createTaskService(deps as never);

    await expect(
      service.appendMessages(
        TASK_ID,
        1,
        '00000000-0000-4000-8000-000000000099',
        KetoNamespace.Agent,
        [{ kind: 'info', payload: { event: 'started' } }],
      ),
    ).rejects.toMatchObject({
      code: 'forbidden',
      message: 'Only the active claiming agent may append messages',
    });
    expect(deps.taskRepository.appendMessages).not.toHaveBeenCalled();
  });
});
