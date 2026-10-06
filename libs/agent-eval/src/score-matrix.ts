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
import {
  SUBMIT_PROTOCOL_REPAIR_KINDS,
  type SubmitRepairKind,
} from '@moltnet/tasks';

import type { GateResult } from './check-gates.js';
import type { Scenario } from './scenario.js';

/** One producer run + its gate result + (if gates passed) the judge score. */
export interface ScoreCell {
  model: string;
  scenario: string;
  scoring: Scenario['scoring'];
  /** Producer task id (for traceability into the diary/telemetry). */
  producerTaskId: string | null;
  producerAttemptN: number | null;
  gatesPassed: boolean;
  gateFailures: GateResult['failures'];
  /** Judge score or gate-only shape score in [0,1]; 0 on gate failure. */
  composite: number;
  /** Whether the pinned judge actually ran (false when gates gated it out). */
  judged: boolean;
  invalidSubmitCalls: number;
  repairKinds: SubmitRepairKind[];
  unknownRepairKinds?: string[];
  outputSource: 'tool' | 'final_message' | null;
  /** Populated when the run threw before producing a gradable attempt. */
  error?: string;
  /** Terminal producer error code when the task ended without acceptance. */
  failureCode?: string;
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

// Protocol repairs do not change the model's output shape. Every other repair
// counts against a shape-only score.
const PROTOCOL_REPAIRS: ReadonlySet<SubmitRepairKind> = new Set(
  SUBMIT_PROTOCOL_REPAIR_KINDS,
);

export interface SubmitStructure {
  invalidSubmitCalls: number;
  repairKinds: SubmitRepairKind[];
  /**
   * Reported kinds outside the shared vocabulary. A non-empty list means the
   * executor and this scorer disagree; such runs score as repaired.
   */
  unknownRepairKinds?: string[];
  outputSource: 'tool' | 'final_message' | null;
}

/**
 * Credit for a valid payload the model sent as a JSON-only final message
 * instead of a submit tool call. The runtime recovered the output without a
 * reprompt, which beats a failed or reprompted attempt, but the model still
 * skipped the tool.
 */
export const FINAL_MESSAGE_SUBMIT_CREDIT = 0.5;

/** Protocol credit in [0,1] by how the accepted payload reached the runtime. */
export function submitProtocolCredit(
  structure: SubmitStructure | undefined,
): number {
  return structure?.outputSource === 'final_message'
    ? FINAL_MESSAGE_SUBMIT_CREDIT
    : 1;
}

/** Raw submit-shape score in [0,1]: 1 for a clean submit tool call, partial
 * credit for a clean JSON-only final message, 0 otherwise. */
export function submitShapeScore(
  structure: SubmitStructure | undefined,
): number {
  if (
    !structure?.outputSource ||
    structure.invalidSubmitCalls > 0 ||
    (structure.unknownRepairKinds?.length ?? 0) > 0 ||
    !structure.repairKinds.every((kind) => PROTOCOL_REPAIRS.has(kind))
  ) {
    return 0;
  }
  return submitProtocolCredit(structure);
}

/** Whether the model supplied a valid submit shape before runtime repair. */
export function isCleanSubmitShape(
  structure: SubmitStructure | undefined,
): boolean {
  return submitShapeScore(structure) === 1;
}

/**
 * Effects the matrix runner needs, injected so the orchestration stays pure.
 */
export interface MatrixDeps {
  /**
   * Run one scenario's producer against `model`. Returns the accepted task id +
   * attempt number, or a terminal failure code when no attempt was accepted.
   * Implemented by the e2e runner via runtime-profile create + runOnce.
   */
  runProducer(
    model: string,
    scenario: Scenario,
  ): Promise<{
    taskId: string;
    attemptN: number | null;
    failureCode?: string;
    structure?: SubmitStructure;
  }>;
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
        scoring: scenario.scoring,
        producerTaskId: null,
        producerAttemptN: null,
        gatesPassed: false,
        gateFailures: [],
        composite: 0,
        judged: false,
        invalidSubmitCalls: 0,
        repairKinds: [],
        outputSource: null,
      };

      try {
        const producer = await deps.runProducer(model, scenario);
        base.producerTaskId = producer.taskId;
        base.producerAttemptN = producer.attemptN;
        if (producer.structure) {
          base.invalidSubmitCalls = producer.structure.invalidSubmitCalls;
          base.repairKinds = producer.structure.repairKinds;
          base.unknownRepairKinds = producer.structure.unknownRepairKinds;
          base.outputSource = producer.structure.outputSource;
        }

        if (producer.attemptN === null) {
          base.failureCode = producer.failureCode ?? 'unknown';
          log(
            `[${model}] ${scenario.slug}: PRODUCER FAILED (${base.failureCode})`,
          );
          cells.push(base);
          continue;
        }

        const acceptedProducer = {
          taskId: producer.taskId,
          attemptN: producer.attemptN,
        };

        const gates = await deps.runGates(model, scenario, acceptedProducer);
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

        if (scenario.scoring === 'gates_only') {
          base.composite = submitShapeScore(producer.structure);
          log(
            `[${model}] ${scenario.slug}: shape ${base.composite === 1 ? 'pass' : base.composite > 0 ? 'partial' : 'fail'}, composite ${base.composite}`,
          );
          cells.push(base);
          continue;
        }

        const judgment = await deps.runJudge(scenario, acceptedProducer);
        base.composite =
          judgment.composite * submitProtocolCredit(producer.structure);
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
    const judgedCells = modelCells.filter((c) => c.scoring === 'judge');
    const shapeCells = modelCells.filter((c) => c.scoring === 'gates_only');
    const mean =
      judgedCells.length === 0
        ? 0
        : judgedCells.reduce((sum, c) => sum + c.composite, 0) /
          judgedCells.length;
    const parts = [];
    if (judgedCells.length > 0) parts.push(`mean judged ${mean.toFixed(3)}`);
    if (shapeCells.length > 0) {
      const score = shapeCells.reduce((sum, c) => sum + c.composite, 0);
      parts.push(`shape ${score}/${shapeCells.length}`);
    }
    lines.push(`\n${model}  (${parts.join(', ')})`);
    for (const cell of modelCells) {
      const status = cell.error
        ? `ERROR ${cell.error}`
        : cell.failureCode
          ? `PRODUCER FAIL [${cell.failureCode}]`
          : cell.gatesPassed
            ? cell.scoring === 'gates_only'
              ? `SHAPE ${cell.composite === 1 ? 'PASS' : cell.composite > 0 ? 'PARTIAL' : 'FAIL'} [${cell.composite}/1]`
              : `composite ${cell.composite.toFixed(3)}`
            : `GATE FAIL [${cell.gateFailures.map((f) => f.gate).join(',')}]`;
      const submitClean =
        cell.producerAttemptN === null
          ? 'n/a'
          : cell.gateFailures.some((failure) => failure.gate === 'submit_clean')
            ? '0/1'
            : '1/1';
      lines.push(
        `  ${cell.scenario.padEnd(32)} ${status} ` +
          `submit-clean=${submitClean} invalid=${cell.invalidSubmitCalls} ` +
          `source=${cell.outputSource ?? 'unknown'} ` +
          `repairs=${
            [...cell.repairKinds, ...(cell.unknownRepairKinds ?? [])].join(
              ',',
            ) || 'none'
          }`,
      );
    }
  }
  return lines.join('\n');
}
