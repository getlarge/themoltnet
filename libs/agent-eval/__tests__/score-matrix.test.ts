import type { SubmitRepairKind } from '@moltnet/tasks';
import { describe, expect, it } from 'vitest';

import type { GateResult } from '../src/check-gates.js';
import type { Scenario } from '../src/scenario.js';
import {
  type MatrixDeps,
  runMatrix,
  summarizeMatrix,
} from '../src/score-matrix.js';

function scenario(slug: string): Scenario {
  return {
    slug,
    taskType: 'run_eval',
    scoring: 'judge',
    prompt: 'do the thing',
    execution: { mode: 'vitro', workspace: 'none' },
    rubric: {
      rubricId: slug,
      version: 'v1',
      criteria: [
        { id: 'c', description: 'd', weight: 1, scoring: 'llm_score' },
      ],
    },
    gates: { requireCleanSubmit: true },
  };
}

const PASS: GateResult = { passed: true, failures: [] };
const FAIL: GateResult = {
  passed: false,
  failures: [{ gate: 'submit', detail: 'no output' }],
};

/** Build injected deps with controllable per-cell behavior. */
function deps(overrides: Partial<MatrixDeps> = {}): MatrixDeps {
  let n = 0;
  return {
    runProducer: () => {
      n += 1;
      return Promise.resolve({
        taskId: `task-${n}`,
        attemptN: 1,
        structure: {
          invalidSubmitCalls: 0,
          repairKinds: [],
          outputSource: 'tool' as const,
        },
      });
    },
    runGates: () => Promise.resolve(PASS),
    runJudge: () => Promise.resolve({ composite: 0.9 }),
    ...overrides,
  };
}

