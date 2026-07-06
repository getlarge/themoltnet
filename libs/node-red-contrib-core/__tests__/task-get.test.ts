import { describe, expect, it } from 'vitest';

import taskGet from '../src/nodes/task-get.js';
import { FakeRed } from './fake-red.js';
import { agentStub } from './node-test-utils.js';

describe('moltnet-task-get', () => {
  it('folds task + attempts into an accepted snapshot', async () => {
    const agent = {
      tasks: {
        get: () =>
          Promise.resolve({
            id: 't1',
            status: 'completed',
            acceptedAttemptN: 2,
          }),
        listAttempts: () =>
          Promise.resolve([
            { attemptN: 1, status: 'failed', output: null, error: null },
            {
              attemptN: 2,
              status: 'completed',
              output: { phase: 'classified', decision: 'plan' },
              error: null,
            },
          ]),
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(taskGet);
    red.create('moltnet-agent', 'a1');
    const node = red.create('moltnet-task-get', 'n1', { agent: 'a1' });

    const { outputs } = await red.input(node, { payload: { id: 't1' } });

    const snap = outputs[0].payload as Record<string, unknown>;
    expect(snap).toMatchObject({
      taskId: 't1',
      status: 'completed',
      terminal: true,
      accepted: true,
      acceptedAttemptN: 2,
      state: { phase: 'classified', decision: 'plan' },
    });
  });

  it('reports not-accepted when acceptedAttemptN is null', async () => {
    const agent = {
      tasks: {
        get: () =>
          Promise.resolve({
            id: 't2',
            status: 'running',
            acceptedAttemptN: null,
          }),
        listAttempts: () =>
          Promise.resolve([
            { attemptN: 1, status: 'running', output: null, error: null },
          ]),
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(taskGet);
    red.create('moltnet-agent', 'a1');
    const node = red.create('moltnet-task-get', 'n1', {
      taskId: 't2',
      agent: 'a1',
    });

    const { outputs } = await red.input(node, {});

    const snap = outputs[0].payload as Record<string, unknown>;
    expect(snap).toMatchObject({
      accepted: false,
      terminal: false,
      state: null,
    });
  });

  it('errors (via done) when no taskId can be resolved', async () => {
    const red = new FakeRed();
    red.load(agentStub({ tasks: {} }));
    red.load(taskGet);
    red.create('moltnet-agent', 'a1');
    const node = red.create('moltnet-task-get', 'n1', { agent: 'a1' });

    await expect(red.input(node, { payload: {} })).rejects.toThrow(
      /taskId is required/,
    );
  });
});
