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
      return Promise.resolve({ taskId: `task-${n}`, attemptN: 1 });
    },
    runGates: () => Promise.resolve(PASS),
    runJudge: () => Promise.resolve({ composite: 0.9 }),
    ...overrides,
  };
}

describe('runMatrix', () => {
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
    expect(summary).toContain('mean composite 0.900');
    expect(summary).toContain('s1');
    expect(summary).toContain('s2');
  });
});
