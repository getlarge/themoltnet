import { describe, expect, it } from 'vitest';

import tasksList from '../src/nodes/tasks-list.js';
import { FakeRed } from './fake-red.js';
import { agentStub } from './node-test-utils.js';

describe('moltnet-tasks-list', () => {
  it('lists tasks with configured filters and payload overrides', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const seenOptions: Array<Record<string, unknown>> = [];
    const agent = {
      tasks: {
        list: (
          query: Record<string, unknown>,
          options: Record<string, unknown>,
        ) => {
          seen.push(query);
          seenOptions.push(options);
          return Promise.resolve({
            total: 1,
            nextCursor: 'next-1',
            items: [{ id: 't1', status: 'queued' }],
          });
        },
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(tasksList);
    const a = red.create('moltnet-agent', 'a1');
    (a as Record<string, unknown>).teamId = 'team-1';
    const node = red.create('moltnet-tasks-list', 'n1', {
      agent: 'a1',
      statusList: 'waiting, queued',
      taskTypes: 'fulfill_brief',
      tags: 'issue,triage',
      hasAttempts: 'true',
      limit: 20,
    });

    const { outputs } = await red.input(node, {
      payload: { limit: 5, correlationId: 'corr-1' },
    });

    expect(seen).toEqual([
      {
        statuses: ['waiting', 'queued'],
        taskTypes: ['fulfill_brief'],
        tags: ['issue', 'triage'],
        hasAttempts: true,
        limit: 5,
        correlationId: 'corr-1',
      },
    ]);
    expect(seenOptions).toEqual([{ teamId: 'team-1' }]);
    expect(outputs[0].payload).toEqual([{ id: 't1', status: 'queued' }]);
    expect(outputs[0].tasks).toEqual({
      total: 1,
      nextCursor: 'next-1',
      query: seen[0],
    });
  });

  it('passes the full task query filter surface', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const agent = {
      tasks: {
        list: (query: Record<string, unknown>) => {
          seen.push(query);
          return Promise.resolve({ total: 0, items: [] });
        },
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(tasksList);
    const a = red.create('moltnet-agent', 'a1');
    (a as Record<string, unknown>).teamId = 'team-1';
    const node = red.create('moltnet-tasks-list', 'n1', {
      agent: 'a1',
      status: 'claimed',
      excludeTags: 'done,stale',
      profileId: 'profile-1',
      correlationId: 'corr-config',
      diaryId: 'diary-1',
      proposedByAgentId: 'agent-1',
      proposedByHumanId: 'human-1',
      claimedByAgentId: 'agent-2',
      hasAttempts: 'false',
      queuedAfter: '2026-06-01T00:00:00Z',
      queuedBefore: '2026-06-02T00:00:00Z',
      completedAfter: '2026-06-03T00:00:00Z',
      completedBefore: '2026-06-04T00:00:00Z',
      cursor: 'cursor-1',
    });

    await red.input(node, {
      payload: {
        correlationId: 'corr-payload',
        hasAttempts: true,
      },
    });

    expect(seen).toEqual([
      {
        status: 'claimed',
        excludeTags: ['done', 'stale'],
        profileId: 'profile-1',
        correlationId: 'corr-payload',
        diaryId: 'diary-1',
        proposedByAgentId: 'agent-1',
        proposedByHumanId: 'human-1',
        claimedByAgentId: 'agent-2',
        hasAttempts: true,
        queuedAfter: '2026-06-01T00:00:00Z',
        queuedBefore: '2026-06-02T00:00:00Z',
        completedAfter: '2026-06-03T00:00:00Z',
        completedBefore: '2026-06-04T00:00:00Z',
        cursor: 'cursor-1',
      },
    ]);
  });

  it('errors when the agent has no team context', async () => {
    const red = new FakeRed();
    red.load(agentStub({ tasks: { list: () => Promise.resolve({}) } }));
    red.load(tasksList);
    red.create('moltnet-agent', 'a1');
    const node = red.create('moltnet-tasks-list', 'n1', { agent: 'a1' });

    await expect(red.input(node, {})).rejects.toThrow(
      /agent teamId is required/,
    );
  });
});
