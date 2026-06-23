import type { NodeInitializer } from 'node-red';
import { describe, expect, it } from 'vitest';

import tasksCreate from '../src/nodes/tasks-create.js';
import workflowStatus from '../src/nodes/workflow-status.js';
import { type FakeNode, FakeRed } from './fake-red.js';

/**
 * Stub `moltnet-agent` config node: registers the type the real nodes
 * reference, but `getAgent()` returns an in-memory fake. This keeps the unit
 * tests free of network and the SDK — the SDK lives only in the real agent
 * node, which these tests intentionally replace.
 */
function agentStub(agent: unknown): NodeInitializer {
  return ((RED: FakeRed) => {
    RED.nodes.registerType('moltnet-agent', function (this: FakeNode) {
      RED.nodes.createNode(this);
      this.getAgent = () => Promise.resolve(agent);
    });
  }) as unknown as NodeInitializer;
}

describe('moltnet-tasks-create', () => {
  it('creates a task as the referenced agent and returns it on payload', async () => {
    const created: unknown[] = [];
    const agent = {
      tasks: {
        create: (body: unknown) => {
          created.push(body);
          return Promise.resolve({ id: 'task-123', body });
        },
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(tasksCreate);
    red.create('moltnet-agent', 'a1');
    const node = red.create('moltnet-tasks-create', 'n1', {
      agent: 'a1',
      taskType: 'freeform',
    });

    const { outputs } = await red.input(node, { payload: { foo: 'bar' } });

    expect(outputs).toHaveLength(1);
    expect(outputs[0].payload).toMatchObject({ id: 'task-123' });
    expect(created).toEqual([{ foo: 'bar' }]);
  });

  it('falls back to config body when payload is not an object', async () => {
    const created: unknown[] = [];
    const agent = {
      tasks: {
        create: (body: unknown) => {
          created.push(body);
          return Promise.resolve({ id: 't' });
        },
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(tasksCreate);
    red.create('moltnet-agent', 'a1');
    const node = red.create('moltnet-tasks-create', 'n1', {
      agent: 'a1',
      taskType: 'review',
      teamId: 'team-1',
    });

    await red.input(node, { payload: 'not-an-object' });

    expect(created).toEqual([{ taskType: 'review', teamId: 'team-1' }]);
  });

  it('errors (via done) when no agent is configured', async () => {
    const red = new FakeRed();
    red.load(agentStub({}));
    red.load(tasksCreate);
    const node = red.create('moltnet-tasks-create', 'n1', {});

    await expect(red.input(node, { payload: {} })).rejects.toThrow(
      /no moltnet-agent configured/,
    );
  });
});

describe('moltnet-workflow-status', () => {
  it('maps a workflow run’s tasks to table rows by correlationId', async () => {
    const seen: Array<{ correlationId?: string; limit?: number }> = [];
    const agent = {
      tasks: {
        list: (query: { correlationId?: string; limit?: number }) => {
          seen.push(query);
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
    red.create('moltnet-agent', 'a1');
    const node = red.create('moltnet-workflow-status', 'n1', {
      agent: 'a1',
      limit: 25,
    });

    const { outputs } = await red.input(node, { correlationId: 'corr-1' });

    expect(seen).toEqual([{ correlationId: 'corr-1', limit: 25 }]);
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
