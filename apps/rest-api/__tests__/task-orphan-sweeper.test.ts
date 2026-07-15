import type * as DatabaseModule from '@moltnet/database';
import {
  DBOS,
  DBOSErrors,
  type Task,
  type TaskAttempt,
} from '@moltnet/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock DBOS BEFORE importing the module under test. We capture each
// registered workflow/step by name so the test can drive the sweeper
// directly without a live DBOS runtime.
const {
  registeredWorkflows,
  registeredSteps,
  registeredScheduled,
  dbosMock,
  WorkflowQueueMock,
} = vi.hoisted(() => {
  const registeredWorkflows: Record<string, (...args: unknown[]) => unknown> =
    {};
  const registeredSteps: Record<string, (...args: unknown[]) => unknown> = {};
  const registeredScheduled: Record<string, unknown> = {};
  const dbosMock = {
    registerWorkflow: vi.fn(
      (
        fn: (...args: unknown[]) => unknown,
        config: { name: string },
      ): ((...args: unknown[]) => unknown) => {
        registeredWorkflows[config.name] = fn;
        return fn;
      },
    ),
    registerStep: vi.fn(
      (
        fn: (...args: unknown[]) => unknown,
        config: { name: string },
      ): ((...args: unknown[]) => unknown) => {
        registeredSteps[config.name] = fn;
        return fn;
      },
    ),
    registerScheduled: vi.fn((workflow: unknown, config: { name: string }) => {
      registeredScheduled[config.name] = workflow;
    }),
    startWorkflow: vi.fn(
      (fn: (...args: unknown[]) => unknown) =>
        (...args: unknown[]) =>
          fn(...args),
    ),
    resumeWorkflow: vi.fn(),
  };

  class WorkflowQueueMock {
    readonly name: string;

    constructor(name: string) {
      this.name = name;
    }
  }

  return {
    registeredWorkflows,
    registeredSteps,
    registeredScheduled,
    dbosMock,
    WorkflowQueueMock,
  };
});

vi.mock('@dbos-inc/dbos-sdk', () => ({
  DBOS: dbosMock,
  WorkflowQueue: WorkflowQueueMock,
}));

vi.mock('@moltnet/database', async () => {
  const actual = await vi.importActual<DatabaseModule>('@moltnet/database');
  return {
    ...actual,
    DBOS: dbosMock,
    WorkflowQueue: WorkflowQueueMock,
  };
});

import {
  initMaintenanceWorkflows,
  type MaintenanceDeps,
  setMaintenanceDeps,
} from '../src/workflows/maintenance.js';

const TASK_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ATTEMPT_N = 1;
const WORKFLOW_ID = `task:${TASK_ID}:1`;
const AGENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const GRACE_PERIOD_SEC = 300;
const BATCH_SIZE = 50;
const EXPIRED_TASK_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

function makeOrphan(claimExpiresAt: Date): {
  task: Task;
  attempt: TaskAttempt;
} {
  return {
    task: {
      id: TASK_ID,
      status: 'running',
      claimAgentId: AGENT_ID,
      claimExpiresAt,
    } as unknown as Task,
    attempt: {
      taskId: TASK_ID,
      attemptN: ATTEMPT_N,
      workflowId: WORKFLOW_ID,
      claimedByAgentId: AGENT_ID,
      status: 'running',
    } as unknown as TaskAttempt,
  };
}

function makeDeps(orphans: Array<{ task: Task; attempt: TaskAttempt }>): {
  deps: MaintenanceDeps;
  logger: {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
} {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const taskRepository = {
    listOrphanedTasks: vi.fn().mockResolvedValue(orphans),
    listExpiredNonTerminalTasks: vi.fn().mockResolvedValue([]),
    expireIfStillNonTerminal: vi.fn().mockResolvedValue(null),
    expireManyIfStillNonTerminal: vi.fn().mockResolvedValue([]),
    listTerminalTasksPastRetention: vi.fn().mockResolvedValue([]),
    findByIds: vi
      .fn()
      .mockImplementation((ids: string[]) =>
        Promise.resolve(
          ids
            .map((id) => orphans.find((o) => o.task.id === id)?.task)
            .filter(Boolean),
        ),
      ),
    findSealedTaskIds: vi.fn().mockResolvedValue([]),
    deleteCorrelationSealsForTasks: vi.fn().mockResolvedValue(undefined),
    lockIdsIfStatusIn: vi
      .fn()
      .mockImplementation((ids: string[]) => Promise.resolve(ids)),
    deleteMany: vi.fn().mockResolvedValue([]),
    deleteManyIfStatusIn: vi.fn().mockResolvedValue([]),
    countAttempts: vi.fn().mockResolvedValue(1),
    getMaxAttempts: vi.fn().mockResolvedValue(1),
    findById: vi
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve(orphans.find((o) => o.task.id === id)?.task ?? null),
      ),
    updateAttempt: vi.fn().mockResolvedValue(null),
    updateStatus: vi.fn().mockResolvedValue(null),
  };
  const dataSource = {
    runTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  };
  const transactionRunner = {
    runInTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  };
  const relationshipWriter = {
    removeTaskClaimant: vi.fn().mockResolvedValue(undefined),
    removeTaskRelationsBatch: vi.fn().mockResolvedValue(undefined),
  };
  const taskArtifactRepository = {
    listCleanupRefsForTasks: vi.fn().mockResolvedValue([]),
    listObjectKeysStillReferenced: vi.fn().mockResolvedValue([]),
    filterCidsWithRows: vi.fn().mockResolvedValue([]),
  };
  const runtimeSessionRepository = {
    listCleanupRefsForTasks: vi.fn().mockResolvedValue([]),
    detachChildren: vi.fn().mockResolvedValue(undefined),
  };
  const taskArtifactStorage = {
    deleteObject: vi.fn().mockResolvedValue(undefined),
    deleteObjects: vi.fn().mockResolvedValue(undefined),
  };
  const runtimeSessionStorage = {
    deleteObject: vi.fn().mockResolvedValue(undefined),
    deleteObjects: vi.fn().mockResolvedValue(undefined),
  };
  const deps = {
    nonceRepository: {} as unknown,
    contextPackRepository: {} as unknown,
    renderedPackRepository: {} as unknown,
    taskRepository,
    taskArtifactRepository,
    runtimeSessionRepository,
    taskArtifactStorage,
    runtimeSessionStorage,
    dataSource,
    transactionRunner,
    relationshipWriter,
    logger,
    notifyTaskStatusChanged: vi.fn().mockResolvedValue(undefined),
  } as unknown as MaintenanceDeps;
  return { deps, logger };
}

