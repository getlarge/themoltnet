/**
 * Producer baseline measurement.
 *
 * The eval-engineering discipline says a baseline must be MEASURED, not
 * estimated: run each scenario independently N times (>=4 for reporting) with a
 * runner that has no knowledge of the trap, and report the raw pass rate. This
 * is deliberately NOT the per-PR smoke's retry-until-pass — a baseline counts
 * EVERY run so the true pass rate (and its failure modes) are visible.
 *
 * The producer is trap-blind by construction: it only ever sees `prompt.md`,
 * never the hidden rubric or the code gates. `runBaseline` is pure orchestration
 * with all live-stack effects injected via `BaselineDeps`, mirroring
 * `runMatrix` — so it is unit-testable with fakes and carries no daemon/SDK
 * dependency.
 */
import type { GateResult } from './check-gates.js';
import type { Scenario, ScenarioTaskType } from './scenario.js';

/** Non-gate failure-mode keys, alongside the per-gate keys from `GateFailure`. */
export const NOT_COMPLETED = 'not_completed';
export const RUN_ERROR = 'error';

/** One independent producer run of a scenario. */
export interface BaselineRun {
  /** 1-based run index. */
  run: number;
  producerTaskId: string | null;
  producerAttemptN: number | null;
  /** The task reached `completed` with an accepted attempt. */
  completed: boolean;
  /** Gates were evaluated AND all passed (only meaningful when completed). */
  gatesPassed: boolean;
  gateFailures: GateResult['failures'];
  /** Set when the run threw before producing a gradable attempt. */
  error?: string;
}

/** Aggregated result for one scenario across all repeats. */
export interface BaselineScenarioResult {
  scenario: string;
  taskType: ScenarioTaskType;
  runs: number;
  /** Runs that completed AND passed every gate. */
  passes: number;
  /** `passes / runs` in [0,1]. */
  passRate: number;
  /**
   * Failure-mode histogram: each failed run contributes to exactly one key —
   * a gate name, `not_completed` (task never reached a gradable attempt), or
   * `error` (the run threw).
   */
  failureModes: Record<string, number>;
  cells: BaselineRun[];
}

export interface BaselineReport {
  model: string;
  repeats: number;
  scenarios: BaselineScenarioResult[];
}

/** Effects the baseline runner needs, injected so orchestration stays pure. */
export interface BaselineDeps {
  /**
   * Run one independent producer attempt for `scenario` (fresh task = fresh
   * sampling). Returns the task id and the accepted attempt number, or
   * `attemptN: null` when the task did not complete with an accepted attempt.
   * Must NOT throw on a producer task failure — that is a recorded data point.
   */
  runProducer(
    scenario: Scenario,
    run: number,
  ): Promise<{ taskId: string | null; attemptN: number | null }>;
  /** Evaluate stage-1 gates for a completed attempt. */
  runGates(
    scenario: Scenario,
    producer: { taskId: string; attemptN: number },
  ): Promise<GateResult>;
  log?(message: string): void;
}

function bump(hist: Record<string, number>, key: string): void {
  hist[key] = (hist[key] ?? 0) + 1;
}

/**
 * Measure the producer baseline: each scenario run `repeats` times against
 * `model`, gate-graded, counting every run.
 */
export async function runBaseline(
  scenarios: Scenario[],
  model: string,
  repeats: number,
  deps: BaselineDeps,
): Promise<BaselineReport> {
  const log = (m: string): void => deps.log?.(m);
  const results: BaselineScenarioResult[] = [];

  for (const scenario of scenarios) {
    const cells: BaselineRun[] = [];
    const failureModes: Record<string, number> = {};
    let passes = 0;

    for (let run = 1; run <= repeats; run++) {
      const cell: BaselineRun = {
        run,
        producerTaskId: null,
        producerAttemptN: null,
        completed: false,
        gatesPassed: false,
        gateFailures: [],
      };

      try {
        const producer = await deps.runProducer(scenario, run);
        cell.producerTaskId = producer.taskId;
        cell.producerAttemptN = producer.attemptN;

        if (producer.taskId === null || producer.attemptN === null) {
          bump(failureModes, NOT_COMPLETED);
          log(`[${scenario.slug}] run ${run}/${repeats}: not completed`);
        } else {
          cell.completed = true;
          const gates = await deps.runGates(scenario, {
            taskId: producer.taskId,
            attemptN: producer.attemptN,
          });
          cell.gatesPassed = gates.passed;
          cell.gateFailures = gates.failures;
          if (gates.passed) {
            passes++;
            log(`[${scenario.slug}] run ${run}/${repeats}: PASS`);
          } else {
            for (const f of gates.failures) bump(failureModes, f.gate);
            log(
              `[${scenario.slug}] run ${run}/${repeats}: gate fail [${gates.failures
                .map((f) => f.gate)
                .join(',')}]`,
            );
          }
        }
      } catch (err) {
        cell.error = err instanceof Error ? err.message : String(err);
        bump(failureModes, RUN_ERROR);
        log(`[${scenario.slug}] run ${run}/${repeats}: ERROR ${cell.error}`);
      }

      cells.push(cell);
    }

    results.push({
      scenario: scenario.slug,
      taskType: scenario.taskType,
      runs: repeats,
      passes,
      passRate: repeats === 0 ? 0 : passes / repeats,
      failureModes,
      cells,
    });
  }

  return { model, repeats, scenarios: results };
}

/**
 * Render a compact human-readable baseline table — one line per scenario with
 * its pass rate and dominant failure modes. Deterministic; safe to log/snapshot.
 */
export function summarizeBaseline(report: BaselineReport): string {
  const lines: string[] = [];
  lines.push(
    `producer baseline — model ${report.model}, ${report.repeats} runs/scenario`,
  );
  for (const s of report.scenarios) {
    const pct = (s.passRate * 100).toFixed(0);
    const modes = Object.entries(s.failureModes)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}×${n}`)
      .join(', ');
    lines.push(
      `  ${s.scenario.padEnd(34)} ${String(s.passes).padStart(2)}/${s.runs} (${pct.padStart(3)}%)` +
        (modes ? `  fail: ${modes}` : ''),
    );
  }
  return lines.join('\n');
}
