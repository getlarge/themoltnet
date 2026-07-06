import { KetoNamespace } from '@moltnet/auth';
import type { NewTask, Task as DbTask } from '@moltnet/database';
import { initTaskTypeRegistry } from '@moltnet/tasks';
import * as Format from 'typebox/format';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { createTaskService } from './task.service.js';

const TEAM_ID = '00000000-0000-0000-0000-000000000001';
const DIARY_ID = 'd0000000-0000-0000-0000-000000000001';
const AGENT_ID = 'a0000000-0000-0000-0000-000000000001';
const TASK_ID = '11111111-1111-4111-8111-111111111111';

beforeAll(async () => {
  Format.Set('uuid', (v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  );
  await initTaskTypeRegistry();
});

function createIntegrationDeps() {
  const tasks = new Map<string, DbTask>();
  const grants = {
    parent: vi.fn<(taskId: string, diaryId: string) => Promise<void>>(),
    removed: vi.fn<
      (
        rows: Array<{
          id: string;
          diaryId: string | null;
          claimAgentId?: string | null;
        }>,
      ) => Promise<void>
    >(),
  };

  const taskRepository = {
    create: vi.fn((newTask: NewTask) => {
      const row = {
        id: TASK_ID,
        ...newTask,
        title: newTask.title ?? null,
        tags: newTask.tags ?? [],
        taskRefs: newTask.taskRefs ?? [],
        correlationId: newTask.correlationId ?? null,
        acceptedAttemptN: null,
        allowedProfiles: newTask.allowedProfiles ?? [],
        queuedAt: new Date('2026-07-06T08:00:00Z'),
        completedAt: null,
        expiresAt: newTask.expiresAt ?? null,
        cancelledByAgentId: null,
        cancelledByHumanId: null,
        cancelReason: null,
      } as DbTask;
      tasks.set(row.id, row);
      return Promise.resolve(row);
    }),
    findById: vi.fn((id: string) => Promise.resolve(tasks.get(id) ?? null)),
    findByIds: vi.fn((ids: string[]) =>
      Promise.resolve(
        ids
          .map((id) => tasks.get(id))
          .filter((row): row is DbTask => row !== undefined),
      ),
    ),
    list: vi.fn((opts: { teamId: string }) =>
      Promise.resolve({
        items: [...tasks.values()].filter((row) => row.teamId === opts.teamId),
        nextCursor: undefined,
      }),
    ),
    count: vi.fn((opts: { teamId: string }) =>
      Promise.resolve(
        [...tasks.values()].filter((row) => row.teamId === opts.teamId).length,
      ),
    ),
    updateMetadata: vi.fn(
      (id: string, metadata: { title?: string | null; tags?: string[] }) => {
        const row = tasks.get(id);
        if (!row) return Promise.resolve(null);
        const updated = { ...row, ...metadata } as DbTask;
        tasks.set(id, updated);
        return Promise.resolve(updated);
      },
    ),
    findSealedTaskIds: vi.fn(() => Promise.resolve([] as string[])),
    deleteCorrelationSealsForTasks: vi.fn(() => Promise.resolve(undefined)),
    deleteMany: vi.fn((ids: string[]) => {
      const deleted: string[] = [];
      for (const id of ids) {
        if (tasks.delete(id)) deleted.push(id);
      }
      return Promise.resolve(deleted);
    }),
    findByCorrelationId: vi.fn((correlationId: string) =>
      Promise.resolve(
        [...tasks.values()].filter(
          (row) => row.correlationId === correlationId,
        ),
      ),
    ),
    listAttempts: vi.fn(() => Promise.resolve([])),
    listMessages: vi.fn(() => Promise.resolve({ items: [] })),
  };

  return {
    tasks,
    grants,
    deps: {
      taskRepository,
      diaryRepository: {
        findById: vi.fn(() =>
          Promise.resolve({ id: DIARY_ID, teamId: TEAM_ID }),
        ),
      },
      agentRepository: {
        findByIdentityId: vi.fn(),
      },
      runtimeProfileRepository: {
        findById: vi.fn(),
      },
      contextPackRepository: {
        findById: vi.fn(),
      },
      renderedPackRepository: {
        findById: vi.fn(),
      },
      correlationSealRepository: {
        acquireCorrelationLock: vi.fn(() => Promise.resolve(undefined)),
        findByCorrelationId: vi.fn(() => Promise.resolve(null)),
        create: vi.fn(() => Promise.resolve(undefined)),
        deleteBySealingTaskId: vi.fn(() => Promise.resolve(null)),
      },
      permissionChecker: {
        canProposeTask: vi.fn(() => Promise.resolve(true)),
        canAccessTeam: vi.fn(() => Promise.resolve(true)),
        canViewTask: vi.fn(() => Promise.resolve(true)),
        canViewTasks: vi.fn((ids: string[]) =>
          Promise.resolve(new Map(ids.map((id) => [id, true]))),
        ),
        canEditTaskMetadata: vi.fn(() => Promise.resolve(true)),
        canDeleteTasks: vi.fn((ids: string[]) =>
          Promise.resolve(new Map(ids.map((id) => [id, true]))),
        ),
        canForceDeleteTasks: vi.fn(() =>
          Promise.resolve(new Map<string, boolean>()),
        ),
        canReadPack: vi.fn(() => Promise.resolve(true)),
        canClaimTask: vi.fn(() => Promise.resolve(true)),
      },
      relationshipWriter: {
        grantTaskParent: grants.parent.mockResolvedValue(undefined),
        grantTaskClaimant: vi.fn(() => Promise.resolve(undefined)),
        removeTaskRelationsBatch: grants.removed.mockResolvedValue(undefined),
      },
      transactionRunner: {
        runInTransaction: vi.fn((fn: () => Promise<unknown>) => fn()),
      },
      enqueueWorkflowInCurrentTransaction: vi.fn(() =>
        Promise.resolve({
          workflowId: `task:${TASK_ID}:attempt:1`,
        }),
      ),
      logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    },
  };
}

describe('createTaskService composition integration', () => {
  it('composes create, query, metadata, and delete modules through the public service', async () => {
    const { deps, grants, tasks } = createIntegrationDeps();
    const service = createTaskService(deps as never);

    const created = await service.create({
      taskType: 'fulfill_brief',
      title: '  Ship task service split  ',
      tags: ['refactor', 'tests', 'refactor'],
      teamId: TEAM_ID,
      diaryId: DIARY_ID,
      inputPayload: { brief: 'Split task.service.ts into focused modules.' },
      callerId: AGENT_ID,
      callerNs: KetoNamespace.Agent,
      callerIsAgent: true,
    });

    expect(created).toMatchObject({
      id: TASK_ID,
      taskType: 'fulfill_brief',
      title: 'Ship task service split',
      tags: ['refactor', 'tests'],
      status: 'queued',
    });
    expect(grants.parent).toHaveBeenCalledWith(TASK_ID, DIARY_ID);

    await expect(
      service.get(TASK_ID, AGENT_ID, KetoNamespace.Agent),
    ).resolves.toMatchObject({ id: TASK_ID });
    await expect(
      service.list({
        teamId: TEAM_ID,
        callerId: AGENT_ID,
        callerNs: KetoNamespace.Agent,
      }),
    ).resolves.toMatchObject({ total: 1 });

    await expect(
      service.updateMetadata(TASK_ID, {
        title: 'Clean split',
        tags: ['service'],
        callerId: AGENT_ID,
        callerNs: KetoNamespace.Agent,
      }),
    ).resolves.toMatchObject({ title: 'Clean split', tags: ['service'] });

    tasks.set(TASK_ID, {
      ...tasks.get(TASK_ID)!,
      status: 'completed',
      completedAt: new Date('2026-07-06T08:05:00Z'),
    });
    await expect(
      service.planDeleteMany({
        ids: [TASK_ID],
        callerId: AGENT_ID,
        callerNs: KetoNamespace.Agent,
      }),
    ).resolves.toEqual({ accepted: [TASK_ID], skipped: [] });
    await expect(
      service.deleteMany({
        ids: [TASK_ID],
        callerId: AGENT_ID,
        callerNs: KetoNamespace.Agent,
      }),
    ).resolves.toEqual({ deleted: [TASK_ID], skipped: [] });
    expect(grants.removed).toHaveBeenCalledWith([
      { id: TASK_ID, diaryId: DIARY_ID, claimAgentId: undefined },
    ]);
    expect(tasks.has(TASK_ID)).toBe(false);
  });
});