async function runSweep(): Promise<{
  examined: number;
  resumed: number;
  forceReleased: number;
}> {
  const sweeper = registeredWorkflows['maintenance.taskOrphanSweeper'];
  if (!sweeper) throw new Error('sweeper workflow not registered');
  return (await sweeper({
    gracePeriodSec: GRACE_PERIOD_SEC,
    batchSize: BATCH_SIZE,
  })) as {
    examined: number;
    resumed: number;
    forceReleased: number;
  };
}

async function runExpirySweep(): Promise<{
  examined: number;
  expired: number;
}> {
  const sweeper = registeredWorkflows['maintenance.taskExpirySweeper'];
  if (!sweeper) throw new Error('expiry sweeper workflow not registered');
  return (await sweeper({
    batchSize: BATCH_SIZE,
  })) as {
    examined: number;
    expired: number;
  };
}

async function runRetentionSweep(): Promise<{
  enqueued: boolean;
}> {
  const sweeper = registeredWorkflows['maintenance.taskRetentionSweeper'];
  if (!sweeper) throw new Error('retention sweeper workflow not registered');
  return (await sweeper({
    batchSize: BATCH_SIZE,
    policyDays: {
      completed: 180,
      failed: 90,
      cancelled: 90,
      expired: 90,
    },
  })) as {
    enqueued: boolean;
  };
}

