/**
 * Model-matrix sweep orchestration for the nightly eval lane.
 *
 * `runMatrix` is the pure control flow: for each (model × scenario) it runs the
 * producer, checks stage-1 deterministic gates, and — only if the gates pass —
 * runs the pinned-model judge to get a composite score. Gate failure short-
 * circuits to composite 0 with the judge skipped (the anti-inception rule).
 *
 * All live-stack effects (creating profiles, running the daemon, reading judge
 * output) are injected via `MatrixDeps`, so this module is unit-testable with
 * fakes and carries no runtime dependency on the daemon or SDK. The thin
 * runner that wires the real effects lives with the e2e project.
 */
import type { GateResult } from './check-gates.js';
import type { Scenario } from './scenario.js';

/** One producer run + its gate result + (if gates passed) the judge score. */
export interface ScoreCell {
  model: string;
  scenario: string;
  /** Producer task id (for traceability into the diary/telemetry). */
  producerTaskId: string | null;
  producerAttemptN: number | null;
  gatesPassed: boolean;
  gateFailures: GateResult['failures'];
  /** Judge composite in [0,1]; 0 when gates failed or the judge was skipped. */
  composite: number;
  /** Whether the pinned judge actually ran (false when gates gated it out). */
  judged: boolean;
  /** Populated when the run threw before producing a gradable attempt. */
  error?: string;
}

export interface ScoreMatrix {
  /** Producer models swept, in order. */
  models: string[];
  /** Scenario slugs swept, in order. */
  scenarios: string[];
  /** The pinned judge model held constant across the whole sweep. */
  judgeModel: string;
  cells: ScoreCell[];
}

/**
 * Effects the matrix runner needs, injected so the orchestration stays pure.
 */
export interface MatrixDeps {
  /**
   * Run one scenario's producer against `model`. Returns the accepted task id +
   * attempt number, or throws on failure. Implemented by the e2e runner via
   * runtime-profile create + runOnce.
   */
  runProducer(
    model: string,
    scenario: Scenario,
  ): Promise<{ taskId: string; attemptN: number }>;
  /**
   * Evaluate stage-1 deterministic gates for a producer attempt.
   */
  runGates(
    model: string,
    scenario: Scenario,
    producer: { taskId: string; attemptN: number },
  ): Promise<GateResult>;
  /**
   * Run the pinned-model judge over an accepted producer attempt and return the
   * composite in [0,1]. Only called for gate-passing attempts.
   */
  runJudge(
    scenario: Scenario,
    producer: { taskId: string; attemptN: number },
  ): Promise<{ composite: number }>;
  /** Optional progress log. */
  log?(message: string): void;
}

/**
 * Sweep every (model × scenario), gating the judge behind stage-1 gates.
 *
 * @param models - Producer models to sweep.
 * @param scenarios - Parsed scenarios.
 * @param judgeModel - The pinned judge model (recorded in the matrix; the actual
 *   pinning happens inside `deps.runJudge`).
 * @param deps - Injected live-stack effects.
 */
export async function runMatrix(
  models: string[],
  scenarios: Scenario[],
  judgeModel: string,
  deps: MatrixDeps,
): Promise<ScoreMatrix> {
  const cells: ScoreCell[] = [];
  const log = (message: string): void => deps.log?.(message);

  for (const model of models) {
    for (const scenario of scenarios) {
      const base: ScoreCell = {
        model,
        scenario: scenario.slug,
        producerTaskId: null,
        producerAttemptN: null,
        gatesPassed: false,
        gateFailures: [],
        composite: 0,
        judged: false,
      };

      try {
        const producer = await deps.runProducer(model, scenario);
        base.producerTaskId = producer.taskId;
        base.producerAttemptN = producer.attemptN;

        const gates = await deps.runGates(model, scenario, producer);
        base.gatesPassed = gates.passed;
        base.gateFailures = gates.failures;

        if (!gates.passed) {
          // Anti-inception: a gate failure means composite 0, judge skipped.
          log(
            `[${model}] ${scenario.slug}: GATES FAILED (${gates.failures
              .map((f) => f.gate)
              .join(',')}) → composite 0, judge skipped`,
          );
          cells.push(base);
          continue;
        }

        const judgment = await deps.runJudge(scenario, producer);
        base.composite = judgment.composite;
        base.judged = true;
        log(
          `[${model}] ${scenario.slug}: gates passed, composite ${judgment.composite.toFixed(3)}`,
        );
      } catch (err) {
        base.error = err instanceof Error ? err.message : String(err);
        log(`[${model}] ${scenario.slug}: ERROR ${base.error}`);
      }

      cells.push(base);
    }
  }

  return {
    models,
    scenarios: scenarios.map((s) => s.slug),
    judgeModel,
    cells,
  };
}

/**
 * Render a compact human-readable summary of a score matrix — one line per
 * (model, scenario) plus a per-model mean composite. Deterministic; safe to log
 * or snapshot.
 */
export function summarizeMatrix(matrix: ScoreMatrix): string {
  const lines: string[] = [];
  lines.push(`judge: ${matrix.judgeModel}`);
  for (const model of matrix.models) {
    const modelCells = matrix.cells.filter((c) => c.model === model);
    const mean =
      modelCells.length === 0
        ? 0
        : modelCells.reduce((sum, c) => sum + c.composite, 0) /
          modelCells.length;
    lines.push(`\n${model}  (mean composite ${mean.toFixed(3)})`);
    for (const cell of modelCells) {
      const status = cell.error
        ? `ERROR ${cell.error}`
        : cell.gatesPassed
          ? `composite ${cell.composite.toFixed(3)}`
          : `GATE FAIL [${cell.gateFailures.map((f) => f.gate).join(',')}]`;
      lines.push(`  ${cell.scenario.padEnd(32)} ${status}`);
    }
  }
  return lines.join('\n');
}
