import { describe, expect, it, vi } from 'vitest';

import taskWait from '../src/nodes/task-wait.js';
import { FakeRed } from './fake-red.js';
import { agentStub, deferred } from './node-test-utils.js';

describe('moltnet-task-wait', () => {
  it('emits the terminal snapshot on output 2 when already settled', async () => {
    const agent = {
      tasks: {
        get: () =>
          Promise.resolve({
            id: 't1',
            status: 'completed',
            acceptedAttemptN: 1,
          }),
        listAttempts: () =>
          Promise.resolve([
            {
              attemptN: 1,
              status: 'completed',
              output: { phase: 'pr_open', prNumber: 42 },
              error: null,
            },
          ]),
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(taskWait);
    red.create('moltnet-agent', 'a1');
    const node = red.create('moltnet-task-wait', 'n1', {
      agent: 'a1',
      taskId: 't1',
    });

    const { outputs } = await red.input(node, {});

    // Single send of [tail=null, result=msg].
    expect(outputs).toHaveLength(1);
    const [tail, result] = outputs[0] as unknown as [
      unknown,
      { payload: Record<string, unknown>; taskId?: string },
    ];
    expect(tail).toBeNull();
    expect(result.payload).toMatchObject({
      accepted: true,
      state: { phase: 'pr_open', prNumber: 42 },
    });
    expect(result.taskId).toBe('t1');
  });

  it('tails new messages before the terminal result', async () => {
    const agent = {
      tasks: {
        get: () =>
          Promise.resolve({
            id: 't1',
            status: 'completed',
            acceptedAttemptN: 1,
          }),
        listAttempts: () =>
          Promise.resolve([
            { attemptN: 1, status: 'completed', output: {}, error: null },
          ]),
        listMessages: () =>
          Promise.resolve([
            {
              taskId: 't1',
              attemptN: 1,
              kind: 'text_delta',
              seq: 1,
              payload: { text: 'hi' },
            },
            {
              taskId: 't1',
              attemptN: 1,
              kind: 'turn_end',
              seq: 2,
              payload: {},
            },
          ]),
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(taskWait);
    red.create('moltnet-agent', 'a1');
    const node = red.create('moltnet-task-wait', 'n1', {
      agent: 'a1',
      taskId: 't1',
      tail: true,
    });

    const { outputs } = await red.input(node, { correlationId: 'corr-1' });

    // Two tail sends ([msg, null]) then one result send ([null, msg]).
    expect(outputs).toHaveLength(3);
    const kinds = outputs
      .slice(0, 2)
      .map(
        (o) =>
          (o as unknown as [{ payload: { kind: string } }, null])[0].payload
            .kind,
      );
    expect(kinds).toEqual(['text_delta', 'turn_end']);
    expect(
      (
        outputs[0] as unknown as [{ payload: { correlationId: string } }, null]
      )[0].payload.correlationId,
    ).toBe('corr-1');
    const result = (
      outputs[2] as unknown as [null, { payload: Record<string, unknown> }]
    )[1];
    expect(result.payload).toMatchObject({
      accepted: true,
      correlationId: 'corr-1',
    });
  });

  it('shows active wait count when one node handles parallel tasks', async () => {
    const firstGet = deferred<{
      id: string;
      status: 'completed';
      acceptedAttemptN: number;
    }>();
    const secondGet = deferred<{
      id: string;
      status: 'completed';
      acceptedAttemptN: number;
    }>();
    const gets: string[] = [];
    const agent = {
      tasks: {
        get: (taskId: string) => {
          gets.push(taskId);
          return taskId === 'task-correctness'
            ? firstGet.promise
            : secondGet.promise;
        },
        listAttempts: (taskId: string) =>
          Promise.resolve([
            {
              attemptN: 1,
              status: 'completed',
              output: { taskId },
              error: null,
            },
          ]),
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(taskWait);
    red.create('moltnet-agent', 'a1');
    const node = red.create('moltnet-task-wait', 'n1', { agent: 'a1' });

    const p1 = red.input(node, {
      payload: { id: 'task-correctness' },
      reviewDimension: 'correctness',
    });
    const p2 = red.input(node, {
      payload: { id: 'task-security' },
      reviewDimension: 'security',
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(node.statuses.map((s) => s.text)).toContain(
      'waiting · security · 2 active',
    );

    secondGet.resolve({
      id: 'task-security',
      status: 'completed',
      acceptedAttemptN: 1,
    });
    firstGet.resolve({
      id: 'task-correctness',
      status: 'completed',
      acceptedAttemptN: 1,
    });
    await Promise.all([p1, p2]);

    expect(node.statuses.map((s) => s.text)).toContain(
      'completed ok · security · 1 active',
    );
    expect(node.statuses.at(-1)?.text).toBe('completed ok · correctness');
  });

  it('surfaces the failing attempt error on a failed task', async () => {
    const agent = {
      tasks: {
        get: () =>
          Promise.resolve({
            id: 't9',
            status: 'failed',
            acceptedAttemptN: null,
          }),
        listAttempts: () =>
          Promise.resolve([
            {
              attemptN: 1,
              status: 'failed',
              output: null,
              error: { code: 'boom', message: 'kaboom', retryable: true },
            },
          ]),
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(taskWait);
    red.create('moltnet-agent', 'a1');
    const node = red.create('moltnet-task-wait', 'n1', {
      agent: 'a1',
      taskId: 't9',
    });

    const { outputs } = await red.input(node, {});

    const result = (
      outputs[0] as unknown as [null, { payload: Record<string, unknown> }]
    )[1];
    expect(result.payload).toMatchObject({
      accepted: false,
      status: 'failed',
      error: { code: 'boom', message: 'kaboom', retryable: true },
    });
  });

  it('accepts legacy intervalMs wait-node configs', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const agent = {
        tasks: {
          get: () => {
            calls += 1;
            return Promise.resolve({
              id: 't1',
              status: calls === 1 ? 'running' : 'completed',
              acceptedAttemptN: calls === 1 ? null : 1,
            });
          },
          listAttempts: () =>
            Promise.resolve([
              {
                attemptN: 1,
                status: 'completed',
                output: { ok: true },
                error: null,
              },
            ]),
        },
      };
      const red = new FakeRed();
      red.load(agentStub(agent));
      red.load(taskWait);
      red.create('moltnet-agent', 'a1');
      const node = red.create('moltnet-task-wait', 'n1', {
        agent: 'a1',
        taskId: 't1',
        intervalMs: 1000,
      });

      const waiting = red.input(node, {});
      await vi.advanceTimersByTimeAsync(1000);
      const { outputs } = await waiting;

      expect(calls).toBe(2);
      const result = (
        outputs[0] as unknown as [null, { payload: Record<string, unknown> }]
      )[1];
      expect(result.payload).toMatchObject({
        accepted: true,
        state: { ok: true },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
