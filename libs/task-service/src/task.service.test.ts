import { KetoNamespace } from '@moltnet/auth';
import { computeJsonCid } from '@moltnet/crypto-service';
import {
  DBOS,
  type Task as DbTask,
  type TaskAttempt as DbTaskAttempt,
  type TransactionRunner,
} from '@moltnet/database';
import { initTaskTypeRegistry } from '@moltnet/tasks';
import * as Format from 'typebox/format';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';

import { createTaskService } from './task.service.js';

const TEAM_ID = '00000000-0000-0000-0000-000000000001';
const DIARY_ID = 'd0000000-0000-0000-0000-000000000001';
const AGENT_ID = 'a0000000-0000-0000-0000-000000000001';
const RUN_TASK = '11111111-1111-1111-1111-111111111111';
const JUDGE_TASK = '22222222-2222-2222-2222-222222222222';
const CORRELATION = '99999999-9999-9999-9999-999999999999';
const PROFILE_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_TEAM_ID = '00000000-0000-0000-0000-000000000002';

function rubric() {
  return {
    version: 1 as const,
    rubric: {
      version: 'v1' as const,
      rubricId: 'r1',
      criteria: [
        {
          id: 'c1',
          description: 'first',
          weight: 0.6,
          scoring: 'llm_score' as const,
        },
        {
          id: 'c2',
          description: 'second',
          weight: 0.4,
          scoring: 'llm_score' as const,
        },
      ],
    },
  };
}

function runEvalInput() {
  return {
    scenario: { prompt: 'p' },
    variantLabel: 'baseline',
    execution: { mode: 'vitro' as const, workspace: 'none' as const },
    context: [],
    successCriteria: { version: 1 as const },
  };
}

function makeRunEvalTask(id: string): DbTask {
  return {
    id,
    taskType: 'run_eval',
    teamId: TEAM_ID,
    diaryId: null,
    outputKind: 'artifact',
    input: runEvalInput() as unknown as Record<string, unknown>,
    inputSchemaCid: 'bafy-schema',
    inputCid: 'bafy-input',
    taskRefs: [],
    correlationId: CORRELATION,
    proposedByAgentId: AGENT_ID,
    proposedByHumanId: null,
    acceptedAttemptN: 1,
    claimCondition: null,
    requiredExecutorTrustLevel: 'self_declared',
    status: 'completed',
    queuedAt: new Date('2026-05-11T00:00:00Z'),
    completedAt: new Date('2026-05-11T00:01:00Z'),
    expiresAt: null,
    cancelledByAgentId: null,
    cancelledByHumanId: null,
    cancelReason: null,
    maxAttempts: 1,
    dispatchTimeoutSec: null,
    runningTimeoutSec: null,
  } as unknown as DbTask;
}

function makeJudgeTask(
  id: string,
  status: DbTask['status'] = 'queued',
): DbTask {
  return {
    ...makeRunEvalTask(id),
    id,
    taskType: 'judge_eval_attempt',
    outputKind: 'judgment',
    input: {
      targetTaskId: RUN_TASK,
      targetAttemptN: 1,
      successCriteria: rubric(),
    },

    status,
    completedAt:
      status === 'completed' ? new Date('2026-05-11T00:02:00Z') : null,
    acceptedAttemptN: null,
    diaryId: DIARY_ID,
  } as unknown as DbTask;
}

type TaskRepositoryMocks = {
  findById: Mock<(id: string) => Promise<DbTask | null>>;
  findByIds: Mock<(ids: string[]) => Promise<DbTask[]>>;
  findByCorrelationId: Mock<(correlationId: string) => Promise<DbTask[]>>;
  acquireTaskCreateGuardLock: Mock<(lockKey: string) => Promise<void>>;
  findActiveTaskByInputMatch: Mock<
    (args: {
      taskType: string;
      inputMatches: ReadonlyArray<{
        path: readonly string[];
        value: string | number | boolean;
      }>;
      excludeTaskId?: string;
    }) => Promise<DbTask | null>
  >;
  updateMetadata: Mock<
    (
      id: string,
      metadata: { title?: string | null; tags?: string[] },
    ) => Promise<DbTask | null>
  >;
  create: Mock<(newTask: Record<string, unknown>) => Promise<DbTask>>;
  countAttempts: Mock<(taskId: string) => Promise<number>>;
  listWaitingTasks: Mock<() => Promise<DbTask[]>>;
  listWaitingTasksReferencingTask: Mock<(taskId: string) => Promise<DbTask[]>>;
  promoteWaitingTasks: Mock<(ids: string[]) => Promise<DbTask[]>>;
  findSealedTaskIds: Mock<(ids: string[]) => Promise<string[]>>;
  deleteCorrelationSealsForTasks: Mock<(ids: string[]) => Promise<void>>;
  deleteMany: Mock<(ids: string[]) => Promise<string[]>>;
  deleteManyIfStatusIn: Mock<
    (ids: string[], statuses: readonly DbTask['status'][]) => Promise<string[]>
  >;
  expireIfStillNonTerminal: Mock<(id: string) => Promise<DbTask | null>>;
  updateStatus: Mock<
    (
      id: string,
      status: string,
      fields: { cancelReason?: string },
    ) => Promise<DbTask | null>
  >;
  claimIfQueued: Mock<(taskId: string) => Promise<DbTask | null>>;
  tryAcquireContinuationLock: Mock<
    (taskId: string, attemptN: number) => Promise<boolean>
  >;
  findAttemptWithManifests: Mock<
    (taskId: string, attemptN: number) => Promise<DbTaskAttempt | null>
  >;
  upsertExecutorManifestVerification: Mock<
    (input: Record<string, unknown>) => Promise<void>
  >;
};

type CorrelationSealRepositoryMocks = {
  acquireCorrelationLock: Mock<(correlationId: string) => Promise<void>>;
  findByCorrelationId: Mock<
    (correlationId: string) => Promise<{ sealedByTaskId: string } | null>
  >;
  create: Mock<(input: Record<string, unknown>) => Promise<void>>;
  deleteBySealingTaskId: Mock<(taskId: string) => Promise<null>>;
};

