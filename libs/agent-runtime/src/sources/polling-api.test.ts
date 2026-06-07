import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Agent, TasksNamespace } from '@themoltnet/sdk';
import { MoltNetError } from '@themoltnet/sdk';
import { describe, expect, it, vi } from 'vitest';

import type { AgentRuntimeLogger } from '../runtime.js';
import { makeFulfillBriefTask } from '../test-fixtures.js';
import type { ContinuationSlotRegistry } from './polling-api.js';
import {
  isContinuationClaimableByThisDaemon,
  PollingApiTaskSource,
} from './polling-api.js';

const silentLogger: AgentRuntimeLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};

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
      logger: silentLogger,
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
      logger: silentLogger,
    });

    const result = await src.claim();
    expect(result?.task.id).toBe(task.id);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('forwards provider and model to the list call when both are set', async () => {
    const list = vi
      .fn<TasksNamespace['list']>()
      .mockResolvedValue({ items: [], total: 0 });

    const src = new PollingApiTaskSource({
      agent: makeAgent(list, vi.fn()),
      teamId: 't',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      leaseTtlSec: 60,
      stopWhenEmpty: true,
    });

    await src.claim();
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
      }),
    );
  });

  it('throws when provider is set without model (or vice versa)', () => {
    expect(
      () =>
        new PollingApiTaskSource({
          agent: makeAgent(vi.fn(), vi.fn()),
          teamId: 't',
          provider: 'anthropic',
          // model intentionally unset
          leaseTtlSec: 60,
        }),
    ).toThrow(/provider and model must be set together/);
  });

  it('issues one list call with all task types when multiple are configured', async () => {
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
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ taskTypes: ['fulfill_brief', 'curate_pack'] }),
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

  it('drops pinned candidates whose allowedExecutors does not include the daemon pair — never claimed', async () => {
    // Pinned to a different model — daemon must skip silently, NOT claim
    // and then fail. The diaryIds-style filter at listCandidates is what
    // matters; the post-claim layer is gone.
    const pinnedForOtherModel = makeFulfillBriefTask({
      id: '11111111-1111-4111-8111-111111111111',
      status: 'queued',
      allowedExecutors: [{ provider: 'anthropic', model: 'claude-opus-4-7' }],
    });
    const unrestricted = makeFulfillBriefTask({
      id: '22222222-2222-4222-8222-222222222222',
      status: 'queued',
      allowedExecutors: [],
    });
    const list = vi.fn<TasksNamespace['list']>().mockResolvedValue({
      items: [pinnedForOtherModel, unrestricted],
      total: 2,
    });
    const claim = vi.fn<TasksNamespace['claim']>().mockResolvedValue({
      task: unrestricted,
      attempt: { taskId: unrestricted.id, attemptN: 1 } as never,
      traceHeaders: {},
    });

    const src = new PollingApiTaskSource({
      agent: makeAgent(list, claim),
      teamId: 't',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      leaseTtlSec: 60,
      stopWhenEmpty: true,
    });

    const result = await src.claim();
    expect(result?.task.id).toBe(unrestricted.id);
    // The pinned-for-other-model task must never have been claimed.
    expect(claim).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledWith(unrestricted.id, { leaseTtlSec: 60 });
  });

  it('keeps pinned candidates whose allowedExecutors includes the daemon pair', async () => {
    const pinnedForUs = makeFulfillBriefTask({
      id: '33333333-3333-4333-8333-333333333333',
      status: 'queued',
      allowedExecutors: [
        { provider: 'anthropic', model: 'claude-sonnet-4-5' },
        { provider: 'openai', model: 'gpt-5' },
      ],
    });
    const list = vi
      .fn<TasksNamespace['list']>()
      .mockResolvedValue({ items: [pinnedForUs], total: 1 });
    const claim = vi.fn<TasksNamespace['claim']>().mockResolvedValue({
      task: pinnedForUs,
      attempt: { taskId: pinnedForUs.id, attemptN: 1 } as never,
      traceHeaders: {},
    });

    const src = new PollingApiTaskSource({
      agent: makeAgent(list, claim),
      teamId: 't',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      leaseTtlSec: 60,
      stopWhenEmpty: true,
    });

    const result = await src.claim();
    expect(result?.task.id).toBe(pinnedForUs.id);
    expect(claim).toHaveBeenCalledTimes(1);
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

  it('continues scanning pages after locally unclaimable continuations', async () => {
    const skippedContinuation = makeFulfillBriefTask({
      id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
      taskType: 'freeform',
      status: 'queued',
      input: {
        brief: 'continue from a slot this daemon does not own',
        continueFrom: {
          taskId: '99999999-9999-4999-8999-999999999999',
          attemptN: 1,
        },
      },
    });
    const claimable = makeFulfillBriefTask({
      id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
      status: 'queued',
    });
    const list = vi
      .fn<TasksNamespace['list']>()
      .mockResolvedValueOnce({
        items: [skippedContinuation],
        nextCursor: 'page-2',
        total: 2,
      })
      .mockResolvedValueOnce({ items: [claimable], total: 2 });
    const claim = vi.fn<TasksNamespace['claim']>().mockResolvedValue({
      task: claimable,
      attempt: { taskId: claimable.id, attemptN: 1 } as never,
      traceHeaders: {},
    });
    const slotRegistry: ContinuationSlotRegistry = {
      findLatestProducerSlotByTaskAttempt: vi.fn().mockResolvedValue(null),
    };

    const src = new PollingApiTaskSource({
      agent: makeAgent(list, claim),
      teamId: 't',
      leaseTtlSec: 60,
      listLimit: 1,
      stopWhenEmpty: true,
      slotRegistry,
      logger: silentLogger,
    });

    const result = await src.claim();
    expect(result?.task.id).toBe(claimable.id);
    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: 'page-2' }),
    );
    expect(claim).toHaveBeenCalledOnce();
    expect(claim).toHaveBeenCalledWith(claimable.id, { leaseTtlSec: 60 });
  });

  it('drains only after all visible pages are locally unclaimable', async () => {
    const first = makeFulfillBriefTask({
      id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
      taskType: 'freeform',
      status: 'queued',
      input: {
        brief: 'missing slot 1',
        continueFrom: {
          taskId: '99999999-9999-4999-8999-999999999999',
          attemptN: 1,
        },
      },
    });
    const second = makeFulfillBriefTask({
      id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
      taskType: 'freeform',
      status: 'queued',
      input: {
        brief: 'missing slot 2',
        continueFrom: {
          taskId: '88888888-8888-4888-8888-888888888888',
          attemptN: 1,
        },
      },
    });
    const list = vi
      .fn<TasksNamespace['list']>()
      .mockResolvedValueOnce({
        items: [first],
        nextCursor: 'page-2',
        total: 2,
      })
      .mockResolvedValueOnce({ items: [second], total: 2 });
    const claim = vi.fn<TasksNamespace['claim']>();
    const slotRegistry: ContinuationSlotRegistry = {
      findLatestProducerSlotByTaskAttempt: vi.fn().mockResolvedValue(null),
    };

    const src = new PollingApiTaskSource({
      agent: makeAgent(list, claim),
      teamId: 't',
      leaseTtlSec: 60,
      listLimit: 1,
      stopWhenEmpty: true,
      slotRegistry,
      logger: silentLogger,
    });

    await expect(src.claim()).resolves.toBeNull();
    expect(list).toHaveBeenCalledTimes(2);
    expect(claim).not.toHaveBeenCalled();
  });
});

