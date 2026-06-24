import { describe, expect, it } from 'vitest';

import taskReader from '../src/nodes/task-reader.js';
import { FakeRed } from './fake-red.js';

/** A TaskSnapshot-shaped object with the raw task+accepted attempt the reader needs. */
function snapshot(output: unknown) {
  return {
    taskId: 'task-1',
    status: 'completed',
    terminal: true,
    accepted: true,
    acceptedAttemptN: 1,
    state: output,
    attempt: {
      taskId: 'task-1',
      attemptN: 1,
      status: 'completed',
      output,
      outputCid: 'bafyOUT',
      completedAt: '2026-06-24T00:00:00.000Z',
      completedExecutorFingerprint: 'FP-1',
      usage: null,
    },
    attempts: [],
    error: null,
    task: {
      id: 'task-1',
      taskType: 'freeform',
      acceptedAttemptN: 1,
      input: {},
    },
  };
}

function setup(def: Record<string, unknown> = {}) {
  const red = new FakeRed();
  red.load(taskReader);
  const node = red.create('moltnet-task-reader', 'n1', def);
  return { red, node };
}

describe('moltnet-task-reader', () => {
  it('emits typed output + summary + a pre-computed outputRef', async () => {
    const { red, node } = setup({ role: 'context' });
    const { outputs } = await red.input(node, {
      payload: snapshot({
        summary: 'done',
        artifacts: [{ kind: 'patch', title: 'x', body: '{"n":3}' }],
      }),
    } as Record<string, unknown>);
    const payload = outputs[0].payload as { summary: string };
    expect(payload.summary).toBe('done');
    const result = (outputs[0] as { result: Record<string, unknown> }).result;
    expect(result.summary).toBe('done');
    expect(result.outputRef).toEqual({
      taskId: 'task-1',
      outputCid: 'bafyOUT',
      role: 'context',
    });
  });

  it('parses an artifact body when an artifact selector is set', async () => {
    const { red, node } = setup({ role: 'context', artifactKind: 'patch' });
    const { outputs } = await red.input(node, {
      payload: snapshot({
        summary: 's',
        artifacts: [{ kind: 'patch', title: 'x', body: '{"n":3}' }],
      }),
    } as Record<string, unknown>);
    const result = (outputs[0] as { result: Record<string, unknown> }).result;
    expect(result.artifactBody).toEqual({ n: 3 });
  });

  it('errors when the snapshot has no accepted attempt', async () => {
    const { red, node } = setup();
    const snap = snapshot({ summary: 's' });
    snap.accepted = false;
    snap.acceptedAttemptN = null as unknown as number;
    snap.task.acceptedAttemptN = null as unknown as number;
    await expect(
      red.input(node, { payload: snap } as Record<string, unknown>),
    ).rejects.toBeTruthy();
    expect(node.statuses.at(-1)).toMatchObject({ fill: 'red', shape: 'ring' });
  });
});
