import { describe, expect, it } from 'vitest';

import taskArtifactsList from '../src/nodes/task-artifacts-list.js';
import { FakeRed } from './fake-red.js';
import { agentStub } from './node-test-utils.js';

describe('moltnet-task-artifacts-list', () => {
  it('lists task artifacts with pagination and team context', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const agent = {
      tasks: {
        artifacts: {
          listPage: (
            taskId: string,
            query: Record<string, unknown>,
            options: Record<string, unknown>,
          ) => {
            seen.push({ taskId, query, options });
            return Promise.resolve({
              artifacts: [{ cid: 'bafy-output', kind: 'output' }],
              nextCursor: 'cursor-2',
            });
          },
        },
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(taskArtifactsList);
    const a = red.create('moltnet-agent', 'a1');
    (a as Record<string, unknown>).teamId = 'team-1';
    const node = red.create('moltnet-task-artifacts-list', 'n1', {
      agent: 'a1',
      taskId: 'task-config',
      limit: 20,
    });

    const { outputs } = await red.input(node, {
      payload: { taskId: 'task-1', limit: 5, cursor: 'cursor-1' },
    });

    expect(seen).toEqual([
      {
        taskId: 'task-1',
        query: { limit: 5, cursor: 'cursor-1' },
        options: { teamId: 'team-1' },
      },
    ]);
    expect(outputs[0].payload).toEqual([
      { cid: 'bafy-output', kind: 'output' },
    ]);
    expect(outputs[0].artifacts).toEqual({
      taskId: 'task-1',
      teamId: 'team-1',
      query: { limit: 5, cursor: 'cursor-1' },
      count: 1,
      nextCursor: 'cursor-2',
      page: {
        artifacts: [{ cid: 'bafy-output', kind: 'output' }],
        nextCursor: 'cursor-2',
      },
    });
  });

  it('emits an empty list with pagination metadata', async () => {
    const agent = {
      tasks: {
        artifacts: {
          listPage: () =>
            Promise.resolve({ artifacts: [], nextCursor: undefined }),
        },
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(taskArtifactsList);
    const a = red.create('moltnet-agent', 'a1');
    (a as Record<string, unknown>).teamId = 'team-1';
    const node = red.create('moltnet-task-artifacts-list', 'n1', {
      agent: 'a1',
      taskId: 'task-1',
    });

    const { outputs } = await red.input(node, {});

    expect(outputs[0].payload).toEqual([]);
    expect(outputs[0].artifacts).toMatchObject({
      count: 0,
      nextCursor: undefined,
    });
  });

  it('ignores msg team override unless explicitly enabled', async () => {
    const seenOptions: Array<Record<string, unknown>> = [];
    const agent = {
      tasks: {
        artifacts: {
          listPage: (
            _taskId: string,
            _query: Record<string, unknown>,
            options: Record<string, unknown>,
          ) => {
            seenOptions.push(options);
            return Promise.resolve({ artifacts: [] });
          },
        },
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(taskArtifactsList);
    const a = red.create('moltnet-agent', 'a1');
    (a as Record<string, unknown>).teamId = 'team-agent';
    const locked = red.create('moltnet-task-artifacts-list', 'locked', {
      agent: 'a1',
      taskId: 'task-1',
    });
    const unlocked = red.create('moltnet-task-artifacts-list', 'unlocked', {
      agent: 'a1',
      taskId: 'task-1',
      allowMsgTeamOverride: true,
    });

    await red.input(locked, { payload: { teamId: 'team-msg' } });
    await red.input(unlocked, { payload: { teamId: 'team-msg' } });

    expect(seenOptions).toEqual([
      { teamId: 'team-agent' },
      { teamId: 'team-msg' },
    ]);
  });

  it('errors when task id is missing', async () => {
    const red = new FakeRed();
    red.load(
      agentStub({
        tasks: { artifacts: { listPage: () => Promise.resolve({}) } },
      }),
    );
    red.load(taskArtifactsList);
    const a = red.create('moltnet-agent', 'a1');
    (a as Record<string, unknown>).teamId = 'team-1';
    const node = red.create('moltnet-task-artifacts-list', 'n1', {
      agent: 'a1',
    });

    await expect(red.input(node, { payload: {} })).rejects.toThrow(
      /taskId is required/,
    );
  });
});
