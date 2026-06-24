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
    expect(r.artifactBody<{ changed: number }>('patch')).toEqual({
      changed: 3,
    });
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

describe('createResultReader (verification cross-field rule)', () => {
  // A real server-fetched freeform task carries the normalized successCriteria
  // in input (incl. the injected submit-output gate). When criteria are set,
  // the output MUST include a valid verification block — the reader validates
  // this and throws otherwise. This is the reader's main real-world branch.
  const inputWithCriteria = {
    brief: 'do it',
    successCriteria: {
      version: 1,
      gates: [
        {
          id: 'submit-output',
          kind: 'submit-tool-call',
          description: 'Call submit_freeform_output once.',
          required: true,
        },
      ],
    },
  };

  const verification = {
    inputCid: 'bafyINPUT',
    passed: true,
    results: [{ id: 'submit-output', kind: 'gate', status: 'pass' }],
  };

  function taskWithCriteria(): Task {
    return {
      id: 'task-2',
      taskType: 'freeform',
      acceptedAttemptN: 1,
      input: inputWithCriteria,
    } as unknown as Task;
  }

  function attempt(output: unknown): TaskAttempt {
    return {
      taskId: 'task-2',
      attemptN: 1,
      status: 'completed',
      output: output as TaskAttempt['output'],
      outputCid: 'bafyOUT2',
      completedAt: null,
      completedExecutorFingerprint: null,
      usage: null,
    } as unknown as TaskAttempt;
  }

  it('throws when criteria are set but output omits verification', () => {
    expect(() =>
      createResultReader(taskWithCriteria(), attempt({ summary: 'done' })),
    ).toThrow(TaskResultError);
  });

  it('succeeds when output carries a valid verification block', () => {
    const r = createResultReader(
      taskWithCriteria(),
      attempt({ summary: 'done', verification }),
    );
    expect(r.summary).toBe('done');
    expect(
      (r.output as { verification?: { passed: boolean } }).verification?.passed,
    ).toBe(true);
  });
});