describe('runMatrix', () => {
  it('scores gate-only structure without calling the judge', async () => {
    let judgeCalls = 0;
    const shape = { ...scenario('shape'), scoring: 'gates_only' as const };
    const matrix = await runMatrix(
      ['m'],
      [shape],
      'judge-x',
      deps({
        runJudge: () => {
          judgeCalls += 1;
          return Promise.resolve({ composite: 0.2 });
        },
      }),
    );
    expect(judgeCalls).toBe(0);
    expect(matrix.cells[0]).toMatchObject({
      gatesPassed: true,
      composite: 1,
      judged: false,
    });
    const failed = await runMatrix(
      ['m'],
      [shape],
      'judge-x',
      deps({ runGates: () => Promise.resolve(FAIL) }),
    );
    expect(failed.cells[0]).toMatchObject({
      gatesPassed: false,
      composite: 0,
      judged: false,
    });
  });
  it.each([
    { repairs: [], outputSource: 'tool' as const, expected: 1 },
    {
      repairs: ['optional_null', 'submit_gate_verification'],
      outputSource: 'tool' as const,
      expected: 1,
    },
    { repairs: ['json_string'], outputSource: 'tool' as const, expected: 0 },
    {
      repairs: ['single_to_array'],
      outputSource: 'tool' as const,
      expected: 0,
    },
    { repairs: [], outputSource: null, expected: 0 },
    { repairs: [], outputSource: 'final_message' as const, expected: 0.5 },
    { repairs: [], outputSource: 'tool' as const, invalid: 1, expected: 0 },
    {
      repairs: [],
      outputSource: 'final_message' as const,
      invalid: 1,
      expected: 0,
    },
    {
      repairs: [],
      outputSource: 'tool' as const,
      unknown: ['renamed_kind'],
      expected: 0,
    },
  ] as Array<{
    repairs: SubmitRepairKind[];
    outputSource: 'tool' | 'final_message' | null;
    invalid?: number;
    unknown?: string[];
    expected: number;
  }>)(
    'scores raw model shape with repairs $repairs, invalid $invalid, unknown $unknown',
    async ({ repairs, outputSource, invalid, unknown, expected }) => {
      const shape = { ...scenario('shape'), scoring: 'gates_only' as const };
      const matrix = await runMatrix(
        ['m'],
        [shape],
        'judge-x',
        deps({
          runProducer: () =>
            Promise.resolve({
              taskId: 'task-1',
              attemptN: 1,
              structure: {
                invalidSubmitCalls: invalid ?? 0,
                repairKinds: repairs,
                ...(unknown ? { unknownRepairKinds: unknown } : {}),
                outputSource,
              },
            }),
        }),
      );
      expect(matrix.cells[0].composite).toBe(expected);
      expect(summarizeMatrix(matrix)).toContain(
        expected === 1
          ? 'SHAPE PASS [1/1]'
          : expected > 0
            ? `SHAPE PARTIAL [${expected}/1]`
            : 'SHAPE FAIL [0/1]',
      );
    },
  );

  it('fails shape-only scoring when structure telemetry is absent', async () => {
    const shape = { ...scenario('shape'), scoring: 'gates_only' as const };
    const matrix = await runMatrix(
      ['m'],
      [shape],
      'judge-x',
      deps({
        runProducer: () => Promise.resolve({ taskId: 'task-1', attemptN: 1 }),
      }),
    );
    expect(matrix.cells[0].composite).toBe(0);
  });
  it('copies observed structure telemetry into the score cell', async () => {
    const matrix = await runMatrix(
      ['m'],
      [scenario('s')],
      'judge-x',
      deps({
        runProducer: () =>
          Promise.resolve({
            taskId: 'task-1',
            attemptN: 1,
            structure: {
              invalidSubmitCalls: 2,
              repairKinds: ['json_string'],
              outputSource: 'tool',
            },
          }),
      }),
    );
    expect(matrix.cells[0]).toMatchObject({
      invalidSubmitCalls: 2,
      repairKinds: ['json_string'],
      outputSource: 'tool',
    });
  });
  it('sweeps every model x scenario and judges gate-passing attempts', async () => {
    // Arrange
    const models = ['model-a', 'model-b'];
    const scenarios = [scenario('s1'), scenario('s2')];

    // Act
    const matrix = await runMatrix(models, scenarios, 'judge-x', deps());

    // Assert
    expect(matrix.cells).toHaveLength(4);
    expect(matrix.judgeModel).toBe('judge-x');
    expect(matrix.cells.every((c) => c.judged)).toBe(true);
    expect(matrix.cells.every((c) => c.composite === 0.9)).toBe(true);
  });

  it('scales the judge composite by final-message submit credit', async () => {
    const matrix = await runMatrix(
      ['model-a'],
      [scenario('s1')],
      'judge-x',
      deps({
        runProducer: () =>
          Promise.resolve({
            taskId: 'task-1',
            attemptN: 1,
            structure: {
              invalidSubmitCalls: 0,
              repairKinds: [],
              outputSource: 'final_message' as const,
            },
          }),
      }),
    );

    expect(matrix.cells[0].judged).toBe(true);
    expect(matrix.cells[0].composite).toBeCloseTo(0.45);
  });

  it('skips the judge and scores composite 0 when gates fail (anti-inception)', async () => {
    // Arrange — gates fail for every cell.
    let judgeCalls = 0;
    const d = deps({
      runGates: () => Promise.resolve(FAIL),
      runJudge: () => {
        judgeCalls += 1;
        return Promise.resolve({ composite: 0.9 });
      },
    });

    // Act
    const matrix = await runMatrix(['m'], [scenario('s1')], 'judge-x', d);

    // Assert — judge never ran; composite pinned to 0.
    expect(judgeCalls).toBe(0);
    expect(matrix.cells[0].judged).toBe(false);
    expect(matrix.cells[0].composite).toBe(0);
    expect(matrix.cells[0].gatesPassed).toBe(false);
    expect(matrix.cells[0].gateFailures.map((f) => f.gate)).toContain('submit');
  });

  it('records an error cell when the producer throws, without aborting the sweep', async () => {
    // Arrange — first scenario throws, second succeeds.
    let call = 0;
    const d = deps({
      runProducer: () => {
        call += 1;
        if (call === 1) {
          return Promise.reject(new Error('vm boot failed'));
        }
        return Promise.resolve({ taskId: 'task-ok', attemptN: 1 });
      },
    });

    // Act
    const matrix = await runMatrix(
      ['m'],
      [scenario('s1'), scenario('s2')],
      'judge-x',
      d,
    );

    // Assert — the sweep continued; one error cell, one judged cell.
    expect(matrix.cells).toHaveLength(2);
    expect(matrix.cells[0].error).toContain('vm boot failed');
    expect(matrix.cells[0].composite).toBe(0);
    expect(matrix.cells[1].judged).toBe(true);
  });

  it('records a terminal producer failure code without invoking gates', async () => {
    let gateCalls = 0;
    const d = deps({
      runProducer: () =>
        Promise.resolve({
          taskId: 'task-failed',
          attemptN: null,
          failureCode: 'output_validation_failed',
        }),
      runGates: () => {
        gateCalls += 1;
        return Promise.resolve(PASS);
      },
    });

    const matrix = await runMatrix(['m'], [scenario('s1')], 'judge-x', d);

    expect(gateCalls).toBe(0);
    expect(matrix.cells[0]).toMatchObject({
      producerTaskId: 'task-failed',
      producerAttemptN: null,
      failureCode: 'output_validation_failed',
      composite: 0,
      judged: false,
    });
    expect(summarizeMatrix(matrix)).toContain(
      'PRODUCER FAIL [output_validation_failed]',
    );
  });
});

describe('summarizeMatrix', () => {
  it('renders a per-model mean and one line per scenario', async () => {
    const matrix = await runMatrix(
      ['model-a'],
      [scenario('s1'), scenario('s2')],
      'judge-x',
      deps(),
    );

    const summary = summarizeMatrix(matrix);

    expect(summary).toContain('judge: judge-x');
    expect(summary).toContain('model-a');
    expect(summary).toContain('mean judged 0.900');
    expect(summary).toContain('s1');
    expect(summary).toContain('s2');
  });
});
