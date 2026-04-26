import type { Agent, TasksNamespace } from '@themoltnet/sdk';
import { MoltNetError } from '@themoltnet/sdk';
import { describe, expect, it, vi } from 'vitest';

import { makeFulfillBriefTask } from '../test-fixtures.js';
import { PollingApiTaskSource } from './polling-api.js';

function makeAgent(
  list: TasksNamespace['list'],
  claim: TasksNamespace['claim'],
): Agent {
  return { tasks: { list, claim } } as unknown as Agent;
}

describe('PollingApiTaskSource', () => {
  it('claims the first listed task and returns it', async () => {
    const task = makeFulfillBriefTask({ status: 'queued' });
    const list = vi
      .fn<TasksNamespace['list']>()
      .mockResolvedValue({ items: [task], total: 1 });
    const claim = vi.fn<TasksNamespace['claim']>().mockResolvedValue({
      task,
      attempt: { taskId: task.id, attemptN: 1 } as never,
      traceHeaders: { traceparent: '00-x-y-01' },
    });

    const src = new PollingApiTaskSource({
      agent: makeAgent(list, claim),
      teamId: 'team-1',
      leaseTtlSec: 60,
      stopWhenEmpty: true,
    });

    const result = await src.claim();
    expect(result).toEqual({
      task,
      attemptN: 1,
      traceHeaders: { traceparent: '00-x-y-01' },
    });
    expect(list).toHaveBeenCalledWith({
      teamId: 'team-1',
      status: 'queued',
      limit: 10,
    });
    expect(claim).toHaveBeenCalledWith(task.id, { leaseTtlSec: 60 });
  });

  it('skips a 409 (race lost) and tries the next candidate', async () => {
    const a = makeFulfillBriefTask({
      id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
      status: 'queued',
    });
    const b = makeFulfillBriefTask({
      id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
      status: 'queued',
    });
    const list = vi
      .fn<TasksNamespace['list']>()
      .mockResolvedValue({ items: [a, b], total: 2 });
    const claim = vi
      .fn<TasksNamespace['claim']>()
      .mockRejectedValueOnce(
        new MoltNetError('race lost', { code: 'CONFLICT', statusCode: 409 }),
      )
      .mockResolvedValueOnce({
        task: b,
        attempt: { taskId: b.id, attemptN: 1 } as never,
        traceHeaders: {},
      });

    const src = new PollingApiTaskSource({
      agent: makeAgent(list, claim),
      teamId: 't',
      leaseTtlSec: 60,
      stopWhenEmpty: true,
      log: () => {},
    });

    const result = await src.claim();
    expect(result?.task.id).toBe(b.id);
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it('returns null on empty queue when stopWhenEmpty is true', async () => {
    const list = vi
      .fn<TasksNamespace['list']>()
      .mockResolvedValue({ items: [], total: 0 });

    const src = new PollingApiTaskSource({
      agent: makeAgent(list, vi.fn()),
      teamId: 't',
      leaseTtlSec: 60,
      stopWhenEmpty: true,
    });

    await expect(src.claim()).resolves.toBeNull();
  });

  it('does NOT exit drain mode on a transient list error — keeps polling until queue is confirmed empty', async () => {
    // First list call rejects (transient 5xx), second call returns empty.
    // Drain mode must keep polling through the error rather than treating
    // it as "queue empty" and bailing out early.
    const task = makeFulfillBriefTask({ status: 'queued' });
    const list = vi
      .fn<TasksNamespace['list']>()
      .mockRejectedValueOnce(
        new MoltNetError('boom', { code: 'INTERNAL', statusCode: 500 }),
      )
      .mockResolvedValueOnce({ items: [task], total: 1 });
    const claim = vi.fn<TasksNamespace['claim']>().mockResolvedValue({
      task,
      attempt: { taskId: task.id, attemptN: 1 } as never,
      traceHeaders: {},
    });

    const src = new PollingApiTaskSource({
      agent: makeAgent(list, claim),
      teamId: 't',
      leaseTtlSec: 60,
      stopWhenEmpty: true,
      // Tiny backoff so the test doesn't sit in real wall-clock sleep.
      pollIntervalMs: 1,
      maxPollIntervalMs: 2,
      log: () => {},
    });

    const result = await src.claim();
    expect(result?.task.id).toBe(task.id);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('issues one list call per task type when multiple are configured', async () => {
    const list = vi
      .fn<TasksNamespace['list']>()
      .mockResolvedValue({ items: [], total: 0 });

    const src = new PollingApiTaskSource({
      agent: makeAgent(list, vi.fn()),
      teamId: 't',
      taskTypes: ['fulfill_brief', 'curate_pack'],
      leaseTtlSec: 60,
      stopWhenEmpty: true,
    });

    await src.claim();
    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ taskType: 'fulfill_brief' }),
    );
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ taskType: 'curate_pack' }),
    );
  });

  it('returns null promptly when the abort signal fires', async () => {
    const ac = new AbortController();
    ac.abort();
    const list = vi.fn<TasksNamespace['list']>();

    const src = new PollingApiTaskSource({
      agent: makeAgent(list, vi.fn()),
      teamId: 't',
      leaseTtlSec: 60,
      signal: ac.signal,
    });

    await expect(src.claim()).resolves.toBeNull();
    expect(list).not.toHaveBeenCalled();
  });

  it('propagates non-conflict claim errors', async () => {
    const task = makeFulfillBriefTask({ status: 'queued' });
    const list = vi
      .fn<TasksNamespace['list']>()
      .mockResolvedValue({ items: [task], total: 1 });
    const claim = vi
      .fn<TasksNamespace['claim']>()
      .mockRejectedValue(
        new MoltNetError('boom', { code: 'INTERNAL', statusCode: 500 }),
      );

    const src = new PollingApiTaskSource({
      agent: makeAgent(list, claim),
      teamId: 't',
      leaseTtlSec: 60,
      stopWhenEmpty: true,
    });

    await expect(src.claim()).rejects.toThrow('boom');
  });

  it('drops candidates not matching diaryIds filter', async () => {
    const matching = makeFulfillBriefTask({
      id: 'cccccccc-3333-4333-8333-cccccccccccc',
      status: 'queued',
      diaryId: 'diary-keep',
    });
    const other = makeFulfillBriefTask({
      id: 'dddddddd-4444-4444-8444-dddddddddddd',
      status: 'queued',
      diaryId: 'diary-skip',
    });
    const list = vi
      .fn<TasksNamespace['list']>()
      .mockResolvedValue({ items: [other, matching], total: 2 });
    const claim = vi.fn<TasksNamespace['claim']>().mockResolvedValue({
      task: matching,
      attempt: { taskId: matching.id, attemptN: 1 } as never,
      traceHeaders: {},
    });

    const src = new PollingApiTaskSource({
      agent: makeAgent(list, claim),
      teamId: 't',
      diaryIds: ['diary-keep'],
      leaseTtlSec: 60,
      stopWhenEmpty: true,
    });

    const result = await src.claim();
    expect(result?.task.id).toBe(matching.id);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledWith(matching.id, { leaseTtlSec: 60 });
  });
});