describe('isContinuationClaimableByThisDaemon', () => {
  function makeSlotRegistry(
    slot: { session?: { sessionDir?: string } } | null,
  ): ContinuationSlotRegistry {
    return {
      findLatestProducerSlotByTaskAttempt: vi.fn().mockReturnValue(slot),
    };
  }

  it('returns true for tasks without continueFrom', async () => {
    await expect(
      isContinuationClaimableByThisDaemon(
        { input: { brief: 'x' } } as never,
        makeSlotRegistry(null),
      ),
    ).resolves.toBe(true);
  });

  it('returns false when no slot exists for the source', async () => {
    await expect(
      isContinuationClaimableByThisDaemon(
        {
          input: {
            brief: 'x',
            continueFrom: { taskId: 'aaa', attemptN: 1 },
          },
        } as never,
        makeSlotRegistry(null),
      ),
    ).resolves.toBe(false);
  });

  it("returns false when slot exists but sessionDir doesn't exist on disk", async () => {
    const slot = { session: { sessionDir: '/tmp/does/not/exist-xyz-123' } };
    await expect(
      isContinuationClaimableByThisDaemon(
        {
          input: {
            brief: 'x',
            continueFrom: { taskId: 'aaa', attemptN: 1 },
          },
        } as never,
        makeSlotRegistry(slot),
      ),
    ).resolves.toBe(false);
  });

  it('returns true when slot + sessionDir both exist', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'session-'));
    const slot = { session: { sessionDir: tmpDir } };
    await expect(
      isContinuationClaimableByThisDaemon(
        {
          input: {
            brief: 'x',
            continueFrom: { taskId: 'aaa', attemptN: 1 },
          },
        } as never,
        makeSlotRegistry(slot),
      ),
    ).resolves.toBe(true);
  });
});
