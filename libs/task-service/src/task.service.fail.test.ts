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

describe('createTaskService.fail', () => {
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

    const result = await service.fail(
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
