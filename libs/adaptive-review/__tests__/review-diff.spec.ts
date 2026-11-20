import { execFileSync } from 'node:child_process';

import type { TaskClient } from '@themoltnet/tasks-orchestrator';
import { describe, expect, it, vi } from 'vitest';

import { withPinnedReviewDiff } from '../src/review-diff.js';
import { scopedReviewTasks } from '../src/review-tasks.js';
import { IdempotentReviewTasks, reviewFixture } from './recovery-fixture.js';

describe('bound pinned review diff', () => {
  it('binds exact Git bytes, restages on crash-gap retries, and preserves task identity and scope', async () => {
    const repo = reviewFixture();
    try {
      const client = new IdempotentReviewTasks();
      const stage = vi.spyOn(client, 'stageArtifact');
      const tasks = withPinnedReviewDiff(
        scopedReviewTasks(client, {
          teamId: 'team',
          diaryId: 'diary',
          correlationId: 'review',
        }),
        {
          git: (args) =>
            execFileSync('git', args, { cwd: repo.cwd, encoding: 'utf8' }),
          base: repo.base,
          head: repo.head,
        },
      );
      const body = {
        taskType: 'freeform',
        title: 'Review',
        teamId: 'team',
        diaryId: 'diary',
        tags: [],
        input: {
          brief: 'Inspect the pinned changes',
          execution: { revision: repo.head },
        },
      } satisfies Parameters<TaskClient['createTask']>[0];
      const first = await tasks.createTask(body, {
        idempotencyKey: 'same-create',
      });
      const again = await tasks.createTask(body, {
        idempotencyKey: 'same-create',
      });
      expect(again.id).toBe(first.id);
      // Class-backed clients keep prototype methods through the wrapper too.
      const direct = withPinnedReviewDiff(client, {
        git: () => '',
        base: repo.base,
        head: repo.head,
      });
      expect((await direct.getTask(first.id)).id).toBe(first.id);
      expect(stage).toHaveBeenCalledTimes(2);
      expect(stage.mock.calls[0]).toEqual(stage.mock.calls[1]);
      expect(stage.mock.calls[0][2]).toEqual({ teamId: 'team' });
      const artifact = JSON.parse(String(stage.mock.calls[0][0]));
      expect(artifact).toMatchObject({
        version: 1,
        base: repo.base,
        head: repo.head,
        files: [{ path: 'example.ts' }],
      });
      expect(artifact.files[0].patch).toContain('+export const value = 2;');
      expect(client.created).toHaveLength(1);
      expect(client.created[0].references).toMatchObject([
        {
          taskId: null,
          role: 'reviewed_diff',
          artifact: { kind: 'pinned-review-diff-v1' },
        },
      ]);
      expect(client.created[0].input.brief).toContain('git_diff');
      expect(body.input.brief).toBe('Inspect the pinned changes');
    } finally {
      repo.close();
    }
  });

  it('fails before creating a paid task when diff staging or bounded evidence is unavailable', async () => {
    const createTask = vi.fn();
    const body = {
      taskType: 'freeform',
      teamId: 'team',
      diaryId: 'diary',
      input: { brief: 'Review' },
    } satisfies Parameters<TaskClient['createTask']>[0];
    const pins = { base: 'a'.repeat(40), head: 'b'.repeat(40) };
    await expect(
      withPinnedReviewDiff({ createTask } as unknown as TaskClient, {
        ...pins,
        git: () => '',
      }).createTask(body),
    ).rejects.toThrow('staging');
    const stageArtifact = vi.fn();
    const tasks = withPinnedReviewDiff(
      { createTask, stageArtifact } as unknown as TaskClient,
      {
        ...pins,
        git: (args) =>
          args.includes('--name-only')
            ? 'huge.ts\0'
            : 'diff --git a/huge.ts b/huge.ts\n+' + 'x'.repeat(8 * 1024 * 1024),
      },
    );
    await expect(tasks.createTask(body)).rejects.toThrow('8 MiB');
    expect(stageArtifact).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
  });
});
