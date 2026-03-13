/**
 * adapter.ts — AxGEPAAdapter implementation for context pack optimization
 *
 * When used with AxGEPA, the candidate is { instruction: "<pack content>" }
 * because AxGEPA internally optimizes the ax() program's instruction text.
 * We repurpose that as the context pack content injected into the worktree.
 *
 * make_reflective_dataset() builds ASI (Actionable Side Information) from
 * per-task failure traces so the reflection LLM knows *why* the pack failed.
 */

import type { AxGEPAAdapter, AxGEPAEvaluationBatch } from '@ax-llm/ax';

import { type EvalTrace, evaluateTask, type GpackTask } from './evaluate.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GpackOutput {
  taskId: string;
  score: number;
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class MoltNetContextAdapter implements AxGEPAAdapter<
  GpackTask,
  EvalTrace,
  GpackOutput
> {
  private verbose: boolean;
  private claudeModel: string;
  private lastBatch: readonly GpackTask[] = [];

  constructor(options: { verbose?: boolean; claudeModel?: string } = {}) {
    this.verbose = options.verbose ?? false;
    this.claudeModel = options.claudeModel ?? 'claude-sonnet-4-6';
  }

  /**
   * Evaluate a candidate pack against a batch of tasks.
   * The candidate is { instruction: "<pack content>" } — AxGEPA always uses
   * "instruction" as the component key for the ax() program's instruction text.
   */
  async evaluate(
    batch: readonly GpackTask[],
    candidate: Readonly<Record<string, string>>,
    captureTraces?: boolean,
  ): Promise<AxGEPAEvaluationBatch<EvalTrace, GpackOutput>> {
    // AxGEPA passes candidate as { instruction: "<text>" }
    const packContent =
      candidate['instruction'] ?? candidate['session_pack'] ?? '';
    this.lastBatch = batch;

    const outputs: GpackOutput[] = [];
    const scores: number[] = [];
    const trajectories: EvalTrace[] = [];

    for (const task of batch) {
      if (this.verbose) {
        console.log(
          `[gpack/adapter] task=${task.id} pack=${packContent.length}chars`,
        );
      }

      let result;
      try {
        result = await evaluateTask(task, packContent, {
          verbose: this.verbose,
          claudeModel: this.claudeModel,
        });
      } catch (err) {
        // Return a failed result rather than crashing the optimization run
        console.error(`[gpack/adapter] task=${task.id} error:`, err);
        outputs.push({ taskId: task.id, score: 0 });
        scores.push(0);
        if (captureTraces) {
          trajectories.push({
            taskId: task.id,
            taskPrompt: task.problemStatement,
            executor: 'anthropic-sdk',
            setupOutputs: [],
            preTaskTestOutputs: [],
            evalResult: `ERROR: ${String(err)}`,
            taskStepPassed: false,
            taskStepOutput: '',
            gitStatus: '',
            gitDiffStat: '',
            testsPassed: false,
            testOutputs: [],
            regressionOutputs: [],
          });
        }
        continue;
      }

      outputs.push({ taskId: task.id, score: result.score });
      scores.push(result.score);
      if (captureTraces) {
        trajectories.push(result.trace);
      }
    }

    return {
      outputs,
      scores,
      trajectories: captureTraces ? trajectories : null,
    };
  }

  /**
   * Build the reflective dataset GEPA's LLM uses to propose a better pack.
   * For each task we emit a record with what failed and why.
   */
  make_reflective_dataset(
    candidate: Readonly<Record<string, string>>,
    evalBatch: Readonly<AxGEPAEvaluationBatch<EvalTrace, GpackOutput>>,
    componentsToUpdate: readonly string[],
  ): Record<string, unknown[]> {
    const dataset: Record<string, unknown[]> = {};

    for (const component of componentsToUpdate) {
      dataset[component] = [];

      const traces = evalBatch.trajectories ?? [];
      const outputs = evalBatch.outputs;

      for (let i = 0; i < outputs.length; i++) {
        const output = outputs[i];
        const trace = traces[i];

        const failedTests = trace?.testOutputs
          .filter((t) => !t.passed)
          .map((t) => `FAIL: ${t.cmd}\n${t.output.slice(0, 500)}`)
          .join('\n');

        const failedSetup = trace?.setupOutputs
          .filter((s) => !s.passed)
          .map((s) => `SETUP FAIL: ${s.cmd}\n${s.output.slice(0, 500)}`)
          .join('\n');

        const failedRegressions = trace?.regressionOutputs
          .filter((t) => !t.passed)
          .map((t) => `REGRESSION: ${t.cmd}\n${t.output.slice(0, 300)}`)
          .join('\n');

        const evalSummary = trace?.evalResult
          ? `\nEval result:\n${trace.evalResult.slice(0, 800)}`
          : '';

        const feedback =
          output.score >= 1
            ? `✅ All tests passed (score=${output.score.toFixed(2)})`
            : [
                `❌ Score: ${output.score.toFixed(2)}`,
                failedSetup,
                trace?.taskStepPassed === false
                  ? 'TASK STEP FAILED: claude task execution failed'
                  : '',
                failedTests,
                failedRegressions,
                evalSummary,
              ]
                .filter(Boolean)
                .join('\n');

        const task = this.lastBatch.find((t) => t.id === output.taskId);
        dataset[component].push({
          Inputs: {
            task_id: output.taskId,
            task_description: task?.problemStatement.slice(0, 500) ?? '',
            validation_commands: task?.failToPass ?? [],
            current_pack_length: (candidate['instruction'] ?? '').length,
          },
          'Generated Outputs': {
            score: output.score,
            tests_passed: trace?.testsPassed ?? false,
          },
          Feedback: feedback,
        });
      }
    }

    return dataset;
  }
}
