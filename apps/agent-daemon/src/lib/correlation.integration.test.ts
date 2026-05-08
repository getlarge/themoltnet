/**
 * Integration test: finalizeTask → makePrBodyAnchorWriter → fake GhPrClient
 * → appendPrBodyMarker, with no mocks above the gh seam. Verifies the
 * full local pipeline that turns a fulfilled task output into a PR body
 * containing the correlation marker.
 */
import type { Task, TaskOutput } from '@moltnet/tasks';
import type { Agent } from '@themoltnet/sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  CORRELATION_MARKER_RE,
  makePrBodyAnchorWriter,
} from './correlation.js';
import { finalizeTask } from './finalize.js';

describe('finalizeTask + PR body writer (integration)', () => {
  it('mutates the PR body via gh.patch with a marker for the task correlationId', async () => {
    const correlationId = '11111111-2222-4333-8444-555555555555';
    const task = {
      id: 'task-1',
      taskType: 'fulfill_brief',
      correlationId,
    } as unknown as Task;

    const initialBody = 'PR description.';
    let storedBody = initialBody;
    const get = vi.fn(async () => ({ body: storedBody }));
    const patch = vi.fn(async (_coords: unknown, body: string) => {
      storedBody = body;
    });

    const writer = makePrBodyAnchorWriter({
      gh: { get, patch },
      logger: { warn: vi.fn(), info: vi.fn() },
    });

    const completed = vi.fn().mockResolvedValue(undefined);
    const agent = {
      tasks: { complete: completed, fail: vi.fn() },
    } as unknown as Agent;

    const output: TaskOutput = {
      taskId: 'task-1',
      attemptN: 1,
      status: 'completed',
      output: {
        branch: `moltnet/${correlationId}/x`,
        commits: [],
        pullRequestUrl: 'https://github.com/o/r/pull/9',
        diaryEntryIds: [],
        summary: 's',
      },
      outputCid: 'cid:abc',
      usage: { inputTokens: 0, outputTokens: 0 },
      durationMs: 0,
    };

    await finalizeTask(agent, output, {
      task,
      writeCorrelationAnchors: writer,
    });

    expect(completed).toHaveBeenCalled();
    expect(get).toHaveBeenCalledWith({ owner: 'o', repo: 'r', number: 9 });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(storedBody).toContain('PR description.');
    expect(storedBody).toMatch(CORRELATION_MARKER_RE);
    const m = storedBody.match(CORRELATION_MARKER_RE);
    expect(m?.[1]).toBe(correlationId);
  });

  it('is a no-op on a second finalize for the same correlationId (idempotent)', async () => {
    const correlationId = '22222222-3333-4444-8555-666666666666';
    const task = {
      id: 'task-2',
      taskType: 'fulfill_brief',
      correlationId,
    } as unknown as Task;

    const storedBody: string | null =
      `body\n\n<!-- moltnet-correlation: ${correlationId} -->`;
    const get = vi.fn(async () => ({ body: storedBody }));
    const patch = vi.fn();

    const writer = makePrBodyAnchorWriter({
      gh: { get, patch },
      logger: { warn: vi.fn(), info: vi.fn() },
    });

    const agent = {
      tasks: {
        complete: vi.fn().mockResolvedValue(undefined),
        fail: vi.fn(),
      },
    } as unknown as Agent;

    await finalizeTask(
      agent,
      {
        taskId: 'task-2',
        attemptN: 1,
        status: 'completed',
        output: { pullRequestUrl: 'https://github.com/o/r/pull/3' },
        outputCid: 'cid:abc',
        usage: { inputTokens: 0, outputTokens: 0 },
        durationMs: 0,
      },
      { task, writeCorrelationAnchors: writer },
    );

    expect(patch).not.toHaveBeenCalled();
  });
});
