import { collectWorkflowSpend, mergeProducerSpend } from '@moltnet/tasks';
import type { SdkTask } from '@themoltnet/tasks-orchestrator';
import { replayContext } from '@themoltnet/tasks-orchestrator/testing';
import { SuspendTask } from 'absurd-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runAdaptiveReview } from '../src/workflow.js';
import {
  IdempotentReviewTasks,
  reviewFixture,
  reviewOutput,
} from './recovery-fixture.js';

const fixtures: ReturnType<typeof reviewFixture>[] = [];
afterEach(() => {
  fixtures.splice(0).forEach((fixture) => fixture.close());
  vi.restoreAllMocks();
});
function fixture(change?: string) {
  const value = reviewFixture(change);
  fixtures.push(value);
  return value;
}

describe('adaptive coordinator replay', () => {
  it('reconciles creation after the API committed but before its checkpoint', async () => {
    const repo = fixture();
    const tasks = new IdempotentReviewTasks();
    const ctx = replayContext('execution-one');
    const complete = ctx.completeStep.bind(ctx);
    let interrupted = false;
    ctx.completeStep = (handle, value) => {
      if (!interrupted && handle.name.endsWith('.create')) {
        interrupted = true;
        throw new SuspendTask();
      }
      return complete(handle, value);
    };
    const options = { ...repo.options(tasks), ctx };
    await expect(runAdaptiveReview(options)).rejects.toBeInstanceOf(
      SuspendTask,
    );
    expect(tasks.created).toHaveLength(1);
    const first = tasks.requests[0];
    ctx.resetForReplay();
    const report = await runAdaptiveReview(options);
    expect(tasks.requests[1]).toEqual(first);
    expect(tasks.created).toHaveLength(3);
    expect(report.taskIds).toEqual([
      ...new Set(tasks.requests.map((request) => request.id)),
    ]);
  });

  it('reuses a waiting task and a finished parallel lane after interruption', async () => {
    const repo = fixture();
    const tasks = new IdempotentReviewTasks();
    const ctx = replayContext('execution-two');
    let pause = true;
    const getTask = tasks.getTask.bind(tasks);
    tasks.getTask = async (id) => {
      const task = await getTask(id);
      return pause && task.tags.includes('lane:conventions')
        ? ({ ...task, status: 'running', acceptedAttemptN: null } as SdkTask)
        : task;
    };
    const sleeps: string[] = [];
    ctx.sleepFor = (name) => {
      sleeps.push(name);
      return Promise.reject(new SuspendTask());
    };
    const options = { ...repo.options(tasks), ctx };
    await expect(runAdaptiveReview(options)).rejects.toBeInstanceOf(
      SuspendTask,
    );
    expect(ctx.checkpointNames).toContain('review.lane.tests.result');
    expect(sleeps).toEqual(['review.lanes.poll']);
    expect(tasks.created).toHaveLength(3);
    const ids = tasks.requests.map((request) => request.id);
    pause = false;
    ctx.resetForReplay();
    const report = await runAdaptiveReview(options);
    expect(tasks.requests).toHaveLength(3);
    expect(report.taskIds).toEqual(ids);
    expect(report.results.every((lane) => lane.status === 'clear')).toBe(true);
  });

  it('retains bounded repairs and task IDs when resuming inside a correction', async () => {
    const repo = fixture();
    const tasks = new IdempotentReviewTasks((body) =>
      body.tags?.includes('lane:tests')
        ? {
            result: {
              summary: 'Invalid until repair budget exhausted',
              findings: [
                { path: 'example.ts', line: 999, concern: 'Invalid citation' },
              ],
              unclear: [],
            },
          }
        : reviewOutput(body),
    );
    const attempts = tasks.listAttempts.bind(tasks);
    tasks.listAttempts = async (id) =>
      (await attempts(id)).map((attempt) => ({
        ...attempt,
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          cost: {
            currency: 'USD',
            total: 0.25,
            input: 0.2,
            output: 0.05,
            cacheRead: 0,
            cacheWrite: 0,
            complete: true,
          },
        },
      }));
    const ctx = replayContext('execution-three');
    const complete = ctx.completeStep.bind(ctx);
    let interrupted = false;
    ctx.completeStep = (handle, value) => {
      if (!interrupted && handle.name.includes(':repair:1.create')) {
        interrupted = true;
        throw new SuspendTask();
      }
      return complete(handle, value);
    };
    const options = { ...repo.options(tasks), ctx };
    await expect(runAdaptiveReview(options)).rejects.toBeInstanceOf(
      SuspendTask,
    );
    ctx.resetForReplay();
    const report = await runAdaptiveReview(options);
    const lane = report.results.find((item) => item.lane === 'tests');
    expect(lane?.status).toBe('failed');
    expect(
      tasks.created.filter((body) => body.tags?.includes('lane:tests')),
    ).toHaveLength(3);
    expect(new Set(lane?.taskIds).size).toBe(3);
    expect(tasks.requests).toHaveLength(6); // five tasks, one repeated crash-gap request
    const requests = tasks.requests.length;
    ctx.resetForReplay();
    expect(await runAdaptiveReview(options)).toEqual(report);
    expect(tasks.requests).toHaveLength(requests);
    const spend = await collectWorkflowSpend(
      report.taskIds.map((taskId) => ({ taskId, stage: 'review' })),
      (id) => tasks.listAttempts(id),
    );
    expect(
      mergeProducerSpend(spend.records.map((record) => record.spend)),
    ).toMatchObject({
      attempts: 5,
      inputTokens: 500,
      outputTokens: 100,
      estimatedCostUsd: 1.25,
      costComplete: true,
    });
  });

  it('does not renew the classifier stage deadline while the coordinator is absent', async () => {
    const repo = fixture(
      Array.from(
        { length: 1500 },
        (_, i) => `export const value${i} = 'a sizeable source change';`,
      ).join('\n'),
    );
    const tasks = new IdempotentReviewTasks();
    const ctx = replayContext('deadline');
    const complete = ctx.completeStep.bind(ctx);
    let interrupted = false;
    ctx.completeStep = async (handle, value) => {
      const result = await complete(handle, value);
      if (!interrupted && handle.name === 'routing.classifier.1.result') {
        interrupted = true;
        throw new SuspendTask();
      }
      return result;
    };
    const options = { ...repo.options(tasks), ctx };
    await expect(runAdaptiveReview(options)).rejects.toBeInstanceOf(
      SuspendTask,
    );
    expect(tasks.created).toHaveLength(1);
    const deadline = ctx.checkpointEntries.find(
      ([name]) => name === 'routing.classifier.deadline',
    )?.[1] as number;
    vi.spyOn(Date, 'now').mockReturnValue(deadline + 1);
    ctx.resetForReplay();
    const report = await runAdaptiveReview(options);
    expect(report.packetCount).toBeGreaterThan(1);
    expect(
      tasks.created.filter((body) => body.taskType === 'classify'),
    ).toHaveLength(1);
    expect(tasks.requests).toHaveLength(3);
    expect(report.taskIds[0]).toBe(tasks.requests[0].id);
    expect(
      report.gaps.some((gap) => gap.includes('Classifier time budget reached')),
    ).toBe(true);
  });

  it('rejects changed pinned inputs before replaying a completed execution', async () => {
    const repo = fixture();
    const tasks = new IdempotentReviewTasks();
    const ctx = replayContext('pin-inputs');
    const options = { ...repo.options(tasks), ctx };
    await runAdaptiveReview(options);
    for (const change of [
      { profiles: { focused: 'different' } },
      { profileRevisions: { reviewer: 2 } },
      { identity: { ...options.identity, head: 'c'.repeat(40) } },
      { identity: { ...options.identity, repo: 'wrong/repository' } },
      {
        taskBudgets: {
          ...options.taskBudgets,
          classifier: {
            ...options.taskBudgets.classifier,
            runningTimeoutSec: 1,
          },
        },
      },
      { runtimeSha: 'd'.repeat(40) },
    ]) {
      ctx.resetForReplay();
      await expect(
        runAdaptiveReview({ ...options, ...change }),
      ).rejects.toThrow('incompatible pinned inputs');
    }
    expect(tasks.created).toHaveLength(3);
  });

  it('allocates distinct submissions for an intentional new review', async () => {
    const repo = fixture();
    const tasks = new IdempotentReviewTasks();
    const first = await runAdaptiveReview({
      ...repo.options(tasks),
      ctx: replayContext('first'),
    });
    const options = repo.options(tasks);
    const second = await runAdaptiveReview({
      ...options,
      identity: { ...options.identity, correlationId: 'new-review' },
      ctx: replayContext('second'),
    });
    expect(tasks.created).toHaveLength(6);
    expect(first.taskIds.some((id) => second.taskIds.includes(id))).toBe(false);
  });
});
