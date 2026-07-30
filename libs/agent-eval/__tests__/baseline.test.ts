import { describe, expect, it } from 'vitest';

import {
  type BaselineDeps,
  runBaseline,
  summarizeBaseline,
} from '../src/baseline.js';
import type { GateResult } from '../src/check-gates.js';
import type { Scenario } from '../src/scenario.js';

function scenario(slug: string, taskType: Scenario['taskType']): Scenario {
  return {
    slug,
    taskType,
    prompt: 'do the thing',
    execution: { mode: 'vitro', workspace: 'none' },
    rubric: { rubricId: slug, version: 'v1', criteria: [] },
    gates: {},
  };
}

const PASS: GateResult = { passed: true, failures: [] };
function fail(...gates: string[]): GateResult {
  return {
    passed: false,
    failures: gates.map((gate) => ({ gate, detail: `${gate} failed` })),
  };
}

/**
 * Build deps whose producer/gates are scripted per run. `script[slug]` is an
 * array of outcomes, one per run: `null` = producer did not complete;
 * `'throw'` = producer throws; otherwise a GateResult the gates return.
 */
function scriptedDeps(
  script: Record<string, Array<GateResult | null | 'throw'>>,
): BaselineDeps {
  const idx: Record<string, number> = {};
  return {
    runProducer: (s) => {
      const i = idx[s.slug] ?? 0;
      idx[s.slug] = i + 1;
      const outcome = script[s.slug]?.[i];
      if (outcome === 'throw') throw new Error('producer boom');
      if (outcome === null) {
        return Promise.resolve({ taskId: null, attemptN: null });
      }
      return Promise.resolve({ taskId: `${s.slug}-t${i}`, attemptN: 1 });
    },
    runGates: (s) => {
      // Gates read the SAME run index the producer just advanced (i-1).
      const i = (idx[s.slug] ?? 1) - 1;
      const outcome = script[s.slug]?.[i];
      return Promise.resolve(outcome && outcome !== 'throw' ? outcome : PASS);
    },
  };
}

describe('runBaseline', () => {
  it('counts every run and reports the raw pass rate (no retry-until-pass)', async () => {
    // 4 runs: pass, fail(submit), pass, not-completed → 2/4 = 50%.
    const deps = scriptedDeps({
      flaky: [PASS, fail('submit'), PASS, null],
    });

    const report = await runBaseline(
      [scenario('flaky', 'run_eval')],
      'm',
      4,
      deps,
    );

    const s = report.scenarios[0];
    expect(s.runs).toBe(4);
    expect(s.passes).toBe(2);
    expect(s.passRate).toBe(0.5);
    expect(s.cells).toHaveLength(4);
    expect(s.failureModes).toEqual({ submit: 1, not_completed: 1 });
  });

  it('buckets non-completions by their specific failure code when known', async () => {
    const deps: BaselineDeps = {
      runProducer: (_s, run) =>
        Promise.resolve(
          run === 1
            ? { taskId: 't', attemptN: 1 }
            : {
                taskId: 't',
                attemptN: null,
                failureCode: 'output_validation_failed',
              },
        ),
      runGates: () => Promise.resolve(PASS),
    };

    const report = await runBaseline([scenario('s', 'run_eval')], 'm', 3, deps);

    const s = report.scenarios[0];
    expect(s.passes).toBe(1);
    // Two non-completions bucketed under the real code, not a flat 'not_completed'.
    expect(s.failureModes).toEqual({ output_validation_failed: 2 });
    expect(s.cells[1].failureCode).toBe('output_validation_failed');
  });

  it('records producer throws as an error failure mode without aborting the sweep', async () => {
    const deps = scriptedDeps({
      s1: ['throw', PASS],
    });

    const report = await runBaseline(
      [scenario('s1', 'freeform')],
      'm',
      2,
      deps,
    );

    const s = report.scenarios[0];
    expect(s.passes).toBe(1);
    expect(s.passRate).toBe(0.5);
    expect(s.failureModes).toEqual({ error: 1 });
    expect(s.taskType).toBe('freeform');
  });

  it('tallies gate failure modes across runs', async () => {
    const deps = scriptedDeps({
      s: [
        fail('verification_contract'),
        fail('verification_contract', 'model'),
      ],
    });

    const report = await runBaseline([scenario('s', 'run_eval')], 'm', 2, deps);

    expect(report.scenarios[0].passes).toBe(0);
    expect(report.scenarios[0].failureModes).toEqual({
      verification_contract: 2,
      model: 1,
    });
  });

  it('summarizes pass rates and dominant failure modes deterministically', async () => {
    const deps = scriptedDeps({
      alpha: [PASS, PASS],
      beta: [fail('submit'), fail('submit')],
    });

    const report = await runBaseline(
      [scenario('alpha', 'run_eval'), scenario('beta', 'freeform')],
      'gpt-oss:120b-cloud',
      2,
      deps,
    );
    const summary = summarizeBaseline(report);

    expect(summary).toContain('model gpt-oss:120b-cloud, 2 runs/scenario');
    expect(summary).toContain('alpha');
    expect(summary).toMatch(/alpha\s+2\/2 \(100%\)/);
    expect(summary).toMatch(/beta\s+0\/2 \(\s*0%\)\s+fail: submit×2/);
  });
});
