import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import runtimeSessionUpload from '../src/nodes/runtime-session-upload.js';
import { FakeRed } from './fake-red.js';
import { agentStub } from './node-test-utils.js';

describe('moltnet-runtime-session-upload', () => {
  it('uploads runtime session bytes with lineage metadata', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const agent = {
      runtimeSessions: {
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
          return Promise.resolve({ id: 'session-1', sha256: 'sha' });
        },
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(runtimeSessionUpload);
    const a = red.create('moltnet-agent', 'a1');
    (a as Record<string, unknown>).teamId = 'team-1';
    const node = red.create('moltnet-runtime-session-upload', 'n1', {
      agent: 'a1',
      taskId: 'task-1',
      attemptN: 3,
      sessionKind: 'root',
    });

    const { outputs } = await red.input(node, {
      payload: {
        contentBase64: Buffer.from('session bytes').toString('base64'),
        sessionKind: 'extend',
        parentSessionId: 'parent-1',
        sourceSlotId: 'slot-1',
        sourceRuntimeProfileId: 'profile-1',
      },
    });

    expect(seen).toEqual([
      {
        ref: { taskId: 'task-1', attemptN: 3 },
        body: 'session bytes',
        query: {
          sessionKind: 'extend',
          parentSessionId: 'parent-1',
          sourceSlotId: 'slot-1',
          sourceRuntimeProfileId: 'profile-1',
        },
        options: { teamId: 'team-1' },
      },
    ]);
    expect(outputs[0].payload).toEqual({ id: 'session-1', sha256: 'sha' });
    expect(outputs[0].runtimeSession).toBe(outputs[0].payload);
  });

  it('defaults session kind to root', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const agent = {
      runtimeSessions: {
        upload: (
          _ref: Record<string, unknown>,
          _body: Uint8Array,
          query: Record<string, unknown>,
        ) => {
          seen.push(query);
          return Promise.resolve({ id: 'session-1' });
        },
      },
    };
    const red = new FakeRed();
    red.load(agentStub(agent));
    red.load(runtimeSessionUpload);
    const a = red.create('moltnet-agent', 'a1');
    (a as Record<string, unknown>).teamId = 'team-1';
    const node = red.create('moltnet-runtime-session-upload', 'n1', {
      agent: 'a1',
      taskId: 'task-1',
      attemptN: 1,
    });

    await red.input(node, { payload: Buffer.from('session') });

    expect(seen).toEqual([{ sessionKind: 'root' }]);
  });
});
