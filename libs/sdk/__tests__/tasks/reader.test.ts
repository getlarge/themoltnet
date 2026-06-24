import type { Task, TaskAttempt } from '@moltnet/api-client';
import { describe, expect, it } from 'vitest';

import { TaskResultError } from '../../src/tasks/errors.js';
import { createResultReader } from '../../src/tasks/reader.js';

function freeformTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    taskType: 'freeform',
    acceptedAttemptN: 1,
    input: {},
    ...overrides,
  } as Task;
}

function freeformAttempt(
  output: unknown,
  overrides: Partial<TaskAttempt> = {},
): TaskAttempt {
  return {
    taskId: 'task-1',
    attemptN: 1,
    status: 'completed',
    output: output as TaskAttempt['output'],
    outputCid: 'bafyOUT',
    completedAt: '2026-06-24T00:00:00.000Z',
    completedExecutorFingerprint: 'FP-1',
    usage: null,
    ...overrides,
  } as TaskAttempt;
}

describe('createResultReader (freeform)', () => {
  const output = {
    summary: 'Did the thing',
    artifacts: [
      { kind: 'patch', title: 'fix', body: '{"changed":3}' },
      { kind: 'note', title: 'log', body: 'hello' },
    ],
  };

  it('exposes typed output + summary + accepted meta', () => {
    const r = createResultReader(freeformTask(), freeformAttempt(output));
    expect(r.summary).toBe('Did the thing');
    expect(r.output).toEqual(output);
    expect(r.accepted.attemptN).toBe(1);
    expect(r.accepted.executorFingerprint).toBe('FP-1');
    expect(r.accepted.completedAt).toBe('2026-06-24T00:00:00.000Z');
  });

  it('artifact()/artifacts() filter by kind', () => {
    const r = createResultReader(freeformTask(), freeformAttempt(output));
    expect(r.artifacts('patch')).toHaveLength(1);
    expect(r.artifact('patch')?.title).toBe('fix');
    expect(r.artifacts()).toHaveLength(2);
  });

  it('artifactBody<T>() parses JSON body', () => {
    const r = createResultReader(freeformTask(), freeformAttempt(output));
    expect(r.artifactBody<{ changed: number }>('patch')).toEqual({ changed: 3 });
  });

  it('artifactBody throws TaskResultError on invalid JSON', () => {
    const r = createResultReader(freeformTask(), freeformAttempt(output));
    expect(() => r.artifactBody('note')).toThrow(TaskResultError);
  });

  it('outputRef(role) carries the real outputCid', () => {
    const r = createResultReader(freeformTask(), freeformAttempt(output));
    expect(r.outputRef('context')).toEqual({
      taskId: 'task-1',
      outputCid: 'bafyOUT',
      role: 'context',
    });
  });

  it('throws when output is null', () => {
    expect(() =>
      createResultReader(freeformTask(), freeformAttempt(null)),
    ).toThrow(TaskResultError);
  });

  it('throws when output fails its schema (missing summary)', () => {
    expect(() =>
      createResultReader(freeformTask(), freeformAttempt({ artifacts: [] })),
    ).toThrow(TaskResultError);
  });

  it('throws when task has no accepted attempt', () => {
    expect(() =>
      createResultReader(
        freeformTask({ acceptedAttemptN: null }),
        freeformAttempt(output),
      ),
    ).toThrow(TaskResultError);
  });
});
