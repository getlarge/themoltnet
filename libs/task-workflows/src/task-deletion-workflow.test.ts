import type {
  RuntimeSessionRepository,
  Task,
  TaskArtifactRepository,
  TaskRepository,
} from '@moltnet/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskCleanupManifest } from './task-cleanup-workflow-lib.js';
import {
  _resetTaskDeletionWorkflowForTesting,
  registerTaskDeletionWorkflow,
  type TaskDeletionWorkflowInput,
  type TaskDeletionWorkflowResult,
} from './task-deletion-workflow.js';

const { dbosMock, WorkflowQueueMock } = vi.hoisted(() => ({
  dbosMock: {
    workflowID: 'task-delete:test-workflow',
    registerStep: vi.fn(
      (fn: (...args: unknown[]) => unknown, _config: { name: string }) => fn,
    ),
    registerWorkflow: vi.fn(
      (fn: (...args: unknown[]) => unknown, _config: { name: string }) => fn,
    ),
    startWorkflow: vi.fn(),
  },
  WorkflowQueueMock: vi.fn(),
}));

vi.mock('@moltnet/database', () => {
  return {
    DBOS: dbosMock,
    WorkflowQueue: WorkflowQueueMock,
  };
});

const AGENT_ID = '22222222-2222-4222-8222-222222222202';
const TEAM_ID = '11111111-1111-4111-8111-111111111101';
const DIARY_ID = '33333333-3333-4333-8333-333333333303';

function task(id: string, status: Task['status']): Task {
  return {
    id,
    status,
    teamId: TEAM_ID,
    diaryId: DIARY_ID,
    claimAgentId: null,
  } as Task;
}

function latestRegisteredWorkflow(): (
  input: TaskDeletionWorkflowInput,
) => Promise<TaskDeletionWorkflowResult> {
  const calls = dbosMock.registerWorkflow.mock.calls;
  const [workflow] = calls[calls.length - 1] ?? [];
  if (!workflow) {
    throw new Error('task deletion workflow was not registered');
  }
  return workflow as (
    input: TaskDeletionWorkflowInput,
  ) => Promise<TaskDeletionWorkflowResult>;
}

describe('task deletion workflow', () => {
  beforeEach(() => {
    _resetTaskDeletionWorkflowForTesting();
    vi.clearAllMocks();
  });

  it('builds its manifest in task-workflows and deletes waiting/queued tasks through the guarded row step', async () => {
    const waitingTask = task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'waiting');
    const queuedTask = task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'queued');
    const runningTask = task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'running');
    const findByIds = vi
      .fn()
      .mockResolvedValue([waitingTask, queuedTask, runningTask]);
    const findSealedTaskIds = vi.fn().mockResolvedValue([]);
    const listTaskArtifactCleanupRefs = vi.fn().mockResolvedValue([
      {
        taskId: waitingTask.id,
        objectKey: 'artifacts/waiting.json',
        sizeBytes: 12,
      },
    ]);
    const listRuntimeSessionCleanupRefs = vi.fn().mockResolvedValue([
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
        taskId: queuedTask.id,
        objectKey: 'sessions/queued.jsonl.gz',
        sizeBytes: 24,
      },
    ]);
    const taskRepository = {
      findByIds,
      findSealedTaskIds,
    } as unknown as TaskRepository;
    const taskArtifactRepository = {
      listCleanupRefsForTasks: listTaskArtifactCleanupRefs,
    } as unknown as TaskArtifactRepository;
    const runtimeSessionRepository = {
      listCleanupRefsForTasks: listRuntimeSessionCleanupRefs,
    } as unknown as RuntimeSessionRepository;
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const deleteTaskRowsStep = vi.fn((manifest: TaskCleanupManifest) =>
      Promise.resolve(manifest),
    );
    const deleteTaskArtifactObjectsStep = vi.fn().mockResolvedValue(1);
    const deleteRuntimeSessionObjectsStep = vi.fn().mockResolvedValue(1);

    registerTaskDeletionWorkflow({
      getDeps: () => ({
        taskRepository,
        taskArtifactRepository,
        runtimeSessionRepository,
        logger,
      }),
      deleteTaskRowsStep,
      deleteTaskArtifactObjectsStep,
      deleteRuntimeSessionObjectsStep,
    });

    const workflow = latestRegisteredWorkflow();
    const result = await workflow({
      ids: [waitingTask.id, queuedTask.id, runningTask.id],
      force: false,
      requestedBy: { id: AGENT_ID, ns: 'agent' },
    });

    expect(findByIds).toHaveBeenCalledWith([
      waitingTask.id,
      queuedTask.id,
      runningTask.id,
    ]);
    expect(listTaskArtifactCleanupRefs).toHaveBeenCalledWith([
      waitingTask.id,
      queuedTask.id,
    ]);
    expect(listRuntimeSessionCleanupRefs).toHaveBeenCalledWith([
      waitingTask.id,
      queuedTask.id,
    ]);
    expect(deleteTaskRowsStep).toHaveBeenCalledWith(
      expect.objectContaining({
        tasks: [
          expect.objectContaining({ id: waitingTask.id }),
          expect.objectContaining({ id: queuedTask.id }),
        ],
      }),
      {
        deleteCorrelationSeals: false,
        onlyStatuses: [
          'waiting',
          'queued',
          'completed',
          'failed',
          'cancelled',
          'expired',
        ],
      },
    );
    expect(deleteTaskArtifactObjectsStep).toHaveBeenCalledOnce();
    expect(deleteRuntimeSessionObjectsStep).toHaveBeenCalledOnce();
    expect(result).toEqual({
      requested: 3,
      accepted: 2,
      skipped: [runningTask.id],
      deletedTaskCount: 2,
      deletedObjectCount: 2,
      skippedProtected: 0,
    });
  });
});
