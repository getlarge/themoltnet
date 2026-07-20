import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import taskArtifactDownload from '../src/nodes/task-artifact-download.js';
import { FakeRed } from './fake-red.js';
import { agentStub } from './node-test-utils.js';

async function* readableChunks(chunks: string[]): AsyncIterable<Buffer> {
  for (const chunk of chunks) {
    yield Buffer.from(chunk);
  }
}

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

  it('downloads by task and CID when attemptN is omitted', async () => {
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
              artifactId: 'artifact-input',
              stream: readableChunks(['input']),
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
    });

    const { outputs } = await red.input(node, {
      payload: { cid: 'bafy-input' },
    });

    expect(seen).toEqual([
      {
        ref: { taskId: 'task-1', cid: 'bafy-input' },
        options: { teamId: 'team-1' },
      },
    ]);
    expect(outputs[0].artifact).toEqual({
      taskId: 'task-1',
      teamId: 'team-1',
      cid: 'bafy-input',
      artifactId: 'artifact-input',
      contentType: undefined,
      contentEncoding: undefined,
    });
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