type PermissionCheckerMocks = {
  canAccessTeam: Mock<
    (teamId: string, callerId: string, callerNs: string) => Promise<boolean>
  >;
  canProposeTask: Mock<
    (diaryId: string, callerId: string, callerNs: string) => Promise<boolean>
  >;
  canViewTask: Mock<
    (taskId: string, callerId: string, callerNs: string) => Promise<boolean>
  >;
  canEditTaskMetadata: Mock<
    (taskId: string, callerId: string, callerNs: string) => Promise<boolean>
  >;
  canClaimTask: Mock<
    (taskId: string, callerId: string, callerNs: string) => Promise<boolean>
  >;
  canViewTasks: Mock<
    (
      taskIds: string[],
      callerId: string,
      callerNs: string,
    ) => Promise<Map<string, boolean>>
  >;
  canDeleteTasks: Mock<
    (
      taskIds: string[],
      callerId: string,
      callerNs: string,
    ) => Promise<Map<string, boolean>>
  >;
  canForceDeleteTasks: Mock<
    (
      taskIds: string[],
      callerId: string,
      callerNs: string,
    ) => Promise<Map<string, boolean>>
  >;
  canReadPack: Mock<
    (packId: string, callerId: string, callerNs: string) => Promise<boolean>
  >;
};

type RelationshipWriterMocks = {
  grantTaskParent: Mock<(taskId: string, diaryId: string) => Promise<void>>;
  grantTaskClaimant: Mock<(taskId: string, agentId: string) => Promise<void>>;
  removeTaskRelationsBatch: Mock<
    (
      tasks: Array<{
        id: string;
        diaryId: string | null;
        claimAgentId?: string | null;
      }>,
    ) => Promise<void>
  >;
};

interface Mocks {
  taskRepository: TaskRepositoryMocks;
  diaryRepository: {
    findById: Mock<(id: string) => Promise<{ id: string; teamId: string }>>;
  };
  agentRepository: {
    findByIdentityId: Mock<
      (identityId: string) => Promise<{ identityId: string }>
    >;
  };
  runtimeProfileRepository: {
    findById: Mock<
      (id: string) => Promise<{ id: string; teamId: string } | null>
    >;
  };
  contextPackRepository: {
    findById: Mock<(id: string) => Promise<null>>;
  };
  renderedPackRepository: {
    findById: Mock<(id: string) => Promise<null>>;
  };
  correlationSealRepository: CorrelationSealRepositoryMocks;
  permissionChecker: PermissionCheckerMocks;
  relationshipWriter: RelationshipWriterMocks;
  transactionRunner: TransactionRunner;
  enqueueWorkflowInCurrentTransaction: Mock<
    (
      input: Parameters<
        Parameters<
          typeof createTaskService
        >[0]['enqueueWorkflowInCurrentTransaction']
      >[0],
    ) => Promise<{ workflowId: string }>
  >;
  logger: {
    info: Mock<(obj: object, msg: string) => void>;
    debug: Mock<(obj: object, msg: string) => void>;
    warn: Mock<(obj: object, msg: string) => void>;
    error: Mock<(obj: object, msg: string) => void>;
  };
}

