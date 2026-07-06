import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import runtimeSessionDownload from '../src/nodes/runtime-session-download.js';
import { FakeRed } from './fake-red.js';
import { agentStub } from './node-test-utils.js';

describe('moltnet-runtime-session-download', () => {
  it('downloads runtime session bytes as a Buffer', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const agent = {
      runtimeSessions: {
        download: (
          ref: Record<string, unknown>,
          options: Record<string, unknown>,
        ) => {
          seen.push({ ref, options });
          return Promise.resolve(readableChunks(['session ', 'bytes']));
        },
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(runtimeSessionDownload);
    const a = red.create('moltnet-agent', 'a1');
    (a as Record<string, unknown>).teamId = 'team-1';
    const node = red.create('moltnet-runtime-session-download', 'n1', {
      agent: 'a1',
      taskId: 'task-1',
      attemptN: 4,
    });

    const { outputs } = await red.input(node, {});

    expect(seen).toEqual([
      {
        ref: { taskId: 'task-1', attemptN: 4 },
        options: { teamId: 'team-1' },
      },
    ]);
    expect(Buffer.isBuffer(outputs[0].payload)).toBe(true);
    expect((outputs[0].payload as Buffer).toString('utf8')).toBe(
      'session bytes',
    );
    expect(outputs[0].runtimeSession).toEqual({
      taskId: 'task-1',
      teamId: 'team-1',
      attemptN: 4,
      sizeBytes: 13,
    });
  });

  it('rejects downloads over the local byte limit', async () => {
    const red = new FakeRed();
    red.load(
      agentStub({
        runtimeSessions: {
          download: () => Promise.resolve(readableChunks(['too-large'])),
        },
      }),
    );
    red.load(runtimeSessionDownload);
    const a = red.create('moltnet-agent', 'a1');
    (a as Record<string, unknown>).teamId = 'team-1';
    const node = red.create('moltnet-runtime-session-download', 'n1', {
      agent: 'a1',
      taskId: 'task-1',
      attemptN: 1,
      maxBytes: 4,
    });

    await expect(red.input(node, {})).rejects.toThrow(/exceeds 4 bytes/);
  });
});

async function* readableChunks(chunks: string[]): AsyncIterable<Buffer> {
  for (const chunk of chunks) {
    yield Buffer.from(chunk);
  }
}