describe('taskOrphanSweeperWorkflow — backstop (#1077)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    for (const k of Object.keys(registeredWorkflows))
      delete registeredWorkflows[k];
    for (const k of Object.keys(registeredSteps)) delete registeredSteps[k];
    for (const k of Object.keys(registeredScheduled))
      delete registeredScheduled[k];
    // Reset the module's _initialized flag by re-importing.
    vi.resetModules();
  });

  async function init(): Promise<typeof DBOS> {
    const { initMaintenanceWorkflows: init } =
      await import('../src/workflows/maintenance.js');
    init(
      {
        PACK_GC_COMPILE_TTL_DAYS: 7,
        PACK_GC_CRON: '0 * * * *',
        PACK_GC_BATCH_SIZE: 100,
      },
      {
        TASK_ORPHAN_SWEEPER_CRON: '*/2 * * * *',
        TASK_ORPHAN_SWEEPER_GRACE_SEC: GRACE_PERIOD_SEC,
        TASK_ORPHAN_SWEEPER_BATCH_SIZE: BATCH_SIZE,
        TASK_DEFAULT_EXPIRES_IN_SEC: 90 * 24 * 60 * 60,
        TASK_MAX_EXPIRES_IN_SEC: 90 * 24 * 60 * 60,
        TASK_RETENTION_SWEEPER_CRON: '0 * * * *',
        TASK_RETENTION_SWEEPER_BATCH_SIZE: BATCH_SIZE,
        TASK_COMPLETED_RETENTION_DAYS: 180,
        TASK_FAILED_RETENTION_DAYS: 90,
        TASK_CANCELLED_RETENTION_DAYS: 90,
        TASK_EXPIRED_RETENTION_DAYS: 90,
      },
    );
    return DBOS;
  }

  it('within backstop window: tries resume, counts as resumed when DBOS returns OK', async () => {
    const DBOS = await init();
    // Claim expired 350s ago (just past grace, well within 2× grace).
    const claimExpiresAt = new Date(Date.now() - 350_000);
    const { deps } = makeDeps([makeOrphan(claimExpiresAt)]);
    const { setMaintenanceDeps: setDeps } =
      await import('../src/workflows/maintenance.js');
    setDeps(deps);

    vi.mocked(DBOS.resumeWorkflow).mockResolvedValue(undefined as never);

    const result = await runSweep();

    expect(DBOS.resumeWorkflow).toHaveBeenCalledWith(WORKFLOW_ID);
    expect(result).toEqual({ examined: 1, resumed: 1, forceReleased: 0 });
    // updateAttempt is the force-release path — must NOT be called.
    expect(deps.taskRepository.updateAttempt).not.toHaveBeenCalled();
  });

  it('past 2× grace: skips resume, force-releases unconditionally (#1077 backstop)', async () => {
    const DBOS = await init();
    // Claim expired 700s ago — past 2× grace (600s). This is exactly
    // the production scenario from issue #1077: the previous sweep
    // counted this task as "resumed" but the row stayed `running`.
    const claimExpiresAt = new Date(Date.now() - 700_000);
    const { deps, logger } = makeDeps([makeOrphan(claimExpiresAt)]);
    const { setMaintenanceDeps: setDeps } =
      await import('../src/workflows/maintenance.js');
    setDeps(deps);

    const result = await runSweep();

    expect(DBOS.resumeWorkflow).not.toHaveBeenCalled();
    expect(result).toEqual({ examined: 1, resumed: 0, forceReleased: 1 });
    // Force-release path: attempt → timed_out with code 'orphaned'.
    expect(deps.taskRepository.updateAttempt).toHaveBeenCalledWith(
      TASK_ID,
      ATTEMPT_N,
      expect.objectContaining({
        status: 'timed_out',
        error: expect.objectContaining({ code: 'orphaned' }),
      }),
    );
    expect(deps.transactionRunner.runInTransaction).toHaveBeenCalledTimes(1);
    expect(deps.dataSource.runTransaction).not.toHaveBeenCalled();
    // Backstop emitted a warn log so production occurrences stay visible.
    const warnCall = logger.warn.mock.calls.find(
      ([, msg]) =>
        typeof msg === 'string' && msg.includes('past backstop window'),
    );
    expect(warnCall).toBeDefined();
  });

  it('per-iteration force-release isolation: one failure does not abort the batch', async () => {
    const DBOS = await init();
    void DBOS;
    // Two orphans, both past backstop. First updateAttempt throws,
    // second must still run.
    const old = new Date(Date.now() - 700_000);
    const orphan1 = makeOrphan(old);
    const orphan2 = {
      task: { ...orphan1.task, id: 'cccccccc-cccc-cccc-cccc-cccccccccccc' },
      attempt: {
        ...orphan1.attempt,
        taskId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      },
    } as { task: Task; attempt: TaskAttempt };
    const { deps, logger } = makeDeps([orphan1, orphan2]);
    const { setMaintenanceDeps: setDeps } =
      await import('../src/workflows/maintenance.js');
    setDeps(deps);

    let calls = 0;
    vi.mocked(deps.taskRepository.updateAttempt).mockImplementation(
      async () => {
        calls += 1;
        if (calls === 1) throw new Error('simulated DB error');
        return null;
      },
    );

    const result = await runSweep();

    // Both orphans were attempted; one failed, one succeeded.
    expect(deps.taskRepository.updateAttempt).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ examined: 2, resumed: 0, forceReleased: 1 });
    const errorCall = logger.error.mock.calls.find(
      ([, msg]) =>
        typeof msg === 'string' && msg.includes('force-release failed'),
    );
    expect(errorCall).toBeDefined();
  });

  it('tryResumeWorkflow re-throws unexpected errors instead of silently falling through', async () => {
    const DBOS = await init();
    // Within backstop so resume IS attempted.
    const claimExpiresAt = new Date(Date.now() - 350_000);
    const { deps } = makeDeps([makeOrphan(claimExpiresAt)]);
    const { setMaintenanceDeps: setDeps } =
      await import('../src/workflows/maintenance.js');
    setDeps(deps);

    // Plain Error — not a DBOSNonExistentWorkflowError or sibling.
    // The catch should re-throw so DBOS step retries kick in.
    vi.mocked(DBOS.resumeWorkflow).mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(runSweep()).rejects.toThrow('ECONNREFUSED');
    expect(deps.taskRepository.updateAttempt).not.toHaveBeenCalled();
  });

  it('task expiry sweeper marks expired waiting or queued tasks as expired', async () => {
    await init();
    const { deps } = makeDeps([]);
    const candidate = {
      id: EXPIRED_TASK_ID,
      status: 'waiting',
      expiresAt: new Date('2026-06-30T00:00:00Z'),
    } as unknown as Task;
    vi.mocked(
      deps.taskRepository.listExpiredNonTerminalTasks,
    ).mockResolvedValue([candidate]);
    vi.mocked(
      deps.taskRepository.expireManyIfStillNonTerminal,
    ).mockResolvedValue([
      {
        ...candidate,
        status: 'expired',
        completedAt: new Date('2026-07-01T00:00:00Z'),
      } as unknown as Task,
    ]);
    const { setMaintenanceDeps: setDeps } =
      await import('../src/workflows/maintenance.js');
    setDeps(deps);

    const result = await runExpirySweep();

    expect(
      deps.taskRepository.listExpiredNonTerminalTasks,
    ).toHaveBeenCalledWith(expect.any(Date), BATCH_SIZE);
    expect(
      deps.taskRepository.expireManyIfStillNonTerminal,
    ).toHaveBeenCalledWith([EXPIRED_TASK_ID]);
    expect(deps.taskRepository.expireIfStillNonTerminal).not.toHaveBeenCalled();
    expect(
      registeredSteps['maintenance.taskExpirySweeper.notifyExpiredTasks'],
    ).toBeDefined();
    expect(deps.notifyTaskStatusChanged).toHaveBeenCalledWith(EXPIRED_TASK_ID);
    expect(result).toEqual({ examined: 1, expired: 1 });
  });

  it('task retention sweeper enqueues cleanup through a deduped DBOS queue', async () => {
    await init();
    const { deps } = makeDeps([]);
    const { setMaintenanceDeps: setDeps } =
      await import('../src/workflows/maintenance.js');
    setDeps(deps);

    const result = await runRetentionSweep();

    expect(DBOS.startWorkflow).toHaveBeenCalledWith(
      registeredWorkflows['maintenance.taskRetentionCleanup'],
      expect.objectContaining({
        queueName: 'task-retention-cleanup',
        enqueueOptions: {
          deduplicationID: 'task-retention-cleanup',
        },
      }),
    );
    expect(result).toEqual({ enqueued: true });
  });

  it('task retention sweeper treats duplicate queue submissions as already enqueued', async () => {
    await init();
    const { deps } = makeDeps([]);
    const { setMaintenanceDeps: setDeps } =
      await import('../src/workflows/maintenance.js');
    setDeps(deps);
    vi.mocked(DBOS.startWorkflow).mockImplementationOnce(() => async () => {
      throw new DBOSErrors.DBOSQueueDuplicatedError(
        'existing-workflow',
        'task-retention-cleanup',
        'task-retention-cleanup',
      );
    });

    const result = await runRetentionSweep();

    expect(result).toEqual({ enqueued: false });
  });

  it('task retention cleanup workflow builds a manifest, deletes objects, rows, and relations', async () => {
    await init();
    const { deps } = makeDeps([]);
    const retained = [
      {
        id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1',
        status: 'completed',
        teamId: '99999999-9999-9999-9999-999999999999',
        diaryId: 'ffffffff-ffff-ffff-ffff-fffffffffff1',
        claimAgentId: null,
      },
      {
        id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2',
        status: 'failed',
        teamId: '99999999-9999-9999-9999-999999999999',
        diaryId: null,
        claimAgentId: null,
      },
    ] as unknown as Task[];
    vi.mocked(
      deps.taskRepository.listTerminalTasksPastRetention,
    ).mockResolvedValue(retained);
    vi.mocked(deps.taskRepository.findSealedTaskIds).mockResolvedValue([
      retained[1].id,
    ]);
    vi.mocked(
      deps.taskArtifactRepository.listCleanupRefsForTasks,
    ).mockResolvedValue([
      {
        id: '22222222-2222-2222-2222-222222222222',
        taskId: retained[0].id,
        objectKey: 'teams/t/artifacts/a',
        sizeBytes: 123,
      },
    ]);
    vi.mocked(
      deps.runtimeSessionRepository.listCleanupRefsForTasks,
    ).mockResolvedValue([
      {
        id: '33333333-3333-3333-3333-333333333333',
        taskId: retained[0].id,
        objectKey: 'teams/t/sessions/s',
        sizeBytes: 456,
      },
    ]);
    vi.mocked(deps.taskRepository.deleteMany).mockResolvedValue([
      retained[0].id,
    ]);
    const { setMaintenanceDeps: setDeps } =
      await import('../src/workflows/maintenance.js');
    setDeps(deps);

    const workflow = registeredWorkflows['maintenance.taskRetentionCleanup'];
    if (!workflow) {
      throw new Error('task retention cleanup workflow not registered');
    }
    const result = await workflow({
      batchSize: BATCH_SIZE,
      policyDays: {
        completed: 180,
        failed: 90,
        cancelled: 90,
        expired: 90,
      },
    });

    expect(
      deps.taskRepository.listTerminalTasksPastRetention,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        completedBefore: expect.any(Date),
        failedBefore: expect.any(Date),
        cancelledBefore: expect.any(Date),
        expiredBefore: expect.any(Date),
      }),
      BATCH_SIZE,
    );
    expect(
      deps.taskArtifactRepository.listCleanupRefsForTasks,
    ).toHaveBeenCalledWith([retained[0].id]);
    expect(
      deps.runtimeSessionRepository.listCleanupRefsForTasks,
    ).toHaveBeenCalledWith([retained[0].id]);
    expect(deps.taskArtifactStorage.deleteObjects).toHaveBeenCalledWith([
      'teams/t/artifacts/a',
    ]);
    expect(deps.runtimeSessionStorage.deleteObjects).toHaveBeenCalledWith([
      'teams/t/sessions/s',
    ]);
    expect(deps.taskArtifactStorage.deleteObject).not.toHaveBeenCalled();
    expect(deps.runtimeSessionStorage.deleteObject).not.toHaveBeenCalled();
    expect(deps.runtimeSessionRepository.detachChildren).toHaveBeenCalledWith([
      '33333333-3333-3333-3333-333333333333',
    ]);
    expect(deps.taskRepository.deleteMany).toHaveBeenCalledWith([
      retained[0].id,
    ]);
    expect(
      deps.relationshipWriter.removeTaskRelationsBatch,
    ).toHaveBeenCalledWith([
      {
        id: retained[0].id,
        diaryId: retained[0].diaryId,
        claimAgentId: retained[0].claimAgentId,
      },
    ]);
    expect(result).toEqual({
      examined: 2,
      deletedTaskCount: 1,
      deletedObjectCount: 2,
      skippedProtected: 1,
      batchFull: false,
    });
  });

  it('task retention cleanup only removes objects and relations for deleted task rows', async () => {
    await init();
    const { deps } = makeDeps([]);
    const retained = [
      {
        id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee3',
        status: 'completed',
        teamId: '99999999-9999-9999-9999-999999999999',
        diaryId: 'ffffffff-ffff-ffff-ffff-fffffffffff3',
        claimAgentId: null,
      },
      {
        id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee4',
        status: 'completed',
        teamId: '99999999-9999-9999-9999-999999999999',
        diaryId: 'ffffffff-ffff-ffff-ffff-fffffffffff4',
        claimAgentId: null,
      },
    ] as unknown as Task[];
    vi.mocked(
      deps.taskRepository.listTerminalTasksPastRetention,
    ).mockResolvedValue(retained);
    vi.mocked(deps.taskRepository.findSealedTaskIds).mockResolvedValue([]);
    vi.mocked(
      deps.taskArtifactRepository.listCleanupRefsForTasks,
    ).mockResolvedValue([
      {
        id: '22222222-2222-2222-2222-222222222223',
        taskId: retained[0].id,
        objectKey: 'teams/t/artifacts/deleted',
        sizeBytes: 123,
      },
      {
        id: '22222222-2222-2222-2222-222222222224',
        taskId: retained[1].id,
        objectKey: 'teams/t/artifacts/kept',
        sizeBytes: 456,
      },
    ]);
    vi.mocked(
      deps.runtimeSessionRepository.listCleanupRefsForTasks,
    ).mockResolvedValue([
      {
        id: '33333333-3333-3333-3333-333333333334',
        taskId: retained[0].id,
        objectKey: 'teams/t/sessions/deleted',
        sizeBytes: 456,
      },
      {
        id: '33333333-3333-3333-3333-333333333335',
        taskId: retained[1].id,
        objectKey: 'teams/t/sessions/kept',
        sizeBytes: 789,
      },
    ]);
    vi.mocked(deps.taskRepository.deleteMany).mockResolvedValue([
      retained[0].id,
    ]);
    const { setMaintenanceDeps: setDeps } =
      await import('../src/workflows/maintenance.js');
    setDeps(deps);

    const workflow = registeredWorkflows['maintenance.taskRetentionCleanup'];
    if (!workflow) {
      throw new Error('task retention cleanup workflow not registered');
    }
    const result = await workflow({
      batchSize: BATCH_SIZE,
      policyDays: {
        completed: 180,
        failed: 90,
        cancelled: 90,
        expired: 90,
      },
    });

    expect(deps.taskArtifactStorage.deleteObjects).toHaveBeenCalledTimes(1);
    expect(deps.taskArtifactStorage.deleteObjects).toHaveBeenCalledWith([
      'teams/t/artifacts/deleted',
    ]);
    expect(deps.runtimeSessionStorage.deleteObjects).toHaveBeenCalledTimes(1);
    expect(deps.runtimeSessionStorage.deleteObjects).toHaveBeenCalledWith([
      'teams/t/sessions/deleted',
    ]);
    expect(deps.taskArtifactStorage.deleteObject).not.toHaveBeenCalled();
    expect(deps.runtimeSessionStorage.deleteObject).not.toHaveBeenCalled();
    expect(
      deps.relationshipWriter.removeTaskRelationsBatch,
    ).toHaveBeenCalledWith([
      {
        id: retained[0].id,
        diaryId: retained[0].diaryId,
        claimAgentId: retained[0].claimAgentId,
      },
    ]);
    expect(result).toEqual({
      examined: 2,
      deletedTaskCount: 1,
      deletedObjectCount: 2,
      skippedProtected: 0,
      batchFull: false,
    });
  });

  it('task deletion workflow removes seals, task dependencies, objects, and relations', async () => {
    await init();
    const { deps } = makeDeps([]);
    const deletedTask = {
      id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee5',
      status: 'cancelled',
      teamId: '99999999-9999-9999-9999-999999999999',
      diaryId: 'ffffffff-ffff-ffff-ffff-fffffffffff5',
      claimAgentId: AGENT_ID,
    } as unknown as Task;
    const liveTask = {
      id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee6',
      status: 'running',
      teamId: '99999999-9999-9999-9999-999999999999',
      diaryId: 'ffffffff-ffff-ffff-ffff-fffffffffff6',
      claimAgentId: null,
    } as unknown as Task;
    vi.mocked(deps.taskRepository.findByIds).mockResolvedValue([
      deletedTask,
      liveTask,
    ]);
    vi.mocked(deps.taskRepository.findSealedTaskIds).mockResolvedValue([
      deletedTask.id,
    ]);
    vi.mocked(
      deps.taskArtifactRepository.listCleanupRefsForTasks,
    ).mockResolvedValue([
      {
        id: '22222222-2222-2222-2222-222222222225',
        taskId: deletedTask.id,
        objectKey: 'teams/t/artifacts/deleted-by-api',
        sizeBytes: 123,
      },
    ]);
    vi.mocked(
      deps.runtimeSessionRepository.listCleanupRefsForTasks,
    ).mockResolvedValue([
      {
        id: '33333333-3333-3333-3333-333333333336',
        taskId: deletedTask.id,
        objectKey: 'teams/t/sessions/deleted-by-api',
        sizeBytes: 456,
      },
    ]);
    vi.mocked(deps.taskRepository.deleteManyIfStatusIn).mockResolvedValue([
      deletedTask.id,
    ]);
    const { setMaintenanceDeps: setDeps } =
      await import('../src/workflows/maintenance.js');
    setDeps(deps);

    const workflow = registeredWorkflows['maintenance.taskDeletion'];
    if (!workflow) {
      throw new Error('task deletion workflow not registered');
    }
    const result = await workflow({
      ids: [deletedTask.id, liveTask.id],
      force: true,
      reason: 'operator confirmed sealed terminal cleanup',
      requestedBy: { id: AGENT_ID, ns: 'agent' },
    });

    expect(deps.taskRepository.lockIdsIfStatusIn).toHaveBeenCalledWith(
      [deletedTask.id],
      ['waiting', 'queued', 'completed', 'failed', 'cancelled', 'expired'],
    );
    expect(
      deps.taskRepository.deleteCorrelationSealsForTasks,
    ).toHaveBeenCalledWith([deletedTask.id]);
    expect(deps.runtimeSessionRepository.detachChildren).toHaveBeenCalledWith([
      '33333333-3333-3333-3333-333333333336',
    ]);
    expect(deps.taskRepository.deleteManyIfStatusIn).toHaveBeenCalledWith(
      [deletedTask.id],
      ['waiting', 'queued', 'completed', 'failed', 'cancelled', 'expired'],
    );
    expect(deps.taskRepository.deleteMany).not.toHaveBeenCalled();
    expect(deps.taskArtifactStorage.deleteObjects).toHaveBeenCalledWith([
      'teams/t/artifacts/deleted-by-api',
    ]);
    expect(deps.runtimeSessionStorage.deleteObjects).toHaveBeenCalledWith([
      'teams/t/sessions/deleted-by-api',
    ]);
    expect(deps.taskArtifactStorage.deleteObject).not.toHaveBeenCalled();
    expect(deps.runtimeSessionStorage.deleteObject).not.toHaveBeenCalled();
    expect(
      deps.relationshipWriter.removeTaskRelationsBatch,
    ).toHaveBeenCalledWith([
      {
        id: deletedTask.id,
        diaryId: deletedTask.diaryId,
        claimAgentId: deletedTask.claimAgentId,
      },
    ]);
    expect(result).toEqual({
      requested: 2,
      accepted: 1,
      skipped: [liveTask.id],
      deletedTaskCount: 1,
      deletedObjectCount: 2,
      skippedProtected: 0,
    });
  });

  it('task deletion workflow deletes queued tasks without force', async () => {
    await init();
    const { deps } = makeDeps([]);
    const queuedTask = {
      id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee7',
      status: 'queued',
      teamId: '99999999-9999-9999-9999-999999999999',
      diaryId: 'ffffffff-ffff-ffff-ffff-fffffffffff7',
      claimAgentId: null,
    } as unknown as Task;
    vi.mocked(deps.taskRepository.findByIds).mockResolvedValue([queuedTask]);
    vi.mocked(deps.taskRepository.findSealedTaskIds).mockResolvedValue([]);
    vi.mocked(
      deps.taskArtifactRepository.listCleanupRefsForTasks,
    ).mockResolvedValue([]);
    vi.mocked(
      deps.runtimeSessionRepository.listCleanupRefsForTasks,
    ).mockResolvedValue([]);
    vi.mocked(deps.taskRepository.deleteManyIfStatusIn).mockResolvedValue([
      queuedTask.id,
    ]);
    const { setMaintenanceDeps: setDeps } =
      await import('../src/workflows/maintenance.js');
    setDeps(deps);

    const workflow = registeredWorkflows['maintenance.taskDeletion'];
    if (!workflow) {
      throw new Error('task deletion workflow not registered');
    }
    const result = await workflow({
      ids: [queuedTask.id],
      force: false,
      requestedBy: { id: AGENT_ID, ns: 'agent' },
    });

    expect(
      deps.taskRepository.deleteCorrelationSealsForTasks,
    ).not.toHaveBeenCalled();
    expect(deps.taskRepository.deleteManyIfStatusIn).toHaveBeenCalledWith(
      [queuedTask.id],
      ['waiting', 'queued', 'completed', 'failed', 'cancelled', 'expired'],
    );
    expect(deps.taskRepository.deleteMany).not.toHaveBeenCalled();
    expect(
      deps.relationshipWriter.removeTaskRelationsBatch,
    ).toHaveBeenCalledWith([
      {
        id: queuedTask.id,
        diaryId: queuedTask.diaryId,
        claimAgentId: queuedTask.claimAgentId,
      },
    ]);
    expect(result).toEqual({
      requested: 1,
      accepted: 1,
      skipped: [],
      deletedTaskCount: 1,
      deletedObjectCount: 0,
      skippedProtected: 0,
    });
  });

  it('task deletion workflow skips tasks that become ineligible before atomic delete', async () => {
    await init();
    const { deps } = makeDeps([]);
    const queuedTask = {
      id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee8',
      status: 'queued',
      teamId: '99999999-9999-9999-9999-999999999999',
      diaryId: 'ffffffff-ffff-ffff-ffff-fffffffffff8',
      claimAgentId: null,
    } as unknown as Task;
    vi.mocked(deps.taskRepository.findByIds).mockResolvedValue([queuedTask]);
    vi.mocked(deps.taskRepository.findSealedTaskIds).mockResolvedValue([]);
    vi.mocked(
      deps.taskArtifactRepository.listCleanupRefsForTasks,
    ).mockResolvedValue([
      {
        taskId: queuedTask.id,
        objectKey: 'artifacts/raced',
        sizeBytes: 10,
      },
    ]);
    vi.mocked(
      deps.runtimeSessionRepository.listCleanupRefsForTasks,
    ).mockResolvedValue([
      {
        id: '11111111-1111-1111-1111-111111111111',
        taskId: queuedTask.id,
        objectKey: 'sessions/raced',
        sizeBytes: 10,
      },
    ]);
    vi.mocked(deps.taskRepository.lockIdsIfStatusIn).mockResolvedValue([]);
    vi.mocked(deps.taskRepository.deleteManyIfStatusIn).mockResolvedValue([]);
    const { setMaintenanceDeps: setDeps } =
      await import('../src/workflows/maintenance.js');
    setDeps(deps);

    const workflow = registeredWorkflows['maintenance.taskDeletion'];
    if (!workflow) {
      throw new Error('task deletion workflow not registered');
    }
    const result = await workflow({
      ids: [queuedTask.id],
      force: false,
      requestedBy: { id: AGENT_ID, ns: 'agent' },
    });

    expect(deps.taskRepository.lockIdsIfStatusIn).toHaveBeenCalledWith(
      [queuedTask.id],
      ['waiting', 'queued', 'completed', 'failed', 'cancelled', 'expired'],
    );
    expect(deps.taskRepository.deleteManyIfStatusIn).toHaveBeenCalledWith(
      [],
      ['waiting', 'queued', 'completed', 'failed', 'cancelled', 'expired'],
    );
    expect(deps.runtimeSessionRepository.detachChildren).toHaveBeenCalledWith(
      [],
    );
    expect(
      deps.relationshipWriter.removeTaskRelationsBatch,
    ).toHaveBeenCalledWith([]);
    expect(deps.taskArtifactStorage.deleteObjects).not.toHaveBeenCalled();
    expect(deps.runtimeSessionStorage.deleteObjects).not.toHaveBeenCalled();
    expect(result).toEqual({
      requested: 1,
      accepted: 1,
      skipped: [queuedTask.id],
      deletedTaskCount: 0,
      deletedObjectCount: 0,
      skippedProtected: 0,
    });
  });

  it('task deletion workflow skips a queued task that becomes sealed before atomic delete', async () => {
    await init();
    const { deps } = makeDeps([]);
    const queuedTask = {
      id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee10',
      status: 'queued',
      teamId: '99999999-9999-9999-9999-999999999999',
      diaryId: 'ffffffff-ffff-ffff-ffff-ffffffffff10',
      claimAgentId: null,
    } as unknown as Task;
    vi.mocked(deps.taskRepository.findByIds).mockResolvedValue([queuedTask]);
    vi.mocked(deps.taskRepository.findSealedTaskIds)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([queuedTask.id]);
    vi.mocked(
      deps.taskArtifactRepository.listCleanupRefsForTasks,
    ).mockResolvedValue([
      {
        taskId: queuedTask.id,
        objectKey: 'artifacts/sealed-race',
        sizeBytes: 10,
      },
    ]);
    vi.mocked(
      deps.runtimeSessionRepository.listCleanupRefsForTasks,
    ).mockResolvedValue([
      {
        id: '11111111-1111-1111-1111-111111111110',
        taskId: queuedTask.id,
        objectKey: 'sessions/sealed-race',
        sizeBytes: 10,
      },
    ]);
    vi.mocked(deps.taskRepository.deleteManyIfStatusIn).mockResolvedValue([]);
    const { setMaintenanceDeps: setDeps } =
      await import('../src/workflows/maintenance.js');
    setDeps(deps);

    const workflow = registeredWorkflows['maintenance.taskDeletion'];
    if (!workflow) {
      throw new Error('task deletion workflow not registered');
    }
    const result = await workflow({
      ids: [queuedTask.id],
      force: true,
      reason: 'operator cleanup request before seal race',
      requestedBy: { id: AGENT_ID, ns: 'agent' },
    });

    expect(deps.taskRepository.lockIdsIfStatusIn).toHaveBeenCalledWith(
      [queuedTask.id],
      ['waiting', 'queued', 'completed', 'failed', 'cancelled', 'expired'],
    );
    expect(
      deps.taskRepository.deleteCorrelationSealsForTasks,
    ).not.toHaveBeenCalled();
    expect(deps.taskRepository.deleteManyIfStatusIn).toHaveBeenCalledWith(
      [],
      ['waiting', 'queued', 'completed', 'failed', 'cancelled', 'expired'],
    );
    expect(deps.runtimeSessionRepository.detachChildren).toHaveBeenCalledWith(
      [],
    );
    expect(deps.taskArtifactStorage.deleteObjects).not.toHaveBeenCalled();
    expect(deps.runtimeSessionStorage.deleteObjects).not.toHaveBeenCalled();
    expect(result).toEqual({
      requested: 1,
      accepted: 1,
      skipped: [queuedTask.id],
      deletedTaskCount: 0,
      deletedObjectCount: 0,
      skippedProtected: 0,
    });
  });

  it('task deletion workflow does not delete force seals when locked delete set is empty', async () => {
    await init();
    const { deps } = makeDeps([]);
    const sealedTask = {
      id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee9',
      status: 'cancelled',
      diaryId: 'ffffffff-ffff-ffff-ffff-fffffffffff9',
      claimAgentId: null,
    } as unknown as Task;
    vi.mocked(deps.taskRepository.findByIds).mockResolvedValue([sealedTask]);
    vi.mocked(deps.taskRepository.findSealedTaskIds).mockResolvedValue([
      sealedTask.id,
    ]);
    vi.mocked(
      deps.taskArtifactRepository.listCleanupRefsForTasks,
    ).mockResolvedValue([]);
    vi.mocked(
      deps.runtimeSessionRepository.listCleanupRefsForTasks,
    ).mockResolvedValue([
      {
        id: '11111111-1111-1111-1111-111111111119',
        taskId: sealedTask.id,
        objectKey: 'sessions/sealed-raced',
        sizeBytes: 10,
      },
    ]);
    vi.mocked(deps.taskRepository.lockIdsIfStatusIn).mockResolvedValue([]);
    vi.mocked(deps.taskRepository.deleteManyIfStatusIn).mockResolvedValue([]);
    const { setMaintenanceDeps: setDeps } =
      await import('../src/workflows/maintenance.js');
    setDeps(deps);

    const workflow = registeredWorkflows['maintenance.taskDeletion'];
    if (!workflow) {
      throw new Error('task deletion workflow not registered');
    }
    const result = await workflow({
      ids: [sealedTask.id],
      force: true,
      reason: 'operator confirmed sealed terminal cleanup',
      requestedBy: { id: AGENT_ID, ns: 'agent' },
    });

    expect(deps.taskRepository.lockIdsIfStatusIn).toHaveBeenCalledWith(
      [sealedTask.id],
      ['waiting', 'queued', 'completed', 'failed', 'cancelled', 'expired'],
    );
    expect(
      deps.taskRepository.deleteCorrelationSealsForTasks,
    ).not.toHaveBeenCalled();
    expect(deps.taskRepository.deleteManyIfStatusIn).toHaveBeenCalledWith(
      [],
      ['waiting', 'queued', 'completed', 'failed', 'cancelled', 'expired'],
    );
    expect(deps.runtimeSessionRepository.detachChildren).toHaveBeenCalledWith(
      [],
    );
    expect(deps.runtimeSessionStorage.deleteObjects).not.toHaveBeenCalled();
    expect(result).toEqual({
      requested: 1,
      accepted: 1,
      skipped: [sealedTask.id],
      deletedTaskCount: 0,
      deletedObjectCount: 0,
      skippedProtected: 0,
    });
  });

  it('starts task deletion cleanup on the DBOS queue with exact-batch dedupe', async () => {
    await init();
    const { deps } = makeDeps([]);
    const {
      setMaintenanceDeps: setDeps,
      startTaskDeletionWorkflow: startDeletion,
    } = await import('../src/workflows/maintenance.js');
    setDeps(deps);

    await startDeletion(
      {
        ids: ['eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee5'],
        force: false,
        requestedBy: { id: AGENT_ID, ns: 'agent' },
      },
      'task-delete:test-workflow',
      'task-delete:test-dedupe',
    );

    expect(DBOS.startWorkflow).toHaveBeenCalledWith(
      registeredWorkflows['maintenance.taskDeletion'],
      {
        workflowID: 'task-delete:test-workflow',
        queueName: 'task-deletion-cleanup',
        enqueueOptions: {
          deduplicationID: 'task-delete:test-dedupe',
        },
      },
    );
  });

  // Suppress unused-variable warning on imports we use only via dynamic re-import.
  void initMaintenanceWorkflows;
  void setMaintenanceDeps;
});
