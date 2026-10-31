import { describe, expect, it } from 'vitest';

import workflowStatus from '../src/nodes/workflow-status.js';
import { FakeRed } from './fake-red.js';
import { agentStub } from './node-test-utils.js';

describe('moltnet-workflow-status', () => {
  it('maps a workflow run’s tasks to table rows by correlationId', async () => {
    const seen: Array<{ correlationId?: string; limit?: number }> = [];
    const seenOptions: Array<{ teamId?: string }> = [];
    const agent = {
      teamId: 'team-1',
      tasks: {
        list: (
          query: { correlationId?: string; limit?: number },
          options: { teamId?: string },
        ) => {
          seen.push(query);
          seenOptions.push(options);
          return Promise.resolve({
            total: 2,
            items: [
              {
                id: 't1',
                taskType: 'freeform',
                title: 'triage',
                status: 'completed',
                queuedAt: '2026-06-23T00:00:00Z',
                completedAt: '2026-06-23T00:05:00Z',
              },
              {
                id: 't2',
                taskType: 'freeform',
                title: null,
                status: 'running',
                queuedAt: '2026-06-23T00:06:00Z',
                completedAt: null,
              },
            ],
          });
        },
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(workflowStatus);
    const a = red.create('moltnet-agent', 'a1');
    (a as Record<string, unknown>).teamId = 'team-1';
    const node = red.create('moltnet-workflow-status', 'n1', {
      agent: 'a1',
      limit: 25,
    });

    const { outputs } = await red.input(node, { correlationId: 'corr-1' });

    expect(seen).toEqual([{ correlationId: 'corr-1', limit: 25 }]);
    expect(seenOptions).toEqual([{ teamId: 'team-1' }]);
    const rows = outputs[0].payload as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      taskId: 't1',
      status: 'completed',
      title: 'triage',
      completedAt: '2026-06-23T00:05:00Z',
    });
    expect(rows[1]).toMatchObject({ taskId: 't2', title: '', completedAt: '' });
    expect(outputs[0].workflow).toMatchObject({
      correlationId: 'corr-1',
      total: 2,
    });
  });

  it('errors (via done) when no correlationId is provided', async () => {
    const agent = {
      tasks: { list: () => Promise.resolve({ total: 0, items: [] }) },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(workflowStatus);
    red.create('moltnet-agent', 'a1');
    const node = red.create('moltnet-workflow-status', 'n1', { agent: 'a1' });

    await expect(red.input(node, {})).rejects.toThrow(
      /correlationId is required/,
    );
  });
});
