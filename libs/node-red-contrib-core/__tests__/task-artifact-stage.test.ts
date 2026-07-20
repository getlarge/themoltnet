import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import taskArtifactStage from '../src/nodes/task-artifact-stage.js';
import { FakeRed } from './fake-red.js';
import { agentStub } from './node-test-utils.js';

describe('moltnet-task-artifact-stage', () => {
  it('stages base64 payload content for the configured team', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const staged = {
      cid: 'bafy-staged',
      sizeBytes: 14,
      contentType: 'text/plain',
    };
    const agent = {
      tasks: {
        artifacts: {
          stage: (
            body: Uint8Array,
            query: Record<string, unknown>,
            options: Record<string, unknown>,
          ) => {
            seen.push({
              body: Buffer.from(body).toString('utf8'),
              query,
              options,
            });
            return Promise.resolve(staged);
          },
        },
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(taskArtifactStage);
    const a = red.create('moltnet-agent', 'a1');
    (a as Record<string, unknown>).teamId = 'team-1';
    const node = red.create('moltnet-task-artifact-stage', 'n1', {
      agent: 'a1',
      contentType: 'text/plain',
    });

    const { outputs } = await red.input(node, {
      payload: {
        contentBase64: Buffer.from('artifact bytes').toString('base64'),
      },
    });

    expect(seen).toEqual([
      {
        body: 'artifact bytes',
        query: {
          contentType: 'text/plain',
          contentEncoding: undefined,
        },
        options: { teamId: 'team-1' },
      },
    ]);
    expect(outputs[0].payload).toEqual(staged);
    expect(outputs[0].artifact).toBe(outputs[0].payload);
  });

  it('allows an explicit message team override', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const red = new FakeRed();
    red.load(
      agentStub({
        tasks: {
          artifacts: {
            stage: (
              _body: Uint8Array,
              _query: Record<string, unknown>,
              options: Record<string, unknown>,
            ) => {
              seen.push(options);
              return Promise.resolve({ cid: 'bafy-staged' });
            },
          },
        },
      }),
    );
    red.load(taskArtifactStage);
    const a = red.create('moltnet-agent', 'a1');
    (a as Record<string, unknown>).teamId = 'team-default';
    const node = red.create('moltnet-task-artifact-stage', 'n1', {
      agent: 'a1',
      allowMsgTeamOverride: true,
    });

    await red.input(node, {
      teamId: 'team-message',
      payload: Buffer.from('body'),
    });

    expect(seen).toEqual([{ teamId: 'team-message' }]);
  });

  it('rejects staging bodies over the local byte limit', async () => {
    const red = new FakeRed();
    red.load(
      agentStub({
        tasks: { artifacts: { stage: () => Promise.resolve({}) } },
      }),
    );
    red.load(taskArtifactStage);
    const a = red.create('moltnet-agent', 'a1');
    (a as Record<string, unknown>).teamId = 'team-1';
    const node = red.create('moltnet-task-artifact-stage', 'n1', {
      agent: 'a1',
      maxBytes: 4,
    });

    await expect(
      red.input(node, { payload: Buffer.from('too-large') }),
    ).rejects.toThrow(/exceeds 4 bytes/);
  });
});
