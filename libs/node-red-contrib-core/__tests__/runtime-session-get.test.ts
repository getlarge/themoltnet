import { describe, expect, it } from 'vitest';

import runtimeSessionGet from '../src/nodes/runtime-session-get.js';
import { FakeRed } from './fake-red.js';
import { agentStub } from './node-test-utils.js';

describe('moltnet-runtime-session-get', () => {
  it('gets runtime session metadata with team context', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const agent = {
      runtimeSessions: {
        getForAttempt: (
          ref: Record<string, unknown>,
          options: Record<string, unknown>,
        ) => {
          seen.push({ ref, options });
          return Promise.resolve({ id: 'session-1', sha256: 'sha' });
        },
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(runtimeSessionGet);
    const a = red.create('moltnet-agent', 'a1');
    (a as Record<string, unknown>).teamId = 'team-1';
    const node = red.create('moltnet-runtime-session-get', 'n1', {
      agent: 'a1',
      taskId: 'task-1',
      attemptN: 2,
    });

    const { outputs } = await red.input(node, {});

    expect(seen).toEqual([
      {
        ref: { taskId: 'task-1', attemptN: 2 },
        options: { teamId: 'team-1' },
      },
    ]);
    expect(outputs[0].payload).toEqual({ id: 'session-1', sha256: 'sha' });
    expect(outputs[0].runtimeSession).toEqual({
      taskId: 'task-1',
      teamId: 'team-1',
      attemptN: 2,
      session: { id: 'session-1', sha256: 'sha' },
    });
  });
});
