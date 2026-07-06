import { describe, expect, it } from 'vitest';

import tasksCreate from '../src/nodes/tasks-create.js';
import { FakeRed } from './fake-red.js';
import { agentStub, deferred } from './node-test-utils.js';

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
    expect(outputs[0].taskId).toBe('task-123');
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

  it('shows active create count when one node handles parallel messages', async () => {
    const first = deferred<{ id: string }>();
    const second = deferred<{ id: string }>();
    const calls: string[] = [];
    const agent = {
      tasks: {
        create: (body: { title?: string }) => {
          calls.push(body.title ?? '');
          return calls.length === 1 ? first.promise : second.promise;
        },
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(tasksCreate);
    red.create('moltnet-agent', 'a1');
    const node = red.create('moltnet-tasks-create', 'n1', { agent: 'a1' });

    const p1 = red.input(node, {
      payload: { title: 'Deep review: correctness' },
      reviewDimension: 'correctness',
    });
    const p2 = red.input(node, {
      payload: { title: 'Deep review: security' },
      reviewDimension: 'security',
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(node.statuses.map((s) => s.text)).toContain(
      'creating · security · 2 active',
    );

    second.resolve({ id: 'task-security' });
    first.resolve({ id: 'task-correctness' });
    await Promise.all([p1, p2]);

    expect(node.statuses.map((s) => s.text)).toContain(
      'created task-sec · security · 1 active',
    );
    expect(node.statuses.at(-1)?.text).toBe('created task-cor · correctness');
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
