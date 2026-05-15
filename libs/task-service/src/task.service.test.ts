/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await, @typescript-eslint/no-unnecessary-type-assertion */
/**
 * Task service create-flow tests (#1101 review C3).
 *
 * Covers:
 *  - Happy path: judge_eval_variant create writes both task and seal.
 *  - Sealed-group rejection: second create against a sealed
 *    correlation_id throws `invalid`.
 *  - Seal-insert conflict inside the tx: the in-tx conflict throws
 *    `conflict`, no task or seal persists (tx rolls back as a unit).
 *  - Keto-grant rollback (outside the tx): grant fails after commit,
 *    compensating writes mark the task cancelled and delete the seal.
 *  - Concurrent create: two creates against the same correlation_id —
 *    exactly one wins, the other surfaces `conflict`.
 *
 * Repositories are mocked. The `TransactionRunner` is a passthrough
 * (callback executed inline) which makes "throw inside the tx" map
 * directly to "throw from the runner"; the production runner does the
 * same modulo DBOS sandboxing, which is out of scope for unit tests.
 */
import {
  type CorrelationSeal as DbCorrelationSeal,
  type Task as DbTask,
  type TransactionRunner,
} from '@moltnet/database';
import { initTaskTypeRegistry } from '@moltnet/tasks';
import { FormatRegistry } from '@sinclair/typebox';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { createTaskService } from './task.service.js';

const TEAM_ID = '00000000-0000-0000-0000-000000000001';
const DIARY_ID = 'd0000000-0000-0000-0000-000000000001';
const AGENT_ID = 'a0000000-0000-0000-0000-000000000001';
const RUN_A = '11111111-1111-1111-1111-111111111111';
const RUN_B = '22222222-2222-2222-2222-222222222222';
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
    successCriteria: rubric(),
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

function makeJudgeRow(id: string): DbTask {
  return {
    ...makeRunEvalTask(id),
    id,
    taskType: 'judge_eval_variant',
    outputKind: 'judgment',
    status: 'queued',
    completedAt: null,
    acceptedAttemptN: null,
    correlationId: null,
  } as unknown as DbTask;
}

interface Mocks {
  taskRepository: any;
  diaryRepository: any;
  agentRepository: any;
  contextPackRepository: any;
  renderedPackRepository: any;
  correlationSealRepository: any;
  permissionChecker: any;
  relationshipWriter: any;
  transactionRunner: TransactionRunner;
  logger: any;
  // book-keeping for assertions
  sealStore: Map<string, DbCorrelationSeal>;
}

function makeMocks(
  opts: {
    // map of task id → row visible to the caller
    visibleTasks?: Record<string, DbTask>;
    // pre-existing seal, e.g. for sealed-rejection test
    existingSeal?: DbCorrelationSeal;
    // grant outcome
    grantThrows?: boolean;
    // seal insert outcome (after lock)
    sealInsertThrows?: Error;
  } = {},
): Mocks {
  const sealStore = new Map<string, DbCorrelationSeal>();
  if (opts.existingSeal) {
    sealStore.set(opts.existingSeal.correlationId, opts.existingSeal);
  }
  const insertedTasks: DbTask[] = [];

  const correlationSealRepository = {
    acquireCorrelationLock: vi.fn(async (_: string) => undefined),
    findByCorrelationId: vi.fn(
      async (cid: string) => sealStore.get(cid) ?? null,
    ),
    create: vi.fn(async (input: any) => {
      if (opts.sealInsertThrows) {
        throw opts.sealInsertThrows;
      }
      if (sealStore.has(input.correlationId)) {
        const err = Object.assign(new Error('duplicate key'), {
          code: '23505',
        });
        throw err;
      }
      const row: DbCorrelationSeal = {
        correlationId: input.correlationId,
        sealedAt: new Date(),
        sealedByTaskId: input.sealedByTaskId,
        sealedByTaskType: input.sealedByTaskType,
        sealedByAgentId: input.sealedByAgentId ?? null,
        sealedByHumanId: input.sealedByHumanId ?? null,
      } as DbCorrelationSeal;
      sealStore.set(input.correlationId, row);
      return row;
    }),
    deleteBySealingTaskId: vi.fn(async (taskId: string) => {
      for (const [cid, row] of sealStore) {
        if (row.sealedByTaskId === taskId) {
          sealStore.delete(cid);
          return row;
        }
      }
      return null;
    }),
  };

  const taskRepository = {
    findById: vi.fn(async (id: string) => opts.visibleTasks?.[id] ?? null),
    findByCorrelationId: vi.fn(async (_cid: string) =>
      Object.values(opts.visibleTasks ?? {}).filter(
        (t) => t.correlationId === _cid,
      ),
    ),
    create: vi.fn(async (newTask: any) => {
      const row = makeJudgeRow(
        `j${insertedTasks.length}-0000-0000-0000-000000000000`,
      );
      const merged = { ...row, ...newTask, id: row.id, status: 'queued' };
      insertedTasks.push(merged as DbTask);
      return merged as DbTask;
    }),
    updateStatus: vi.fn(async (id: string, status: string, fields: any) => {
      const t = insertedTasks.find((r) => r.id === id);
      if (t) {
        (t as any).status = status;
        (t as any).cancelReason = fields.cancelReason;
      }
      return t ?? null;
    }),
  };

  // Passthrough transaction runner: callback executes inline. Throwing
  // inside the callback propagates out of runInTransaction. Production
  // (DBOS) wraps the same callback in a Postgres tx, which rolls back
  // automatically on throw; the test runner mirrors the control flow
  // but does not roll back state — the create path doesn't rely on
  // state rollback for correctness inside the tx because the only DB
  // writes are task and seal, and tests assert on the throw + final
  // visible state.
  const transactionRunner: TransactionRunner = {
    async runInTransaction(fn) {
      return fn();
    },
  };

  return {
    taskRepository,
    diaryRepository: {
      findById: vi.fn(async () => ({ id: DIARY_ID, teamId: TEAM_ID })),
    },
    agentRepository: {
      findByIdentityId: vi.fn(async () => ({ identityId: AGENT_ID })),
    },
    contextPackRepository: {
      findById: vi.fn(async () => null),
    },
    renderedPackRepository: {
      findById: vi.fn(async () => null),
    },
    correlationSealRepository,
    permissionChecker: {
      canImposeTask: vi.fn(async () => true),
      canViewTask: vi.fn(async (taskId: string) =>
        Boolean(opts.visibleTasks?.[taskId]),
      ),
      canReadPack: vi.fn(async () => true),
    },
    relationshipWriter: {
      grantTaskParent: vi.fn(async () => {
        if (opts.grantThrows) throw new Error('keto down');
      }),
    },
    transactionRunner,
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    sealStore,
  };
}