function makeMocks(
  opts: {
    visibleTasks?: Record<string, DbTask>;
    grantThrows?: boolean;
  } = {},
): Mocks {
  const insertedTasks: DbTask[] = [];

  const taskRepository: TaskRepositoryMocks = {
    findById: vi
      .fn<(id: string) => Promise<DbTask | null>>()
      .mockImplementation((id) =>
        Promise.resolve(opts.visibleTasks?.[id] ?? null),
      ),
    findByIds: vi
      .fn<(ids: string[]) => Promise<DbTask[]>>()
      .mockImplementation((ids) =>
        Promise.resolve(
          ids
            .map((id) => opts.visibleTasks?.[id])
            .filter((task): task is DbTask => task !== undefined),
        ),
      ),
    findByCorrelationId: vi
      .fn<(correlationId: string) => Promise<DbTask[]>>()
      .mockImplementation((cid) =>
        Promise.resolve(
          Object.values(opts.visibleTasks ?? {}).filter(
            (task) => task.correlationId === cid,
          ),
        ),
      ),
    acquireTaskCreateGuardLock: vi
      .fn<(lockKey: string) => Promise<void>>()
      .mockResolvedValue(undefined),
    findActiveTaskByInputMatch: vi
      .fn<
        (args: {
          taskType: string;
          inputMatches: ReadonlyArray<{
            path: readonly string[];
            value: string | number | boolean;
          }>;
          excludeTaskId?: string;
        }) => Promise<DbTask | null>
      >()
      .mockResolvedValue(null),
    updateMetadata: vi
      .fn<
        (
          id: string,
          metadata: { title?: string | null; tags?: string[] },
        ) => Promise<DbTask | null>
      >()
      .mockImplementation((id, metadata) => {
        const row = opts.visibleTasks?.[id];
        return Promise.resolve(
          row ? ({ ...row, ...metadata } as DbTask) : null,
        );
      }),
    create: vi
      .fn<(newTask: Record<string, unknown>) => Promise<DbTask>>()
      .mockImplementation((newTask) => {
        const row = makeJudgeTask(
          `j${insertedTasks.length}-0000-0000-0000-000000000000`,
        );
        const merged: DbTask = {
          ...row,
          ...newTask,
          id: row.id,
        } as DbTask;
        insertedTasks.push(merged);
        return Promise.resolve(merged);
      }),
    countAttempts: vi
      .fn<(taskId: string) => Promise<number>>()
      .mockResolvedValue(0),
    listWaitingTasks: vi.fn<() => Promise<DbTask[]>>().mockResolvedValue([]),
    listWaitingTasksReferencingTask: vi
      .fn<(taskId: string) => Promise<DbTask[]>>()
      .mockResolvedValue([]),
    promoteWaitingTasks: vi
      .fn<(ids: string[]) => Promise<DbTask[]>>()
      .mockResolvedValue([]),
    findSealedTaskIds: vi
      .fn<(ids: string[]) => Promise<string[]>>()
      .mockResolvedValue([]),
    deleteCorrelationSealsForTasks: vi
      .fn<(ids: string[]) => Promise<void>>()
      .mockResolvedValue(undefined),
    deleteMany: vi
      .fn<(ids: string[]) => Promise<string[]>>()
      .mockImplementation((ids) => Promise.resolve(ids)),
    deleteManyIfStatusIn: vi
      .fn<
        (
          ids: string[],
          statuses: readonly DbTask['status'][],
        ) => Promise<string[]>
      >()
      .mockImplementation((ids) => Promise.resolve(ids)),
    expireIfStillNonTerminal: vi
      .fn<(id: string) => Promise<DbTask | null>>()
      .mockImplementation((id) => {
        const task = opts.visibleTasks?.[id];
        if (!task || (task.status !== 'waiting' && task.status !== 'queued')) {
          return Promise.resolve(null);
        }
        const expired = {
          ...task,
          status: 'expired',
          completedAt: new Date(),
        } as DbTask;
        if (opts.visibleTasks) {
          opts.visibleTasks[id] = expired;
        }
        return Promise.resolve(expired);
      }),
    updateStatus: vi
      .fn<
        (
          id: string,
          status: string,
          fields: { cancelReason?: string },
        ) => Promise<DbTask | null>
      >()
      .mockImplementation((id, status, fields) => {
        const task = insertedTasks.find((row) => row.id === id);
        if (task) {
          task.status = status as DbTask['status'];
          task.cancelReason = fields.cancelReason ?? null;
        }
        return Promise.resolve(task ?? null);
      }),
    claimIfQueued: vi
      .fn<(taskId: string) => Promise<DbTask | null>>()
      .mockImplementation((id) =>
        Promise.resolve(opts.visibleTasks?.[id] ?? null),
      ),
    tryAcquireContinuationLock: vi
      .fn<(taskId: string, attemptN: number) => Promise<boolean>>()
      .mockResolvedValue(true),
    findAttemptWithManifests: vi
      .fn<(taskId: string, attemptN: number) => Promise<DbTaskAttempt | null>>()
      .mockImplementation((taskId, attemptN) =>
        Promise.resolve({
          taskId,
          attemptN,
          claimedByAgentId: AGENT_ID,
          runtimeId: null,
          workflowId: `task:${taskId}:attempt:${attemptN}`,
          claimedAt: new Date('2026-05-11T00:00:00Z'),
          startedAt: null,
          completedAt: null,
          status: 'claimed',
          output: null,
          outputCid: null,
          claimedExecutorFingerprint: null,
          completedExecutorFingerprint: null,
          error: null,
          usage: null,
          contentSignature: null,
          signedAt: null,
          daemonState: null,
        } as DbTaskAttempt),
      ),
    upsertExecutorManifestVerification: vi
      .fn<(input: Record<string, unknown>) => Promise<void>>()
      .mockResolvedValue(undefined),
  };

  const transactionRunner: TransactionRunner = {
    async runInTransaction(fn) {
      return fn();
    },
  };

  return {
    taskRepository,
    diaryRepository: {
      findById: vi
        .fn<(id: string) => Promise<{ id: string; teamId: string }>>()
        .mockResolvedValue({ id: DIARY_ID, teamId: TEAM_ID }),
    },
    agentRepository: {
      findByIdentityId: vi
        .fn<(identityId: string) => Promise<{ identityId: string }>>()
        .mockResolvedValue({ identityId: AGENT_ID }),
    },
    runtimeProfileRepository: {
      findById: vi
        .fn<(id: string) => Promise<{ id: string; teamId: string } | null>>()
        .mockResolvedValue({ id: PROFILE_ID, teamId: TEAM_ID }),
    },
    contextPackRepository: {
      findById: vi.fn<(id: string) => Promise<null>>().mockResolvedValue(null),
    },
    renderedPackRepository: {
      findById: vi.fn<(id: string) => Promise<null>>().mockResolvedValue(null),
    },
    correlationSealRepository: {
      acquireCorrelationLock: vi
        .fn<(correlationId: string) => Promise<void>>()
        .mockResolvedValue(undefined),
      findByCorrelationId: vi
        .fn<
          (correlationId: string) => Promise<{ sealedByTaskId: string } | null>
        >()
        .mockResolvedValue(null),
      create: vi
        .fn<(input: Record<string, unknown>) => Promise<void>>()
        .mockResolvedValue(undefined),
      deleteBySealingTaskId: vi
        .fn<(taskId: string) => Promise<null>>()
        .mockResolvedValue(null),
    },
    permissionChecker: {
      canAccessTeam: vi
        .fn<
          (
            teamId: string,
            callerId: string,
            callerNs: string,
          ) => Promise<boolean>
        >()
        .mockResolvedValue(true),
      canProposeTask: vi
        .fn<
          (
            diaryId: string,
            callerId: string,
            callerNs: string,
          ) => Promise<boolean>
        >()
        .mockResolvedValue(true),
      canViewTask: vi
        .fn<
          (
            taskId: string,
            callerId: string,
            callerNs: string,
          ) => Promise<boolean>
        >()
        .mockImplementation((taskId) =>
          Promise.resolve(Boolean(opts.visibleTasks?.[taskId])),
        ),
      canEditTaskMetadata: vi
        .fn<
          (
            taskId: string,
            callerId: string,
            callerNs: string,
          ) => Promise<boolean>
        >()
        .mockResolvedValue(true),
      canClaimTask: vi
        .fn<
          (
            taskId: string,
            callerId: string,
            callerNs: string,
          ) => Promise<boolean>
        >()
        .mockResolvedValue(true),
      canViewTasks: vi
        .fn<
          (
            taskIds: string[],
            callerId: string,
            callerNs: string,
          ) => Promise<Map<string, boolean>>
        >()
        .mockImplementation((taskIds) =>
          Promise.resolve(
            new Map(
              taskIds.map((taskId) => [
                taskId,
                Boolean(opts.visibleTasks?.[taskId]),
              ]),
            ),
          ),
        ),
      canDeleteTasks: vi
        .fn<
          (
            taskIds: string[],
            callerId: string,
            callerNs: string,
          ) => Promise<Map<string, boolean>>
        >()
        .mockImplementation((taskIds) =>
          Promise.resolve(
            new Map(
              taskIds.map((taskId) => [
                taskId,
                Boolean(opts.visibleTasks?.[taskId]),
              ]),
            ),
          ),
        ),
      canForceDeleteTasks: vi
        .fn<
          (
            taskIds: string[],
            callerId: string,
            callerNs: string,
          ) => Promise<Map<string, boolean>>
        >()
        .mockImplementation((taskIds) =>
          Promise.resolve(
            new Map(
              taskIds.map((taskId) => [
                taskId,
                Boolean(opts.visibleTasks?.[taskId]),
              ]),
            ),
          ),
        ),
      canReadPack: vi
        .fn<
          (
            packId: string,
            callerId: string,
            callerNs: string,
          ) => Promise<boolean>
        >()
        .mockResolvedValue(true),
    },
    relationshipWriter: {
      grantTaskParent: vi
        .fn<(taskId: string, diaryId: string) => Promise<void>>()
        .mockImplementation(() =>
          opts.grantThrows
            ? Promise.reject(new Error('keto down'))
            : Promise.resolve(),
        ),
      grantTaskClaimant: vi
        .fn<(taskId: string, agentId: string) => Promise<void>>()
        .mockResolvedValue(undefined),
      removeTaskRelationsBatch: vi.fn().mockResolvedValue(undefined),
    },
    transactionRunner,
    enqueueWorkflowInCurrentTransaction: vi.fn().mockResolvedValue({
      workflowId: `task:${JUDGE_TASK}:attempt:1`,
    }),
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

function judgeCreateInput() {
  return {
    taskType: 'judge_eval_attempt',
    teamId: TEAM_ID,
    diaryId: DIARY_ID,
    correlationId: CORRELATION,
    inputPayload: {
      targetTaskId: RUN_TASK,
      targetAttemptN: 1,
      successCriteria: rubric(),
    },
    callerId: AGENT_ID,
    callerNs: 'agent' as const,
    callerIsAgent: true,
  };
}

function fulfillCreateInput() {
  return {
    taskType: 'fulfill_brief',
    title: 'Feature work',
    tags: ['observability', 'cohort', 'observability'],
    teamId: TEAM_ID,
    diaryId: DIARY_ID,
    inputPayload: {
      brief: 'Implement the feature.',
    },
    callerId: AGENT_ID,
    callerNs: 'agent' as const,
    callerIsAgent: true,
  };
}

beforeAll(async () => {
  Format.Set('uuid', (v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  );
  await initTaskTypeRegistry();
});

describe('createTaskService', () => {
  it('requires transactional workflow enqueue wiring', () => {
    const deps = makeMocks() as unknown as Record<string, unknown>;
    delete deps.enqueueWorkflowInCurrentTransaction;

    expect(() => createTaskService(deps as never)).toThrow(
      'createTaskService requires enqueueWorkflowInCurrentTransaction to preserve transactional task claim enqueue semantics',
    );
  });
});

describe('createTaskService.claim — runtime profile attestation', () => {
  let mocks: Mocks;
  let service: ReturnType<typeof createTaskService>;

  beforeEach(() => {
    mocks = makeMocks({
      visibleTasks: {
        [JUDGE_TASK]: makeJudgeTask(JUDGE_TASK, 'queued'),
      },
    });
    service = createTaskService(
      mocks as unknown as Parameters<typeof createTaskService>[0],
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects profile IDs that do not resolve in the task team even when the task is unrestricted', async () => {
    mocks.runtimeProfileRepository.findById.mockResolvedValue({
      id: PROFILE_ID,
      teamId: OTHER_TEAM_ID,
    });

    await expect(
      service.claim(JUDGE_TASK, AGENT_ID, KetoNamespace.Agent, 30, {
        profileId: PROFILE_ID,
      }),
    ).rejects.toMatchObject({
      code: 'forbidden',
      message: 'Runtime profile does not resolve in the task team',
    });

    expect(mocks.runtimeProfileRepository.findById).toHaveBeenCalledWith(
      PROFILE_ID,
    );
    expect(mocks.taskRepository.claimIfQueued).not.toHaveBeenCalled();
  });

  it('rejects unknown profile IDs before claiming an unrestricted task', async () => {
    mocks.runtimeProfileRepository.findById.mockResolvedValue(null);

    await expect(
      service.claim(JUDGE_TASK, AGENT_ID, KetoNamespace.Agent, 30, {
        profileId: PROFILE_ID,
      }),
    ).rejects.toMatchObject({
      code: 'forbidden',
      message: 'Runtime profile does not resolve in the task team',
    });

    expect(mocks.taskRepository.claimIfQueued).not.toHaveBeenCalled();
  });

  it('expires an elapsed queued task before claiming it', async () => {
    const expiredQueued = {
      ...makeJudgeTask(JUDGE_TASK, 'queued'),
      expiresAt: new Date('2020-01-01T00:00:00Z'),
    };
    mocks = makeMocks({
      visibleTasks: {
        [JUDGE_TASK]: expiredQueued,
      },
    });
    service = createTaskService(
      mocks as unknown as Parameters<typeof createTaskService>[0],
    );

    await expect(
      service.claim(JUDGE_TASK, AGENT_ID, KetoNamespace.Agent),
    ).rejects.toMatchObject({
      code: 'conflict',
      message: 'Task is already in terminal state: expired',
    });

    expect(mocks.taskRepository.expireIfStillNonTerminal).toHaveBeenCalledWith(
      JUDGE_TASK,
    );
    expect(mocks.taskRepository.claimIfQueued).not.toHaveBeenCalled();
  });

  it('enqueues the attempt workflow inside the claim transaction', async () => {
    const events: string[] = [];
    const enqueueWorkflowInCurrentTransaction = vi.fn(() => {
      events.push('enqueue');
      return Promise.resolve({ workflowId: `task:${JUDGE_TASK}:attempt:1` });
    });
    mocks.transactionRunner = {
      async runInTransaction(fn) {
        events.push('tx:start');
        const result = await fn();
        events.push('tx:end');
        return result;
      },
    };
    const startWorkflow = vi.spyOn(DBOS, 'startWorkflow');
    const getEvent = vi
      .spyOn(DBOS, 'getEvent')
      .mockResolvedValue({ taskId: JUDGE_TASK, attemptN: 1 });
    service = createTaskService({
      ...(mocks as unknown as Parameters<typeof createTaskService>[0]),
      enqueueWorkflowInCurrentTransaction,
    });

    await service.claim(JUDGE_TASK, AGENT_ID, KetoNamespace.Agent, 30);

    expect(events).toEqual(['tx:start', 'enqueue', 'tx:end']);
    expect(enqueueWorkflowInCurrentTransaction).toHaveBeenCalledTimes(1);
    expect(startWorkflow).not.toHaveBeenCalled();
    expect(getEvent).toHaveBeenCalledWith(
      `task:${JUDGE_TASK}:attempt:1`,
      'claimed',
      10,
    );
    expect(mocks.relationshipWriter.grantTaskClaimant).toHaveBeenCalledWith(
      JUDGE_TASK,
      AGENT_ID,
    );
  });

  it('does not wait or grant when transactional enqueue fails', async () => {
    const events: string[] = [];
    const enqueueError = new Error('duplicate workflow id');
    const enqueueWorkflowInCurrentTransaction = vi.fn(() => {
      events.push('enqueue');
      return Promise.reject(enqueueError);
    });
    mocks.transactionRunner = {
      async runInTransaction(fn) {
        events.push('tx:start');
        try {
          return await fn();
        } catch (error) {
          events.push('tx:rollback');
          throw error;
        }
      },
    };
    const getEvent = vi.spyOn(DBOS, 'getEvent');
    const startWorkflow = vi.spyOn(DBOS, 'startWorkflow');
    service = createTaskService({
      ...(mocks as unknown as Parameters<typeof createTaskService>[0]),
      enqueueWorkflowInCurrentTransaction,
    });

    await expect(
      service.claim(JUDGE_TASK, AGENT_ID, KetoNamespace.Agent, 30),
    ).rejects.toThrow(enqueueError);

    expect(events).toEqual(['tx:start', 'enqueue', 'tx:rollback']);
    expect(startWorkflow).not.toHaveBeenCalled();
    expect(getEvent).not.toHaveBeenCalled();
    expect(mocks.relationshipWriter.grantTaskClaimant).not.toHaveBeenCalled();
  });

  it('expires an elapsed waiting task before promoting it during claim', async () => {
    const expiredWaiting = {
      ...makeJudgeTask(JUDGE_TASK, 'waiting'),
      claimCondition: { op: 'task_accepted' as const, taskId: RUN_TASK },
      expiresAt: new Date('2020-01-01T00:00:00Z'),
    };
    mocks = makeMocks({
      visibleTasks: {
        [RUN_TASK]: makeRunEvalTask(RUN_TASK),
        [JUDGE_TASK]: expiredWaiting,
      },
    });
    service = createTaskService(
      mocks as unknown as Parameters<typeof createTaskService>[0],
    );

    await expect(
      service.claim(JUDGE_TASK, AGENT_ID, KetoNamespace.Agent),
    ).rejects.toMatchObject({
      code: 'conflict',
      message: 'Task is already in terminal state: expired',
    });

    expect(mocks.taskRepository.expireIfStillNonTerminal).toHaveBeenCalledWith(
      JUDGE_TASK,
    );
    expect(mocks.taskRepository.promoteWaitingTasks).not.toHaveBeenCalled();
    expect(mocks.taskRepository.claimIfQueued).not.toHaveBeenCalled();
  });
});

describe('createTaskService.create — judge_eval_attempt flow', () => {
  let mocks: Mocks;
  let service: ReturnType<typeof createTaskService>;

  beforeEach(() => {
    mocks = makeMocks({
      visibleTasks: {
        [RUN_TASK]: makeRunEvalTask(RUN_TASK),
      },
    });
    service = createTaskService(
      mocks as unknown as Parameters<typeof createTaskService>[0],
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates one judge task without touching correlation seals', async () => {
    const task = await service.create(judgeCreateInput() as never);

    expect(task.taskType).toBe('judge_eval_attempt');
    expect(task.correlationId).toBe(CORRELATION);
    expect(mocks.taskRepository.create).toHaveBeenCalledOnce();
    expect(
      mocks.correlationSealRepository.acquireCorrelationLock,
    ).not.toHaveBeenCalled();
    expect(mocks.correlationSealRepository.create).not.toHaveBeenCalled();
    expect(mocks.relationshipWriter.grantTaskParent).toHaveBeenCalledOnce();
  });

  it('rejects a duplicate judge for the same target attempt and rubric identity', async () => {
    mocks = makeMocks({
      visibleTasks: {
        [RUN_TASK]: makeRunEvalTask(RUN_TASK),
        [JUDGE_TASK]: makeJudgeTask(JUDGE_TASK),
      },
    });
    service = createTaskService(
      mocks as unknown as Parameters<typeof createTaskService>[0],
    );

    await expect(
      service.create(judgeCreateInput() as never),
    ).rejects.toMatchObject({
      name: 'TaskServiceError',
      code: 'invalid',
    });
    expect(mocks.taskRepository.create).not.toHaveBeenCalled();
  });

  it('rejects a concurrent duplicate that only appears during the transactional re-check', async () => {
    mocks = makeMocks({
      visibleTasks: {
        [RUN_TASK]: makeRunEvalTask(RUN_TASK),
      },
    });
    mocks.taskRepository.findActiveTaskByInputMatch.mockResolvedValue(
      makeJudgeTask(JUDGE_TASK),
    );
    service = createTaskService(
      mocks as unknown as Parameters<typeof createTaskService>[0],
    );

    await expect(
      service.create(judgeCreateInput() as never),
    ).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(mocks.taskRepository.create).toHaveBeenCalledOnce();
    expect(
      mocks.taskRepository.acquireTaskCreateGuardLock,
    ).toHaveBeenCalledOnce();
  });

  it('rejects when caller cannot view the producer task', async () => {
    mocks = makeMocks({ visibleTasks: {} });
    service = createTaskService(
      mocks as unknown as Parameters<typeof createTaskService>[0],
    );

    await expect(
      service.create(judgeCreateInput() as never),
    ).rejects.toMatchObject({
      code: 'invalid',
    });
    expect(mocks.taskRepository.create).not.toHaveBeenCalled();
  });

  it('cancels the task if the ownership grant fails after insert', async () => {
    mocks = makeMocks({
      visibleTasks: {
        [RUN_TASK]: makeRunEvalTask(RUN_TASK),
      },
      grantThrows: true,
    });
    service = createTaskService(
      mocks as unknown as Parameters<typeof createTaskService>[0],
    );

    await expect(
      service.create(judgeCreateInput() as never),
    ).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(
      mocks.correlationSealRepository.deleteBySealingTaskId,
    ).toHaveBeenCalledOnce();
    expect(mocks.taskRepository.updateStatus).toHaveBeenCalledWith(
      expect.any(String),
      'cancelled',
      // Vitest's matcher helpers are typed loosely here.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expect.objectContaining({ cancelReason: expect.stringMatching(/Keto/) }),
    );
  });
});

describe('createTaskService.create — producer input normalization', () => {
  let mocks: Mocks;
  let service: ReturnType<typeof createTaskService>;

  beforeEach(() => {
    mocks = makeMocks();
    service = createTaskService(
      mocks as unknown as Parameters<typeof createTaskService>[0],
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores normalized producer input and hashes the normalized promise body', async () => {
    await service.create(fulfillCreateInput() as never);

    expect(mocks.taskRepository.create).toHaveBeenCalledOnce();
    const newTask = mocks.taskRepository.create.mock.calls[0][0] as {
      title: string | null;
      tags: string[];
      input: Record<string, unknown>;
      inputCid: string;
    };
    expect(newTask.title).toBe('Feature work');
    expect(newTask.tags).toEqual(['observability', 'cohort']);
    expect(newTask.input).toMatchObject({
      brief: 'Implement the feature.',
      successCriteria: {
        version: 1,
        gates: [
          expect.objectContaining({
            id: 'submit-output',
            kind: 'submit-tool-call',
            required: true,
          }),
        ],
      },
    });
    expect(newTask.inputCid).toBe(await computeJsonCid(newTask.input));
  });

  it('writes proposerId (humans.id) to proposedByHumanId for human callers', async () => {
    const HUMAN_IDENTITY = 'b0000000-0000-0000-0000-000000000010';
    const HUMAN_ROW_ID = 'c0000000-0000-0000-0000-000000000020';

    await service.create({
      ...fulfillCreateInput(),
      callerId: HUMAN_IDENTITY,
      callerNs: 'human' as const,
      callerIsAgent: false,
      proposerId: HUMAN_ROW_ID,
    } as never);

    const newTask = mocks.taskRepository.create.mock.calls[0][0] as {
      proposedByAgentId: string | null;
      proposedByHumanId: string | null;
    };
    expect(newTask.proposedByHumanId).toBe(HUMAN_ROW_ID);
    expect(newTask.proposedByAgentId).toBeNull();
  });

  it('falls back to callerId when proposerId is omitted (agent path)', async () => {
    await service.create(fulfillCreateInput() as never);

    const newTask = mocks.taskRepository.create.mock.calls[0][0] as {
      proposedByAgentId: string | null;
      proposedByHumanId: string | null;
    };
    expect(newTask.proposedByAgentId).toBe(AGENT_ID);
    expect(newTask.proposedByHumanId).toBeNull();
  });

  it('applies the configured default task lifetime when expiresInSec is omitted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-30T12:00:00Z'));
    try {
      service = createTaskService({
        ...(mocks as unknown as Parameters<typeof createTaskService>[0]),
        taskLifetime: {
          defaultExpiresInSec: 3600,
          maxExpiresInSec: 7200,
        },
      });

      await service.create(fulfillCreateInput() as never);

      const newTask = mocks.taskRepository.create.mock.calls[0][0] as {
        expiresAt: Date | null;
      };
      expect(newTask.expiresAt?.toISOString()).toBe('2026-06-30T13:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects caller-requested task lifetimes above the configured cap', async () => {
    service = createTaskService({
      ...(mocks as unknown as Parameters<typeof createTaskService>[0]),
      taskLifetime: {
        defaultExpiresInSec: 3600,
        maxExpiresInSec: 7200,
      },
    });

    await expect(
      service.create({
        ...fulfillCreateInput(),
        expiresInSec: 7201,
      } as never),
    ).rejects.toMatchObject({
      code: 'invalid',
      validationErrors: [
        {
          field: 'expiresInSec',
          message: 'expiresInSec must be <= 7200',
        },
      ],
    });
    expect(mocks.taskRepository.create).not.toHaveBeenCalled();
  });
});

describe('createTaskService.updateMetadata', () => {
  it('normalizes mutable task metadata without touching input', async () => {
    const task = makeRunEvalTask(RUN_TASK);
    const mocks = makeMocks({ visibleTasks: { [RUN_TASK]: task } });
    const service = createTaskService(
      mocks as unknown as Parameters<typeof createTaskService>[0],
    );

    const updated = await service.updateMetadata(RUN_TASK, {
      title: '  Cohort probe  ',
      tags: ['observability', ' cohort ', 'observability', ''],
      callerId: AGENT_ID,
      callerNs: KetoNamespace.Agent,
    });

    expect(mocks.permissionChecker.canEditTaskMetadata).toHaveBeenCalledWith(
      RUN_TASK,
      AGENT_ID,
      KetoNamespace.Agent,
    );
    expect(mocks.taskRepository.updateMetadata).toHaveBeenCalledWith(RUN_TASK, {
      title: 'Cohort probe',
      tags: ['observability', 'cohort'],
    });
    expect(updated.input).toEqual(task.input);
  });
});

describe('createTaskService.create — conditional claimability', () => {
  let mocks: Mocks;
  let service: ReturnType<typeof createTaskService>;

  beforeEach(() => {
    mocks = makeMocks({
      visibleTasks: {
        [RUN_TASK]: makeRunEvalTask(RUN_TASK),
      },
    });
    service = createTaskService(
      mocks as unknown as Parameters<typeof createTaskService>[0],
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates waiting task when claim condition is not yet satisfied', async () => {
    const pendingRun = {
      ...makeRunEvalTask(RUN_TASK),
      acceptedAttemptN: null,
      status: 'running' as const,
    };
    mocks = makeMocks({
      visibleTasks: {
        [RUN_TASK]: pendingRun,
      },
    });
    service = createTaskService(
      mocks as unknown as Parameters<typeof createTaskService>[0],
    );

    const task = await service.create({
      ...judgeCreateInput(),
      claimCondition: { op: 'task_accepted', taskId: RUN_TASK },
    } as never);

    expect(task.status).toBe('waiting');
    const newTask = mocks.taskRepository.create.mock.calls[0][0] as {
      status: string;
      claimCondition: unknown;
    };
    expect(newTask.status).toBe('waiting');
    expect(newTask.claimCondition).toEqual({
      op: 'task_accepted',
      taskId: RUN_TASK,
    });
    expect(mocks.permissionChecker.canViewTasks).toHaveBeenCalledWith(
      [RUN_TASK],
      AGENT_ID,
      'agent',
    );
  });

  it('creates queued task when claim condition is already satisfied', async () => {
    const task = await service.create({
      ...judgeCreateInput(),
      claimCondition: { op: 'task_accepted', taskId: RUN_TASK },
    } as never);

    expect(task.status).toBe('queued');
    expect(mocks.taskRepository.create.mock.calls[0][0]).toMatchObject({
      status: 'queued',
    });
  });

  it('rejects unreadable condition references with one batched auth check', async () => {
    const hiddenTaskId = '33333333-3333-3333-8333-333333333333';

    await expect(
      service.create({
        ...judgeCreateInput(),
        claimCondition: { op: 'task_accepted', taskId: hiddenTaskId },
      } as never),
    ).rejects.toMatchObject({
      code: 'invalid',
    });

    expect(mocks.permissionChecker.canViewTasks).toHaveBeenCalledWith(
      [hiddenTaskId],
      AGENT_ID,
      'agent',
    );
    expect(mocks.taskRepository.create).not.toHaveBeenCalled();
  });

  it('promotes only waiting tasks that reference the changed task', async () => {
    const waitingJudge = {
      ...makeJudgeTask(JUDGE_TASK, 'waiting'),
      claimCondition: { op: 'task_accepted' as const, taskId: RUN_TASK },
    };
    mocks.taskRepository.listWaitingTasksReferencingTask.mockResolvedValue([
      waitingJudge,
    ]);
    mocks.taskRepository.promoteWaitingTasks.mockResolvedValue([
      { ...waitingJudge, status: 'queued' },
    ]);

    const promoted = await service.promoteSatisfiedWaitingTasks({
      triggerTaskId: RUN_TASK,
    });

    expect(
      mocks.taskRepository.listWaitingTasksReferencingTask,
    ).toHaveBeenCalledWith(RUN_TASK);
    expect(mocks.taskRepository.listWaitingTasks).not.toHaveBeenCalled();
    expect(mocks.taskRepository.promoteWaitingTasks).toHaveBeenCalledWith([
      JUDGE_TASK,
    ]);
    expect(promoted).toHaveLength(1);
  });

  it('evaluates promotion before opening the short update transaction', async () => {
    const events: string[] = [];
    mocks.transactionRunner = {
      async runInTransaction(fn) {
        events.push('tx');
        return fn();
      },
    };
    const waitingJudge = {
      ...makeJudgeTask(JUDGE_TASK, 'waiting'),
      claimCondition: { op: 'task_accepted' as const, taskId: RUN_TASK },
    };
    mocks.taskRepository.listWaitingTasksReferencingTask.mockImplementation(
      () => {
        events.push('list');
        return Promise.resolve([waitingJudge]);
      },
    );
    mocks.taskRepository.findByIds.mockImplementation(() => {
      events.push('load-refs');
      return Promise.resolve([makeRunEvalTask(RUN_TASK)]);
    });
    mocks.permissionChecker.canViewTask.mockImplementation(() => {
      events.push('validate-keto');
      return Promise.resolve(true);
    });
    mocks.taskRepository.promoteWaitingTasks.mockImplementation(() => {
      events.push('promote');
      return Promise.resolve([{ ...waitingJudge, status: 'queued' }]);
    });
    service = createTaskService(
      mocks as unknown as Parameters<typeof createTaskService>[0],
    );

    await service.promoteSatisfiedWaitingTasks({ triggerTaskId: RUN_TASK });

    expect(events).toEqual([
      'list',
      'load-refs',
      'validate-keto',
      'tx',
      'promote',
    ]);
  });
});

describe('createTaskService.deleteMany', () => {
  it('plans authorized queued and terminal unsealed task deletion in safe mode', async () => {
    const terminal = makeJudgeTask(JUDGE_TASK, 'cancelled');
    const queued = makeJudgeTask(RUN_TASK, 'queued');
    const mocks = makeMocks({
      visibleTasks: { [JUDGE_TASK]: terminal, [RUN_TASK]: queued },
    });
    mocks.taskRepository.findSealedTaskIds.mockResolvedValue([JUDGE_TASK]);
    const service = createTaskService(
      mocks as unknown as Parameters<typeof createTaskService>[0],
    );

    const result = await service.planDeleteMany({
      ids: [JUDGE_TASK, RUN_TASK, OTHER_TEAM_ID],
      callerId: AGENT_ID,
      callerNs: KetoNamespace.Agent,
    });

    expect(result).toEqual({
      accepted: [RUN_TASK],
      skipped: [JUDGE_TASK, OTHER_TEAM_ID],
    });
    expect(mocks.taskRepository.deleteMany).not.toHaveBeenCalled();
    expect(mocks.taskRepository.deleteManyIfStatusIn).not.toHaveBeenCalled();
  });

  it('plans authorized waiting task deletion without force', async () => {
    const waiting = makeJudgeTask(JUDGE_TASK, 'waiting');
    const mocks = makeMocks({ visibleTasks: { [JUDGE_TASK]: waiting } });
    const service = createTaskService(
      mocks as unknown as Parameters<typeof createTaskService>[0],
    );

    const result = await service.planDeleteMany({
      ids: [JUDGE_TASK],
      callerId: AGENT_ID,
      callerNs: KetoNamespace.Agent,
    });

    expect(result).toEqual({
      accepted: [JUDGE_TASK],
      skipped: [],
    });
    expect(mocks.permissionChecker.canForceDeleteTasks).not.toHaveBeenCalled();
  });

  it('skips dispatched and running tasks in safe mode', async () => {
    const dispatched = makeJudgeTask(JUDGE_TASK, 'dispatched');
    const running = makeJudgeTask(RUN_TASK, 'running');
    const mocks = makeMocks({
      visibleTasks: { [JUDGE_TASK]: dispatched, [RUN_TASK]: running },
    });
    const service = createTaskService(
      mocks as unknown as Parameters<typeof createTaskService>[0],
    );

    const result = await service.planDeleteMany({
      ids: [JUDGE_TASK, RUN_TASK],
      callerId: AGENT_ID,
      callerNs: KetoNamespace.Agent,
    });

    expect(result).toEqual({
      accepted: [],
      skipped: [JUDGE_TASK, RUN_TASK],
    });
    expect(mocks.taskRepository.deleteMany).not.toHaveBeenCalled();
    expect(mocks.taskRepository.deleteManyIfStatusIn).not.toHaveBeenCalled();
  });

  it('skips deletion planning when delete permissions deny closed', async () => {
    const mocks = makeMocks({
      visibleTasks: {
        [JUDGE_TASK]: makeJudgeTask(JUDGE_TASK, 'cancelled'),
      },
    });
    mocks.permissionChecker.canDeleteTasks.mockResolvedValue(
      new Map([[JUDGE_TASK, false]]),
    );
    const service = createTaskService(
      mocks as unknown as Parameters<typeof createTaskService>[0],
    );

    const result = await service.planDeleteMany({
      ids: [JUDGE_TASK],
      callerId: AGENT_ID,
      callerNs: KetoNamespace.Agent,
    });

    expect(result).toEqual({
      accepted: [],
      skipped: [JUDGE_TASK],
    });
    expect(mocks.taskRepository.findByIds).not.toHaveBeenCalled();
    expect(mocks.taskRepository.deleteMany).not.toHaveBeenCalled();
    expect(mocks.taskRepository.deleteManyIfStatusIn).not.toHaveBeenCalled();
  });

  it('skips sealed task deletion in force mode without force_delete permission', async () => {
    const sealed = makeJudgeTask(JUDGE_TASK, 'cancelled');
    const unsealed = makeJudgeTask(RUN_TASK, 'cancelled');
    const mocks = makeMocks({
      visibleTasks: { [JUDGE_TASK]: sealed, [RUN_TASK]: unsealed },
    });
    mocks.taskRepository.findSealedTaskIds.mockResolvedValue([JUDGE_TASK]);
    mocks.permissionChecker.canForceDeleteTasks.mockResolvedValue(
      new Map([
        [JUDGE_TASK, false],
        [RUN_TASK, false],
      ]),
    );
    const service = createTaskService(
      mocks as unknown as Parameters<typeof createTaskService>[0],
    );

    const result = await service.planDeleteMany({
      ids: [JUDGE_TASK, RUN_TASK],
      callerId: AGENT_ID,
      callerNs: KetoNamespace.Agent,
      force: true,
      reason: 'operator cleanup',
    });

    expect(result).toEqual({
      accepted: [RUN_TASK],
      skipped: [JUDGE_TASK],
    });
  });

  it('accepts sealed task deletion in force mode with force_delete permission', async () => {
    const sealed = makeJudgeTask(JUDGE_TASK, 'cancelled');
    const mocks = makeMocks({ visibleTasks: { [JUDGE_TASK]: sealed } });
    mocks.taskRepository.findSealedTaskIds.mockResolvedValue([JUDGE_TASK]);
    mocks.permissionChecker.canForceDeleteTasks.mockResolvedValue(
      new Map([[JUDGE_TASK, true]]),
    );
    const service = createTaskService(
      mocks as unknown as Parameters<typeof createTaskService>[0],
    );

    const result = await service.planDeleteMany({
      ids: [JUDGE_TASK],
      callerId: AGENT_ID,
      callerNs: KetoNamespace.Agent,
      force: true,
      reason: 'operator cleanup',
    });

    expect(result).toEqual({
      accepted: [JUDGE_TASK],
      skipped: [],
    });
  });

  it('reports accepted tasks as skipped when they are no longer delete-eligible at delete time', async () => {
    const task = makeJudgeTask(JUDGE_TASK, 'queued');
    const mocks = makeMocks({ visibleTasks: { [JUDGE_TASK]: task } });
    mocks.taskRepository.deleteManyIfStatusIn.mockResolvedValue([]);
    const service = createTaskService(
      mocks as unknown as Parameters<typeof createTaskService>[0],
    );

    const result = await service.deleteMany({
      ids: [JUDGE_TASK],
      callerId: AGENT_ID,
      callerNs: KetoNamespace.Agent,
    });

    expect(mocks.taskRepository.deleteManyIfStatusIn).toHaveBeenCalledWith(
      [JUDGE_TASK],
      ['waiting', 'queued', 'completed', 'failed', 'cancelled', 'expired'],
    );
    expect(mocks.taskRepository.deleteMany).not.toHaveBeenCalled();
    expect(
      mocks.relationshipWriter.removeTaskRelationsBatch,
    ).toHaveBeenCalledWith([]);
    expect(result).toEqual({ deleted: [], skipped: [JUDGE_TASK] });
  });

  it('removes task relations in the delete transaction with one batch call', async () => {
    const task = {
      ...makeJudgeTask(JUDGE_TASK, 'cancelled'),
      claimAgentId: AGENT_ID,
    } as DbTask;
    const mocks = makeMocks({ visibleTasks: { [JUDGE_TASK]: task } });
    const service = createTaskService(
      mocks as unknown as Parameters<typeof createTaskService>[0],
    );

    const result = await service.deleteMany({
      ids: [JUDGE_TASK],
      callerId: AGENT_ID,
      callerNs: KetoNamespace.Agent,
    });

    expect(result).toEqual({ deleted: [JUDGE_TASK], skipped: [] });
    expect(
      mocks.relationshipWriter.removeTaskRelationsBatch,
    ).toHaveBeenCalledWith([
      { id: JUDGE_TASK, diaryId: DIARY_ID, claimAgentId: AGENT_ID },
    ]);
  });

  it('fails cleanup instead of reporting deletion when Keto relation cleanup fails', async () => {
    const task = makeJudgeTask(JUDGE_TASK, 'cancelled');
    const mocks = makeMocks({ visibleTasks: { [JUDGE_TASK]: task } });
    mocks.relationshipWriter.removeTaskRelationsBatch.mockRejectedValue(
      new Error('keto down'),
    );
    const service = createTaskService(
      mocks as unknown as Parameters<typeof createTaskService>[0],
    );

    await expect(
      service.deleteMany({
        ids: [JUDGE_TASK],
        callerId: AGENT_ID,
        callerNs: KetoNamespace.Agent,
      }),
    ).rejects.toMatchObject({
      code: 'invalid',
      message: 'Failed to clean up task permissions; no tasks were deleted',
    });
    expect(mocks.logger.error).toHaveBeenCalledOnce();
    const [[payload, message]] = mocks.logger.error.mock.calls as [
      [{ err: unknown; taskIds: string[] }, string],
    ];
    expect(payload.err).toBeInstanceOf(Error);
    expect(payload.taskIds).toEqual([JUDGE_TASK]);
    expect(message).toBe('task.delete-many_keto_cleanup_failed');
  });
});
