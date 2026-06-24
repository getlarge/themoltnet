import type { NodeInitializer } from 'node-red';
import { describe, expect, it } from 'vitest';

import runtimeProfile from '../src/nodes/runtime-profile.js';
import taskGet from '../src/nodes/task-get.js';
import taskWait from '../src/nodes/task-wait.js';
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
    const node = red.create('moltnet-tasks-create', 'n1', { agent: 'a1' });

    const { outputs } = await red.input(node, { payload: { foo: 'bar' } });

    expect(outputs).toHaveLength(1);
    expect(outputs[0].payload).toMatchObject({ id: 'task-123' });
    // Payload is preserved; taskType defaults to freeform when the payload
    // (e.g. from task: build) does not set it.
    expect(created).toEqual([{ foo: 'bar', taskType: 'freeform' }]);
  });

  it('defaults taskType to freeform and inherits team/diary from the agent', async () => {
    const created: Record<string, unknown>[] = [];
    const options: Record<string, unknown>[] = [];
    const agent = {
      teamId: 'team-1',
      diaryId: 'diary-1',
      tasks: {
        create: (
          body: Record<string, unknown>,
          opts: Record<string, unknown>,
        ) => {
          created.push(body);
          options.push(opts);
          return Promise.resolve({ id: 't' });
        },
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(tasksCreate);
    // Agent node carries team/diary context (read by tasks-create).
    const a = red.create('moltnet-agent', 'a1');
    (a as Record<string, unknown>).teamId = 'team-1';
    (a as Record<string, unknown>).diaryId = 'diary-1';
    const node = red.create('moltnet-tasks-create', 'n1', { agent: 'a1' });

    await red.input(node, { payload: 'not-an-object' });

    // teamId is passed as the SDK team-context option; diaryId stays in the body.
    // taskType defaults to freeform (the body normally arrives from task: build).
    expect(created[0]).toMatchObject({
      taskType: 'freeform',
      diaryId: 'diary-1',
    });
    expect(options[0]).toEqual({ teamId: 'team-1' });
  });

  it('passes through the body from msg.payload (task: build); node only adds maxAttempts', async () => {
    const created: Record<string, unknown>[] = [];
    const agent = {
      tasks: {
        create: (body: Record<string, unknown>) => {
          created.push(body);
          return Promise.resolve({ id: 't' });
        },
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(tasksCreate);
    red.create('moltnet-agent', 'a1');
    // taskType/title/tags/allowedProfiles are NO LONGER node fields — they
    // arrive on msg.payload (composed by task: build). The node only fills
    // maxAttempts (and team/diary/correlationId).
    const node = red.create('moltnet-tasks-create', 'n1', {
      agent: 'a1',
      maxAttempts: 3,
    });

    const { outputs } = await red.input(node, {
      payload: {
        taskType: 'fulfill_brief',
        title: 'built title',
        tags: ['triage', 'issue-1'],
        input: { brief: 'go' },
      },
    });

    expect(created[0]).toMatchObject({
      taskType: 'fulfill_brief',
      title: 'built title',
      tags: ['triage', 'issue-1'],
      maxAttempts: 3,
      input: { brief: 'go' },
    });
    expect(outputs).toHaveLength(1);
  });

  it('threads correlationId: mints when configured and echoes onto msg', async () => {
    const created: Record<string, unknown>[] = [];
    const agent = {
      tasks: {
        create: (body: Record<string, unknown>) => {
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
      generateCorrelationId: true,
    });

    const { outputs } = await red.input(node, { payload: {} });

    const minted = created[0].correlationId as string;
    expect(minted).toMatch(/^[0-9a-f-]{36}$/);
    // Echoed onto the outgoing msg so downstream nodes inherit the run.
    expect(outputs[0].correlationId).toBe(minted);
  });

  it('reuses an inbound msg.correlationId instead of minting', async () => {
    const created: Record<string, unknown>[] = [];
    const agent = {
      tasks: {
        create: (body: Record<string, unknown>) => {
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
      generateCorrelationId: true,
    });

    await red.input(node, { payload: {}, correlationId: 'run-42' });

    expect(created[0].correlationId).toBe('run-42');
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
      { payload: Record<string, unknown> },
    ];
    expect(tail).toBeNull();
    expect(result.payload).toMatchObject({
      accepted: true,
      state: { phase: 'pr_open', prNumber: 42 },
    });
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

    const { outputs } = await red.input(node, {});

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
    const result = (
      outputs[2] as unknown as [null, { payload: Record<string, unknown> }]
    )[1];
    expect(result.payload).toMatchObject({ accepted: true });
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
});

describe('moltnet-runtime-profile + tasks-create routing', () => {
  /** Build a FakeRed with a fake agent, the profile node, and tasks-create. */
  function setup(agent: Record<string, unknown>) {
    const created: Record<string, unknown>[] = [];
    const a = {
      tasks: {
        create: (body: Record<string, unknown>) => {
          created.push(body);
          return Promise.resolve({ id: 't' });
        },
      },
      ...agent,
    };
    const red = new FakeRed();
    red.load(agentStub(a));
    red.load(runtimeProfile);
    red.load(tasksCreate);
    red.create('moltnet-agent', 'a1');
    return { red, created };
  }

  it('registers a guarded admin endpoint for the profile dropdown', () => {
    const red = new FakeRed();
    red.load(runtimeProfile);
    const route = red.adminRoutes.find((r) =>
      r.path.includes('moltnet-runtime-profiles'),
    );
    expect(route).toBeDefined();
    expect(route?.method).toBe('get');
    expect(route?.guarded).toBe(true);
  });

  it('config node sets allowedProfiles from its profileId', async () => {
    const { red, created } = setup({});
    red.create('moltnet-runtime-profile', 'rp1', { profileId: 'prof-x' });
    const node = red.create('moltnet-tasks-create', 'n1', {
      agent: 'a1',
      runtimeProfile: 'rp1',
    });

    await red.input(node, { payload: { input: { brief: 'go' } } });

    expect(created[0].allowedProfiles).toEqual([{ profileId: 'prof-x' }]);
  });

  it('msg.payload.allowedProfiles overrides the config node', async () => {
    const { red, created } = setup({});
    red.create('moltnet-runtime-profile', 'rp1', { profileId: 'prof-x' });
    const node = red.create('moltnet-tasks-create', 'n1', {
      agent: 'a1',
      runtimeProfile: 'rp1',
    });

    await red.input(node, {
      payload: { allowedProfiles: [{ profileId: 'pay' }] },
    });

    expect(created[0].allowedProfiles).toEqual([{ profileId: 'pay' }]);
  });

  it('leaves allowedProfiles unset when the config node has no profileId', async () => {
    const { red, created } = setup({});
    red.create('moltnet-runtime-profile', 'rp1', { profileId: '' });
    const node = red.create('moltnet-tasks-create', 'n1', {
      agent: 'a1',
      runtimeProfile: 'rp1',
    });

    await red.input(node, { payload: {} });

    expect(created[0].allowedProfiles).toBeUndefined();
  });
});
