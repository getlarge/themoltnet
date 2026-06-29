import { Buffer } from 'node:buffer';

import type { NodeInitializer } from 'node-red';
import { describe, expect, it } from 'vitest';

import entriesSearch from '../src/nodes/entries-search.js';
import runtimeProfile from '../src/nodes/runtime-profile.js';
import taskArtifactDownload from '../src/nodes/task-artifact-download.js';
import taskArtifactUpload from '../src/nodes/task-artifact-upload.js';
import taskArtifactsList from '../src/nodes/task-artifacts-list.js';
import taskGet from '../src/nodes/task-get.js';
import taskWait from '../src/nodes/task-wait.js';
import tasksCreate from '../src/nodes/tasks-create.js';
import tasksList from '../src/nodes/tasks-list.js';
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

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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

describe('moltnet-task-artifact-upload', () => {
  it('uploads base64 payload content with artifact metadata', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const agent = {
      tasks: {
        artifacts: {
          upload: (
            ref: Record<string, unknown>,
            body: Uint8Array,
            query: Record<string, unknown>,
            options: Record<string, unknown>,
          ) => {
            seen.push({
              ref,
              body: Buffer.from(body).toString('utf8'),
              query,
              options,
            });
            return Promise.resolve({
              artifactId: 'artifact-1',
              cid: 'bafy-upload',
              kind: query.kind,
            });
          },
        },
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(taskArtifactUpload);
    const a = red.create('moltnet-agent', 'a1');
    (a as Record<string, unknown>).teamId = 'team-1';
    const node = red.create('moltnet-task-artifact-upload', 'n1', {
      agent: 'a1',
      taskId: 'task-1',
      attemptN: 2,
      kind: 'output',
      contentType: 'text/plain',
    });

    const { outputs } = await red.input(node, {
      payload: {
        contentBase64: Buffer.from('artifact bytes').toString('base64'),
        title: 'result.txt',
      },
    });

    expect(seen).toEqual([
      {
        ref: { taskId: 'task-1', attemptN: 2 },
        body: 'artifact bytes',
        query: {
          kind: 'output',
          title: 'result.txt',
          contentType: 'text/plain',
          contentEncoding: undefined,
        },
        options: { teamId: 'team-1' },
      },
    ]);
    expect(outputs[0].payload).toEqual({
      artifactId: 'artifact-1',
      cid: 'bafy-upload',
      kind: 'output',
    });
    expect(outputs[0].artifact).toBe(outputs[0].payload);
  });

  it('uploads Buffer payload content without requiring base64 wrapping', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const agent = {
      tasks: {
        artifacts: {
          upload: (
            ref: Record<string, unknown>,
            body: Uint8Array,
            query: Record<string, unknown>,
            options: Record<string, unknown>,
          ) => {
            seen.push({
              ref,
              body: Buffer.from(body).toString('utf8'),
              query,
              options,
            });
            return Promise.resolve({ cid: 'bafy-buffer' });
          },
        },
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(taskArtifactUpload);
    const a = red.create('moltnet-agent', 'a1');
    (a as Record<string, unknown>).teamId = 'team-1';
    const node = red.create('moltnet-task-artifact-upload', 'n1', {
      agent: 'a1',
      taskId: 'task-1',
      attemptN: 1,
      title: 'buffer.txt',
    });

    await red.input(node, { payload: Buffer.from('buffer-body') });

    expect(seen).toEqual([
      {
        ref: { taskId: 'task-1', attemptN: 1 },
        body: 'buffer-body',
        query: {
          kind: 'output',
          title: 'buffer.txt',
          contentType: 'application/octet-stream',
          contentEncoding: undefined,
        },
        options: { teamId: 'team-1' },
      },
    ]);
  });

  it('rejects upload bodies over the local byte limit', async () => {
    const red = new FakeRed();
    red.load(
      agentStub({
        tasks: { artifacts: { upload: () => Promise.resolve({}) } },
      }),
    );
    red.load(taskArtifactUpload);
    const a = red.create('moltnet-agent', 'a1');
    (a as Record<string, unknown>).teamId = 'team-1';
    const node = red.create('moltnet-task-artifact-upload', 'n1', {
      agent: 'a1',
      taskId: 'task-1',
      attemptN: 1,
      maxBytes: 4,
    });

    await expect(
      red.input(node, { payload: Buffer.from('too-large') }),
    ).rejects.toThrow(/exceeds 4 bytes/);
  });

  it('requires upload content', async () => {
    const red = new FakeRed();
    red.load(
      agentStub({
        tasks: { artifacts: { upload: () => Promise.resolve({}) } },
      }),
    );
    red.load(taskArtifactUpload);
    const a = red.create('moltnet-agent', 'a1');
    (a as Record<string, unknown>).teamId = 'team-1';
    const node = red.create('moltnet-task-artifact-upload', 'n1', {
      agent: 'a1',
      taskId: 'task-1',
      attemptN: 1,
    });

    await expect(red.input(node, { payload: {} })).rejects.toThrow(
      /payload content is required/,
    );
  });
});

describe('moltnet-task-artifact-download', () => {
  it('downloads artifact bytes as a Buffer', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const agent = {
      tasks: {
        artifacts: {
          download: (
            ref: Record<string, unknown>,
            options: Record<string, unknown>,
          ) => {
            seen.push({ ref, options });
            return Promise.resolve({
              artifactId: 'artifact-1',
              contentType: 'text/plain',
              contentEncoding: null,
              stream: readableChunks(['artifact ', 'bytes']),
            });
          },
        },
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(taskArtifactDownload);
    const a = red.create('moltnet-agent', 'a1');
    (a as Record<string, unknown>).teamId = 'team-1';
    const node = red.create('moltnet-task-artifact-download', 'n1', {
      agent: 'a1',
      taskId: 'task-1',
      attemptN: 2,
    });

    const { outputs } = await red.input(node, {
      payload: { cid: 'bafy-download' },
    });

    expect(seen).toEqual([
      {
        ref: { taskId: 'task-1', attemptN: 2, cid: 'bafy-download' },
        options: { teamId: 'team-1' },
      },
    ]);
    expect(Buffer.isBuffer(outputs[0].payload)).toBe(true);
    expect((outputs[0].payload as Buffer).toString('utf8')).toBe(
      'artifact bytes',
    );
    expect(outputs[0].artifact).toEqual({
      taskId: 'task-1',
      teamId: 'team-1',
      attemptN: 2,
      cid: 'bafy-download',
      artifactId: 'artifact-1',
      contentType: 'text/plain',
      contentEncoding: null,
    });
  });

  it('downloads from an artifactRef-shaped payload', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const agent = {
      tasks: {
        artifacts: {
          download: (
            ref: Record<string, unknown>,
            options: Record<string, unknown>,
          ) => {
            seen.push({ ref, options });
            return Promise.resolve({
              artifactId: 'artifact-1',
              stream: readableChunks(['ok']),
            });
          },
        },
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(taskArtifactDownload);
    const a = red.create('moltnet-agent', 'a1');
    (a as Record<string, unknown>).teamId = 'team-1';
    const node = red.create('moltnet-task-artifact-download', 'n1', {
      agent: 'a1',
    });

    await red.input(node, {
      payload: {
        taskId: 'task-1',
        artifact: { cid: 'bafy-artifact', attemptN: 7 },
      },
    });

    expect(seen).toEqual([
      {
        ref: { taskId: 'task-1', attemptN: 7, cid: 'bafy-artifact' },
        options: { teamId: 'team-1' },
      },
    ]);
  });

  it('rejects downloads over the local byte limit', async () => {
    const red = new FakeRed();
    red.load(
      agentStub({
        tasks: {
          artifacts: {
            download: () =>
              Promise.resolve({ stream: readableChunks(['too-large']) }),
          },
        },
      }),
    );
    red.load(taskArtifactDownload);
    const a = red.create('moltnet-agent', 'a1');
    (a as Record<string, unknown>).teamId = 'team-1';
    const node = red.create('moltnet-task-artifact-download', 'n1', {
      agent: 'a1',
      taskId: 'task-1',
      attemptN: 1,
      cid: 'bafy',
      maxBytes: 4,
    });

    await expect(red.input(node, {})).rejects.toThrow(/exceeds 4 bytes/);
  });

  it('requires cid', async () => {
    const red = new FakeRed();
    red.load(
      agentStub({
        tasks: { artifacts: { download: () => Promise.resolve({}) } },
      }),
    );
    red.load(taskArtifactDownload);
    const a = red.create('moltnet-agent', 'a1');
    (a as Record<string, unknown>).teamId = 'team-1';
    const node = red.create('moltnet-task-artifact-download', 'n1', {
      agent: 'a1',
      taskId: 'task-1',
      attemptN: 1,
    });

    await expect(red.input(node, { payload: {} })).rejects.toThrow(
      /cid is required/,
    );
  });
});

async function* readableChunks(chunks: string[]): AsyncIterable<Buffer> {
  for (const chunk of chunks) {
    yield Buffer.from(chunk);
  }
}

describe('moltnet-entries-search', () => {
  it('searches entries with configured filters and snake_case payload overrides', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const agent = {
      entries: {
        search: (body: Record<string, unknown>) => {
          seen.push(body);
          return Promise.resolve({
            total: 1,
            results: [{ id: 'e1', title: 'Decision' }],
          });
        },
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(entriesSearch);
    const a = red.create('moltnet-agent', 'a1');
    (a as Record<string, unknown>).diaryId = 'diary-agent';
    const node = red.create('moltnet-entries-search', 'n1', {
      agent: 'a1',
      query: 'node red',
      tags: 'decision,scope:node-red',
      entryTypes: 'semantic,episodic',
      limit: 10,
      wRelevance: 1,
      wRecency: 0.3,
    });

    const { outputs } = await red.input(node, {
      payload: {
        query: 'tasks list node',
        diary_id: 'diary-override',
        exclude_tags: ['obsolete'],
        exclude_superseded: true,
        w_importance: 0.8,
        w_recency: 0.5,
        w_relevance: 1.2,
      },
    });

    expect(seen).toEqual([
      {
        diaryId: 'diary-override',
        query: 'tasks list node',
        tags: ['decision', 'scope:node-red'],
        excludeTags: ['obsolete'],
        entryTypes: ['semantic', 'episodic'],
        excludeSuperseded: true,
        limit: 10,
        wImportance: 0.8,
        wRelevance: 1.2,
        wRecency: 0.5,
      },
    ]);
    expect(outputs[0].payload).toEqual([{ id: 'e1', title: 'Decision' }]);
    expect(outputs[0].entries).toEqual({ total: 1, query: seen[0] });
  });

  it('treats a string payload as the query', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const agent = {
      entries: {
        search: (body: Record<string, unknown>) => {
          seen.push(body);
          return Promise.resolve({ total: 0, results: [] });
        },
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(entriesSearch);
    const a = red.create('moltnet-agent', 'a1');
    (a as Record<string, unknown>).diaryId = 'diary-agent';
    const node = red.create('moltnet-entries-search', 'n1', { agent: 'a1' });

    await red.input(node, { payload: 'release rationale' });

    expect(seen).toEqual([
      { diaryId: 'diary-agent', query: 'release rationale' },
    ]);
  });

  it('errors when no query can be resolved', async () => {
    const red = new FakeRed();
    red.load(agentStub({ entries: { search: () => Promise.resolve({}) } }));
    red.load(entriesSearch);
    red.create('moltnet-agent', 'a1');
    const node = red.create('moltnet-entries-search', 'n1', { agent: 'a1' });

    await expect(red.input(node, {})).rejects.toThrow(/query is required/);
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
