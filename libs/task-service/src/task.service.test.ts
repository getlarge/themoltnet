import { computeJsonCid } from '@moltnet/crypto-service';
import type { Task as DbTask, TransactionRunner } from '@moltnet/database';
import { initTaskTypeRegistry } from '@moltnet/tasks';
import { FormatRegistry } from '@sinclair/typebox';
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
    imposedByAgentId: AGENT_ID,
    imposedByHumanId: null,
    acceptedAttemptN: 1,
    requiredExecutorTrustLevel: 'self_declared',
    allowedExecutors: [],
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
  create: Mock<(newTask: Record<string, unknown>) => Promise<DbTask>>;
  updateStatus: Mock<
    (
      id: string,
      status: string,
      fields: { cancelReason?: string },
    ) => Promise<DbTask | null>
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
  canImposeTask: Mock<
    (diaryId: string, callerId: string, callerNs: string) => Promise<boolean>
  >;
  canViewTask: Mock<
    (taskId: string, callerId: string, callerNs: string) => Promise<boolean>
  >;
  canReadPack: Mock<
    (packId: string, callerId: string, callerNs: string) => Promise<boolean>
  >;
};

type RelationshipWriterMocks = {
  grantTaskParent: Mock<(taskId: string, diaryId: string) => Promise<void>>;
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
          status: 'queued',
        } as DbTask;
        insertedTasks.push(merged);
        return Promise.resolve(merged);
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
      canImposeTask: vi
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
    },
    transactionRunner,
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
    teamId: TEAM_ID,
    diaryId: DIARY_ID,
    inputPayload: {
      brief: 'Implement the feature.',
      title: 'Feature work',
    },
    callerId: AGENT_ID,
    callerNs: 'agent' as const,
    callerIsAgent: true,
  };
}

beforeAll(async () => {
  FormatRegistry.Set('uuid', (v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  );
  await initTaskTypeRegistry();
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
      input: Record<string, unknown>;
      inputCid: string;
    };
    expect(newTask.input).toMatchObject({
      brief: 'Implement the feature.',
      title: 'Feature work',
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
});
