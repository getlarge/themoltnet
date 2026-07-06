import { describe, expect, it, vi } from 'vitest';

import taskCancel from '../src/nodes/task-cancel.js';
import { FakeRed } from './fake-red.js';
import { agentStub } from './node-test-utils.js';

describe('moltnet-task-cancel', () => {
  it('cancels every task row on msg.payload and preserves the payload', async () => {
    const cancelled: Array<{ id: string; reason: string }> = [];
    const agent = {
      tasks: {
        cancel: (id: string, body: { reason: string }) => {
          cancelled.push({ id, reason: body.reason });
          return Promise.resolve({ id, status: 'cancelled' });
        },
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(taskCancel);
    red.create('moltnet-agent', 'a1');
    const node = red.create('moltnet-task-cancel', 'n1', {
      agent: 'a1',
      reason: 'workflow failed',
    });
    const payload = [
      { id: 'task-1', status: 'running' },
      { taskId: 'task-2', status: 'queued' },
    ];

    const { outputs } = await red.input(node, { payload });

    expect(cancelled).toEqual([
      { id: 'task-1', reason: 'workflow failed' },
      { id: 'task-2', reason: 'workflow failed' },
    ]);
    expect(outputs[0].payload).toEqual(payload);
    expect(outputs[0].cancelledTasks).toEqual([
      { id: 'task-1', status: 'cancelled' },
      { id: 'task-2', status: 'cancelled' },
    ]);
  });

  it('passes through without a task id when configured for cleanup lanes', async () => {
    const red = new FakeRed();
    red.load(agentStub({ tasks: { cancel: vi.fn() } }));
    red.load(taskCancel);
    red.create('moltnet-agent', 'a1');
    const node = red.create('moltnet-task-cancel', 'n1', {
      agent: 'a1',
      skipMissing: true,
    });

    const { outputs } = await red.input(node, {
      payload: { workflowStatus: 'failed' },
    });

    expect(outputs[0].payload).toEqual({ workflowStatus: 'failed' });
    expect(outputs[0].cancelledTasks).toEqual([]);
  });

  it('records ignored cancel failures without masking the inbound message', async () => {
    const agent = {
      tasks: {
        cancel: (id: string) =>
          id === 'task-1'
            ? Promise.resolve({ id, status: 'cancelled' })
            : Promise.reject(new Error('already terminal')),
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(taskCancel);
    red.create('moltnet-agent', 'a1');
    const node = red.create('moltnet-task-cancel', 'n1', {
      agent: 'a1',
      ignoreErrors: true,
    });

    const { outputs } = await red.input(node, {
      payload: [{ id: 'task-1' }, { id: 'task-2' }],
    });

    expect(outputs[0].cancelledTasks).toEqual([
      { id: 'task-1', status: 'cancelled' },
    ]);
    expect(outputs[0].cancelErrors).toEqual([
      { taskId: 'task-2', message: 'already terminal' },
    ]);
  });

  it('errors when no task id can be resolved by default', async () => {
    const red = new FakeRed();
    red.load(agentStub({ tasks: { cancel: vi.fn() } }));
    red.load(taskCancel);
    red.create('moltnet-agent', 'a1');
    const node = red.create('moltnet-task-cancel', 'n1', { agent: 'a1' });

    await expect(red.input(node, { payload: {} })).rejects.toThrow(
      /taskId is required/,
    );
  });
});
