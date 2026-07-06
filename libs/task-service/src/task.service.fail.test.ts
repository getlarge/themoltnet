import { KetoNamespace } from '@moltnet/auth';
import { computeJsonCid } from '@moltnet/crypto-service';
import { DBOS, type Task as DbTask } from '@moltnet/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTaskService } from './task.service.js';

const TASK_ID = '11111111-1111-1111-1111-111111111111';
const TEAM_ID = '00000000-0000-0000-0000-000000000001';
const AGENT_ID = 'a0000000-0000-0000-0000-000000000001';

function makeTask(
  status: DbTask['status'],
  overrides: Partial<DbTask> = {},
): DbTask {
  const claimExpiresAt =
    status === 'running' ? new Date(Date.now() + 60_000) : null;
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
    claimExpiresAt,
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
    ...overrides,
  } as DbTask;
}

describe('createTaskService.failAttempt', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('waits on the workflow result event instead of polling until complete timeout', async () => {
    const output = {
      summary: 'done',
      artifacts: [{ kind: 'markdown', title: 'report', body: 'ok' }],
    };
    const outputCid = await computeJsonCid(output);
    const deps = {
      taskRepository: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(makeTask('running'))
          .mockResolvedValueOnce(
            makeTask('completed', {
              acceptedAttemptN: 1,
              completedAt: new Date('2026-06-01T00:01:00Z'),
            }),
          ),
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
    const getEvent = vi.spyOn(DBOS, 'getEvent').mockResolvedValue({
      status: 'completed',
      taskId: TASK_ID,
      attemptN: 1,
      output,
    });
    const service = createTaskService(deps as never);

    const result = await service.complete(
      TASK_ID,
      1,
      AGENT_ID,
      KetoNamespace.Agent,
      {
        output,
        outputCid,
        usage: { inputTokens: 1, outputTokens: 2 },
      },
    );

    expect(result.status).toBe('completed');
    expect(send).toHaveBeenCalledWith(
      `task:${TASK_ID}:attempt:1`,
      expect.objectContaining({ kind: 'completed', output, outputCid }),
      'progress',
    );
    expect(getEvent).toHaveBeenCalledWith(
      `task:${TASK_ID}:attempt:1`,
      'result',
      10,
    );
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
    const getEvent = vi.spyOn(DBOS, 'getEvent').mockResolvedValue({
      status: 'failed',
      taskId: TASK_ID,
      attemptN: 1,
    });
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
    expect(getEvent).toHaveBeenCalledWith(
      `task:${TASK_ID}:attempt:1`,
      'result',
      10,
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

  it('rejects append after the task claim lease expires', async () => {
    const deps = {
      taskRepository: {
        findById: vi.fn().mockResolvedValue(
          makeTask('running', {
            claimExpiresAt: new Date(Date.now() - 1_000),
          }),
        ),
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
      service.appendMessages(TASK_ID, 1, AGENT_ID, KetoNamespace.Agent, [
        { kind: 'info', payload: { event: 'started' } },
      ]),
    ).rejects.toMatchObject({
      code: 'conflict',
      message: 'Task claim lease has expired',
    });
    expect(deps.taskRepository.appendMessages).not.toHaveBeenCalled();
  });
});
