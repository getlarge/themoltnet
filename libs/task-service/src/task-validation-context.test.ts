import { KetoNamespace } from '@moltnet/auth';
import type { Task as DbTask } from '@moltnet/database';
import { describe, expect, it, vi } from 'vitest';

import { createAsyncValidationContextFactory } from './task-validation-context.js';

const CALLER_ID = 'a0000000-0000-0000-0000-000000000001';
const TASK_ID = '11111111-1111-1111-1111-111111111111';
const PACK_ID = '22222222-2222-4222-8222-222222222222';
const RENDERED_PACK_ID = '33333333-3333-4333-8333-333333333333';

function taskRow(id: string): DbTask {
  return {
    id,
    taskType: 'freeform',
    teamId: '00000000-0000-0000-0000-000000000001',
    diaryId: null,
    outputKind: 'artifact',
    input: {},
    inputSchemaCid: 'bafy-schema',
    inputCid: 'bafy-input',
    taskRefs: [],
    correlationId: null,
    proposedByAgentId: CALLER_ID,
    proposedByHumanId: null,
    acceptedAttemptN: null,
    claimCondition: null,
    requiredExecutorTrustLevel: 'self_declared',
    status: 'queued',
    queuedAt: new Date('2026-01-01T00:00:00Z'),
    completedAt: null,
    expiresAt: null,
    cancelledByAgentId: null,
    cancelledByHumanId: null,
    cancelReason: null,
    maxAttempts: 1,
    dispatchTimeoutSec: null,
    runningTimeoutSec: null,
  } as unknown as DbTask;
}

function makeContext(
  opts: {
    canViewTask?: boolean;
    canReadPack?: boolean;
    correlationRows?: DbTask[];
  } = {},
) {
  const deps = {
    taskRepository: {
      findById: vi.fn().mockResolvedValue(taskRow(TASK_ID)),
      listAttempts: vi.fn().mockResolvedValue([]),
      findByCorrelationId: vi
        .fn()
        .mockResolvedValue(opts.correlationRows ?? []),
    },
    contextPackRepository: {
      findById: vi.fn().mockResolvedValue({
        id: PACK_ID,
        packCid: 'bafy-pack',
        diaryId: 'd0000000-0000-0000-0000-000000000001',
      }),
    },
    renderedPackRepository: {
      findById: vi.fn().mockResolvedValue({
        id: RENDERED_PACK_ID,
        packCid: 'bafy-rendered',
        sourcePackId: PACK_ID,
        diaryId: 'd0000000-0000-0000-0000-000000000001',
      }),
    },
    correlationSealRepository: {
      findByCorrelationId: vi.fn().mockResolvedValue(null),
    },
    permissionChecker: {
      canViewTask: vi.fn().mockResolvedValue(opts.canViewTask ?? true),
      canViewTasks: vi
        .fn()
        .mockImplementation((taskIds: string[]) =>
          Promise.resolve(
            new Map(taskIds.map((taskId, index) => [taskId, index === 0])),
          ),
        ),
      canReadPack: vi.fn().mockResolvedValue(opts.canReadPack ?? true),
    },
  };

  return {
    deps,
    ctx: createAsyncValidationContextFactory(deps as never)(
      CALLER_ID,
      KetoNamespace.Agent,
    ),
  };
}

describe('createAsyncValidationContextFactory', () => {
  it('does not fetch task rows when the caller cannot view the task', async () => {
    const { ctx, deps } = makeContext({ canViewTask: false });

    await expect(ctx.resolveTask(TASK_ID)).resolves.toBeNull();

    expect(deps.permissionChecker.canViewTask).toHaveBeenCalledWith(
      TASK_ID,
      CALLER_ID,
      KetoNamespace.Agent,
    );
    expect(deps.taskRepository.findById).not.toHaveBeenCalled();
  });

  it('filters correlation task results through batched view permissions', async () => {
    const visible = taskRow('visible-task');
    const hidden = taskRow('hidden-task');
    const { ctx } = makeContext({ correlationRows: [visible, hidden] });

    const rows = await ctx.listTasksByCorrelation('corr-1');

    expect(rows.map((row) => row.id)).toEqual(['visible-task']);
  });

  it('checks rendered-pack visibility against the source pack', async () => {
    const { ctx, deps } = makeContext();

    await expect(
      ctx.resolveRenderedPack(RENDERED_PACK_ID),
    ).resolves.toMatchObject({
      id: RENDERED_PACK_ID,
      sourcePackId: PACK_ID,
    });
    expect(deps.permissionChecker.canReadPack).toHaveBeenCalledWith(
      PACK_ID,
      CALLER_ID,
      KetoNamespace.Agent,
    );
  });

  it('hides rendered packs when the source pack is not readable', async () => {
    const { ctx } = makeContext({ canReadPack: false });

    await expect(ctx.resolveRenderedPack(RENDERED_PACK_ID)).resolves.toBeNull();
  });
});
