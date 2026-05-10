import type * as Database from '@moltnet/database';
import type { Task, TaskAttempt } from '@moltnet/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type DatabaseModule = typeof Database;

// Mock DBOS BEFORE importing the module under test. We capture each
// registered workflow/step by name so the test can drive the sweeper
// directly without a live DBOS runtime.
const registeredWorkflows: Record<string, (...args: unknown[]) => unknown> = {};
const registeredSteps: Record<string, (...args: unknown[]) => unknown> = {};
const registeredScheduled: Record<string, unknown> = {};

vi.mock('@moltnet/database', async () => {
  const actual = await vi.importActual<DatabaseModule>('@moltnet/database');
  return {
    ...actual,
    DBOS: {
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
      registerScheduled: vi.fn(
        (workflow: unknown, config: { name: string }) => {
          registeredScheduled[config.name] = workflow;
        },
      ),
      startWorkflow: vi.fn(
        (fn: (...args: unknown[]) => unknown) =>
          (...args: unknown[]) =>
            fn(...args),
      ),
      resumeWorkflow: vi.fn(),
    },
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
  const relationshipWriter = {
    removeTaskClaimant: vi.fn().mockResolvedValue(undefined),
  };
  const deps = {
    nonceRepository: {} as unknown,
    contextPackRepository: {} as unknown,
    renderedPackRepository: {} as unknown,
    taskRepository,
    dataSource,
    relationshipWriter,
    logger,
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

  async function init(): Promise<DatabaseModule['DBOS']> {
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
      },
    );
    const { DBOS } = await import('@moltnet/database');
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

  // Suppress unused-variable warning on imports we use only via dynamic re-import.
  void initMaintenanceWorkflows;
  void setMaintenanceDeps;
});
