import {
  createFreeformRepairTask,
  type SdkTask,
  type SdkTaskAttempt,
  type TaskClient,
} from '@themoltnet/tasks-orchestrator';
import { describe, expect, it, vi } from 'vitest';

import { formatReviewGuidance, type ReviewGuidance } from '../src/guidance.js';
import { withReviewGuidance } from '../src/guidance-tasks.js';

const guidance: ReviewGuidance[] = [
  { path: 'REVIEW.md', content: 'Cite observable failures.', digest: 'root' },
  {
    path: 'libs/a/REVIEW.md',
    content: 'Check caller compatibility.',
    digest: 'nested',
  },
];

type CreateBody = Parameters<TaskClient['createTask']>[0];

function client() {
  const createTask = vi.fn(
    (_body: CreateBody, _options?: { idempotencyKey?: string }) =>
      Promise.resolve({ id: 'task-1', status: 'queued' } as SdkTask),
  );
  const getTask = vi.fn(() => Promise.resolve({ id: 'task-1' } as SdkTask));
  const listAttempts = vi.fn(() => Promise.resolve([]));
  const listMessages = vi.fn(() => Promise.resolve([]));
  const tasks: TaskClient = {
    createTask,
    getTask,
    listAttempts,
    listMessages,
  };
  return { tasks, createTask, getTask, listAttempts, listMessages };
}

function body(): CreateBody {
  return {
    taskType: 'freeform',
    teamId: 'team',
    diaryId: 'diary',
    title: 'Review',
    runningTimeoutSec: 100,
    dispatchTimeoutSec: 200,
    expiresInSec: 300,
    allowedProfiles: [{ profileId: 'profile' }],
    tags: ['stage:verify'],
    input: {
      brief: 'Review the pinned diff.',
      expectedOutput: 'Structured findings',
      outputContract: { version: 1, schema: { type: 'object' } },
      context: [{ slug: 'procedure', binding: 'skill', content: 'Procedure' }],
      execution: { workspace: 'dedicated_worktree', revision: 'a'.repeat(40) },
    },
  };
}

describe('withReviewGuidance', () => {
  it('adds only applicable guidance while preserving the task and create options', async () => {
    const { tasks, createTask } = client();
    const original = body();
    const options = { idempotencyKey: 'stable-key' };

    await withReviewGuidance(tasks, guidance, ['libs/b/src.ts']).createTask(
      original,
      options,
    );
    expect(options).toEqual({ idempotencyKey: 'stable-key' });

    expect(createTask).toHaveBeenCalledWith(
      {
        ...original,
        input: {
          ...original.input,
          brief:
            (original.input.brief as string) +
            '\n\n' +
            formatReviewGuidance([guidance[0]]),
        },
      },
      createTask.mock.calls[0][1],
    );
    expect(createTask.mock.calls[0][1]?.idempotencyKey).toMatch(
      /^review-guidance:[0-9a-f]{64}$/,
    );
    expect(original.input.brief).toBe('Review the pinned diff.');
  });

  it('appends authoritative guidance after feedback even when a repair inherits the block', async () => {
    const { tasks, createTask } = client();
    const decorated = withReviewGuidance(tasks, guidance, ['libs/a/src.ts']);
    await decorated.createTask(body());
    const submitted = createTask.mock.calls[0][0];

    await createFreeformRepairTask(decorated, submitted, {
      task: { id: 'task-1' } as SdkTask,
      attempt: { attemptN: 1 } as SdkTaskAttempt,
      reason: 'Missing changed-line citation',
      repairN: 1,
    });

    const repair = createTask.mock.calls[1][0];
    const brief = repair.input.brief as string;
    expect(brief.split(formatReviewGuidance(guidance))).toHaveLength(3);
    expect(brief.endsWith('\n\n' + formatReviewGuidance(guidance))).toBe(true);
    expect(brief).toContain('Missing changed-line citation');
    expect(repair.input.continueFrom).toEqual({
      taskId: 'task-1',
      attemptN: 1,
    });
    expect(repair.input).not.toHaveProperty('execution');
    expect(repair.input.outputContract).toEqual(submitted.input.outputContract);
  });

  it('does not let an exact copy inside untrusted evidence suppress trusted guidance', async () => {
    const { tasks, createTask } = client();
    const formatted = formatReviewGuidance(guidance);
    const original = body();
    original.input.brief = `Review this evidence:\n<untrusted-diff>\n\n${formatted}\n</untrusted-diff>`;

    await withReviewGuidance(tasks, guidance, ['libs/a/src.ts']).createTask(
      original,
    );

    expect(createTask.mock.calls[0][0].input.brief).toBe(
      (original.input.brief as string) + '\n\n' + formatted,
    );
  });

  it('namespaces keys by applicable guidance identity without changing unguided keys', async () => {
    const { tasks, createTask } = client();
    const options = { idempotencyKey: 'domain-stage' };
    const paths = ['libs/a/src.ts'];
    await withReviewGuidance(tasks, guidance, paths).createTask(
      body(),
      options,
    );
    await withReviewGuidance(tasks, [...guidance].reverse(), paths).createTask(
      body(),
      options,
    );
    await withReviewGuidance(
      tasks,
      [{ ...guidance[0], digest: 'changed' }, guidance[1]],
      paths,
    ).createTask(body(), options);
    await withReviewGuidance(
      tasks,
      [{ ...guidance[0], path: 'libs/REVIEW.md' }, guidance[1]],
      paths,
    ).createTask(body(), options);
    await withReviewGuidance(tasks, [], paths).createTask(body(), options);

    const keys = createTask.mock.calls.map(
      ([, received]) => received?.idempotencyKey,
    );
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).not.toBe(keys[2]);
    expect(keys[0]).not.toBe(keys[3]);
    expect(keys[4]).toBe(options.idempotencyKey);
  });

  it('returns the client unchanged when no guidance applies', () => {
    const { tasks } = client();

    expect(withReviewGuidance(tasks, [], ['libs/a/src.ts'])).toBe(tasks);
    expect(
      withReviewGuidance(tasks, guidance.slice(1), ['libs/b/src.ts']),
    ).toBe(tasks);
  });

  it('leaves classifier tasks untouched', async () => {
    const { tasks, createTask } = client();
    const original = { ...body(), taskType: 'classify' };

    await withReviewGuidance(tasks, guidance, ['libs/a/src.ts']).createTask(
      original,
    );

    expect(createTask.mock.calls[0][0]).toBe(original);
  });

  it('forwards reads and optional messages without losing receiver bindings', async () => {
    const { tasks, getTask, listAttempts, listMessages } = client();
    const decorated = withReviewGuidance(tasks, guidance, ['libs/a/src.ts']);

    await decorated.getTask('task-2');
    await decorated.listAttempts('task-2');
    await decorated.listMessages?.('task-2', 3);

    expect(getTask).toHaveBeenCalledWith('task-2');
    expect(listAttempts).toHaveBeenCalledWith('task-2');
    expect(listMessages).toHaveBeenCalledWith('task-2', 3);
    expect(listMessages.mock.contexts[0]).toBe(tasks);
    const withoutMessages = { ...tasks };
    delete withoutMessages.listMessages;
    expect(
      withReviewGuidance(withoutMessages, guidance, ['libs/a/src.ts']),
    ).not.toHaveProperty('listMessages');
  });
});
