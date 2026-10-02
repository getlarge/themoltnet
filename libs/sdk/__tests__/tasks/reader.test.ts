import type { Task, TaskAttempt } from '@moltnet/api-client';
import { Type } from 'typebox';
import { describe, expect, expectTypeOf, it } from 'vitest';

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
      {
        kind: 'patch',
        title: 'fix',
        body: '{"changed":3}',
        cid: 'bafkreiPATCH',
        contentType: 'text/x-diff',
      },
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

  it('judgeEvalTarget() carries the accepted attempt tuple', () => {
    const r = createResultReader(freeformTask(), freeformAttempt(output));
    expect(r.judgeEvalTarget()).toEqual({
      targetTaskId: 'task-1',
      targetAttemptN: 1,
    });
  });

  it('artifactRef(role) carries outputCid and artifact CID metadata', () => {
    const r = createResultReader(freeformTask(), freeformAttempt(output));
    expect(r.artifactRef('patch', 'context')).toEqual({
      taskId: 'task-1',
      outputCid: 'bafyOUT',
      role: 'context',
      artifact: {
        cid: 'bafkreiPATCH',
        attemptN: 1,
        kind: 'patch',
        title: 'fix',
        contentType: 'text/x-diff',
      },
    });
  });

  it('artifactRef throws when the matching artifact has no CID', () => {
    const r = createResultReader(freeformTask(), freeformAttempt(output));
    expect(() => r.artifactRef('note', 'context')).toThrow(TaskResultError);
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

describe('createResultReader (freeform output contract)', () => {
  const outputContract = {
    version: 1,
    schema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['technical', 'legal'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['category', 'confidence'],
      additionalProperties: false,
    },
  };
  const contractedTask = freeformTask({
    input: { brief: 'Classify.', outputContract },
  });

  it('result<T>() returns the contract-validated result', () => {
    const result = { category: 'legal', confidence: 0.9 };

    const r = createResultReader(
      contractedTask,
      freeformAttempt({ summary: 'Classified.', result }),
    );

    expect(r.result<{ category: string; confidence: number }>()).toEqual(
      result,
    );
  });

  it('throws when the result violates the task contract', () => {
    const act = () =>
      createResultReader(
        contractedTask,
        freeformAttempt({
          summary: 'Classified.',
          result: { category: 'medical', confidence: 2 },
        }),
      );

    expect(act).toThrow(TaskResultError);
    expect(act).toThrow(/output\/result\/category/);
    expect(act).toThrow(/output\/result\/confidence/);
  });

  it('throws when a contracted task output has no result', () => {
    const act = () =>
      createResultReader(
        contractedTask,
        freeformAttempt({ summary: 'Classified.' }),
      );

    expect(act).toThrow(/output\/result: is required/);
  });

  it('throws when an uncontracted output carries a result', () => {
    const act = () =>
      createResultReader(
        freeformTask({ input: { brief: 'Classify.' } }),
        freeformAttempt({ summary: 'Classified.', result: { any: 1 } }),
      );

    expect(act).toThrow(/requires input.outputContract/);
  });

  it('result() throws when the task has no output contract', () => {
    const r = createResultReader(
      freeformTask({ input: { brief: 'Classify.' } }),
      freeformAttempt({ summary: 'Classified.' }),
    );

    expect(() => r.result()).toThrow(TaskResultError);
    expect(() => r.result()).toThrow(/input\/outputContract/);
  });
});

describe('TaskResultReader.result type inference', () => {
  it('defaults result() to the result type carried by TOutput', () => {
    const r = createResultReader<{ summary: string; result: { n: number } }>(
      freeformTask({
        input: {
          brief: 'Count.',
          outputContract: {
            version: 1,
            schema: {
              type: 'object',
              properties: { n: { type: 'integer' } },
              required: ['n'],
              additionalProperties: false,
            },
          },
        },
      }),
      freeformAttempt({ summary: 'Counted.', result: { n: 3 } }),
    );

    expectTypeOf(r.result()).toEqualTypeOf<{ n: number }>();
    expect(r.result().n).toBe(3);
  });
});

describe('TaskResultReader.result(schema)', () => {
  const Rooms = Type.Object(
    {
      rooms: Type.Array(
        Type.Object(
          { id: Type.String(), m2: Type.Number() },
          { additionalProperties: false },
        ),
      ),
    },
    { additionalProperties: false },
  );
  // Stored contracts come back from the API as plain JSON, possibly reordered.
  const stored = {
    additionalProperties: false,
    properties: {
      rooms: {
        items: {
          additionalProperties: false,
          properties: { m2: { type: 'number' }, id: { type: 'string' } },
          required: ['id', 'm2'],
          type: 'object',
        },
        type: 'array',
      },
    },
    required: ['rooms'],
    type: 'object',
  };
  const task = freeformTask({
    input: { brief: 'Rooms.', outputContract: { version: 1, schema: stored } },
  });
  const attempt = freeformAttempt({
    summary: 'Read rooms.',
    result: { rooms: [{ id: 't1', m2: 24 }] },
  });

  it('returns the result typed by the schema when it matches the contract', () => {
    const r = createResultReader(task, attempt);

    const result = r.result(Rooms);

    expectTypeOf(result).toEqualTypeOf<{
      rooms: { id: string; m2: number }[];
    }>();
    expect(result.rooms[0]).toEqual({ id: 't1', m2: 24 });
  });

  it('throws when the schema differs from the stored contract', () => {
    const r = createResultReader(task, attempt);
    const Other = Type.Object(
      { rooms: Type.Array(Type.String()) },
      { additionalProperties: false },
    );

    expect(() => r.result(Other)).toThrow(TaskResultError);
    expect(() => r.result(Other)).toThrow(/input\/outputContract\/schema/);
  });
});