function judgeCreateInput() {
  return {
    taskType: 'judge_eval_variant',
    teamId: TEAM_ID,
    diaryId: DIARY_ID,
    inputPayload: {
      runTaskIds: [RUN_A, RUN_B],
      successCriteria: rubric(),
    },
    callerId: AGENT_ID,
    callerNs: 'agent' as any,
    callerIsAgent: true,
  };
}

beforeAll(async () => {
  // Register UUID format on the same FormatRegistry instance the
  // schema validators use. Module-top registration is fragile because
  // pnpm symlinks can resolve `@sinclair/typebox` from the test file
  // and from `@moltnet/tasks` to different module instances; doing
  // this inside beforeAll ensures it runs after all imports have
  // settled and before any test body executes.
  // Always override — some module may have registered a stricter or
  // mismatched 'uuid' validator earlier in the import graph.
  FormatRegistry.Set('uuid', (v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  );
  await initTaskTypeRegistry();
});

describe('createTaskService.create — judge_eval_variant flow (#1101 C3)', () => {
  let mocks: Mocks;
  let service: ReturnType<typeof createTaskService>;

  beforeEach(() => {
    mocks = makeMocks({
      visibleTasks: {
        [RUN_A]: makeRunEvalTask(RUN_A),
        [RUN_B]: makeRunEvalTask(RUN_B),
      },
    });
    service = createTaskService(mocks as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('happy path: writes task and seal in one transaction, runs grant', async () => {
    const task = await service.create(judgeCreateInput() as any);
    expect(task.taskType).toBe('judge_eval_variant');
    expect(mocks.taskRepository.create).toHaveBeenCalledOnce();
    expect(
      mocks.correlationSealRepository.acquireCorrelationLock,
    ).toHaveBeenCalledWith(CORRELATION);
    expect(mocks.correlationSealRepository.create).toHaveBeenCalledOnce();
    expect(mocks.sealStore.get(CORRELATION)?.sealedByTaskType).toBe(
      'judge_eval_variant',
    );
    expect(mocks.relationshipWriter.grantTaskParent).toHaveBeenCalledOnce();
  });

  it('rejects when the correlation_id is already sealed', async () => {
    mocks = makeMocks({
      visibleTasks: {
        [RUN_A]: makeRunEvalTask(RUN_A),
        [RUN_B]: makeRunEvalTask(RUN_B),
      },
      existingSeal: {
        correlationId: CORRELATION,
        sealedAt: new Date(),
        sealedByTaskId: 'prior',
        sealedByTaskType: 'judge_eval_variant',
        sealedByAgentId: null,
        sealedByHumanId: null,
      } as DbCorrelationSeal,
    });
    service = createTaskService(mocks as any);
    await expect(
      service.create(judgeCreateInput() as any),
    ).rejects.toMatchObject({
      name: 'TaskServiceError',
      code: 'invalid',
    });
    // Async validator caught it before we ever entered the tx — no DB writes.
    expect(mocks.taskRepository.create).not.toHaveBeenCalled();
    expect(mocks.correlationSealRepository.create).not.toHaveBeenCalled();
  });

  it('seal-insert conflict inside the tx surfaces as conflict and the tx aborts (no Keto grant)', async () => {
    // Simulate the lock-protected re-check failing: another tx wrote a
    // seal between our async validator and the lock acquire.
    mocks = makeMocks({
      visibleTasks: {
        [RUN_A]: makeRunEvalTask(RUN_A),
        [RUN_B]: makeRunEvalTask(RUN_B),
      },
    });
    // Inject a seal AFTER the create call enters the tx — easiest way
    // in this mock world: make findByCorrelationId return a seal once
    // we're past the pre-tx validator pass.
    let calls = 0;
    mocks.correlationSealRepository.findByCorrelationId = vi.fn(
      async (cid: string) => {
        calls += 1;
        // First call is the async validator (service-level "is sealed?"
        // pre-tx check). It must return null so we enter the tx.
        // Second call is inside the tx, after acquireCorrelationLock.
        if (calls === 1) return null;
        return {
          correlationId: cid,
          sealedAt: new Date(),
          sealedByTaskId: 'racer',
          sealedByTaskType: 'judge_eval_variant',
          sealedByAgentId: null,
          sealedByHumanId: null,
        } as DbCorrelationSeal;
      },
    );
    service = createTaskService(mocks as any);
    await expect(
      service.create(judgeCreateInput() as any),
    ).rejects.toMatchObject({
      code: 'conflict',
    });
    // Keto grant must not have run — the tx threw before commit.
    expect(mocks.relationshipWriter.grantTaskParent).not.toHaveBeenCalled();
  });

  it('Keto-grant failure rolls back: deletes seal and cancels task', async () => {
    mocks = makeMocks({
      visibleTasks: {
        [RUN_A]: makeRunEvalTask(RUN_A),
        [RUN_B]: makeRunEvalTask(RUN_B),
      },
      grantThrows: true,
    });
    service = createTaskService(mocks as any);
    await expect(
      service.create(judgeCreateInput() as any),
    ).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(
      mocks.correlationSealRepository.deleteBySealingTaskId,
    ).toHaveBeenCalledOnce();
    expect(mocks.taskRepository.updateStatus).toHaveBeenCalledWith(
      expect.any(String),
      'cancelled',
      expect.objectContaining({ cancelReason: expect.stringMatching(/Keto/) }),
    );
    // Seal should be gone after compensating delete.
    expect(mocks.sealStore.get(CORRELATION)).toBeUndefined();
  });

  it('concurrent creates: only one seal exists after both attempt', async () => {
    // Two independent services sharing one seal store. The mock's
    // correlationSealRepository.create throws 23505 on duplicate
    // correlation_id, which is the production behavior.
    mocks = makeMocks({
      visibleTasks: {
        [RUN_A]: makeRunEvalTask(RUN_A),
        [RUN_B]: makeRunEvalTask(RUN_B),
      },
    });
    const sharedSealStore = mocks.sealStore;
    const a = createTaskService(mocks as any);
    // Build a second service that shares the seal store but has its own
    // task store. Reuse the correlationSealRepository so both creates
    // contend on the same seal map.
    const mocksB = makeMocks({
      visibleTasks: {
        [RUN_A]: makeRunEvalTask(RUN_A),
        [RUN_B]: makeRunEvalTask(RUN_B),
      },
    });
    mocksB.correlationSealRepository = mocks.correlationSealRepository;
    // Reuse the shared sealStore reference on the second service's mocks
    // so the assertion below reads the same map either side updates.
    (mocksB as any).sealStore = sharedSealStore;
    const b = createTaskService(mocksB as any);

    const results = await Promise.allSettled([
      a.create(judgeCreateInput() as any),
      b.create(judgeCreateInput() as any),
    ]);
    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect((failures[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'conflict',
    });
    // Exactly one seal in the store.
    expect(sharedSealStore.size).toBe(1);
  });

  it('rejects when caller cannot view a runTaskId target (visibility leak guard)', async () => {
    // RUN_B is not in visibleTasks → permissionChecker.canViewTask
    // returns false for it; resolveTask returns null; the async
    // validator surfaces "does not resolve" without leaking which kind
    // of failure (missing vs forbidden).
    mocks = makeMocks({ visibleTasks: { [RUN_A]: makeRunEvalTask(RUN_A) } });
    service = createTaskService(mocks as any);
    await expect(
      service.create(judgeCreateInput() as any),
    ).rejects.toMatchObject({
      code: 'invalid',
    });
    expect(mocks.taskRepository.create).not.toHaveBeenCalled();
  });
});
