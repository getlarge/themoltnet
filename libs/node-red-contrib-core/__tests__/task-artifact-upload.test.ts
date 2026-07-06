import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import taskArtifactUpload from '../src/nodes/task-artifact-upload.js';
import { FakeRed } from './fake-red.js';
import { agentStub } from './node-test-utils.js';

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
