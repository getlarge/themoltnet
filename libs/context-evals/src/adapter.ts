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

import type {
  AxAIService,
  AxGEPAAdapter,
  AxGEPAEvaluationBatch,
} from '@ax-llm/ax';
import fastq from 'fastq';

import type { EvalCache } from './eval-cache.js';
import { type EvalTrace, evaluateTask, type GpackTask } from './evaluate.js';
import { proposeNewTexts } from './propose-texts.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GpackOutput {
  taskId: string;
  score: number;
}

interface TaskResult {
  index: number;
  output: GpackOutput;
  score: number;
  trajectory?: EvalTrace;
}

export interface MoltNetContextAdapterOptions {
  verbose?: boolean;
  claudeModel?: string;
  concurrency?: number;
  /** AI service for propose_new_texts reflection. Typically the teacher model. */
  reflectionAI?: AxAIService;
  /** Shared cache — also consulted by metricFn via gepa.ts. */
  evalCache?: EvalCache<EvalTrace>;
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class MoltNetContextAdapter implements AxGEPAAdapter<
  GpackTask,
  EvalTrace,
  GpackOutput
> {
  private verbose: boolean;
  private claudeModel: string;
  private concurrency: number;
  private reflectionAI?: AxAIService;
  private evalCache?: EvalCache<EvalTrace>;
  private lastBatch: readonly GpackTask[] = [];

  constructor(options: MoltNetContextAdapterOptions = {}) {
    this.verbose = options.verbose ?? false;
    this.claudeModel = options.claudeModel ?? 'claude-sonnet-4-6';
    this.concurrency = options.concurrency ?? 1;
    this.reflectionAI = options.reflectionAI;
    this.evalCache = options.evalCache;
  }

  /** Set the reflection AI after construction (e.g. when teacher is resolved later). */
  setReflectionAI(ai: AxAIService): void {
    this.reflectionAI = ai;
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
    const packContent =
      candidate['instruction'] ?? candidate['session_pack'] ?? '';
    this.lastBatch = batch;

    const worker = async (item: {
      task: GpackTask;
      index: number;
    }): Promise<TaskResult> => {
      const { task, index } = item;
      if (this.verbose) {
        console.log(
          `[gpack/adapter] task=${task.id} pack=${packContent.length}chars`,
        );
      }

      try {
        const result = await evaluateTask(task, packContent, {
          verbose: this.verbose,
          claudeModel: this.claudeModel,
        });
        return {
          index,
          output: { taskId: task.id, score: result.score },
          score: result.score,
          trajectory: captureTraces ? result.trace : undefined,
        };
      } catch (err) {
        console.error(`[gpack/adapter] task=${task.id} error:`, err);
        return {
          index,
          output: { taskId: task.id, score: 0 },
          score: 0,
          trajectory: captureTraces
            ? {
                taskId: task.id,
                taskPrompt: task.problemStatement,
                executor: 'anthropic-sdk' as const,
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
              }
            : undefined,
        };
      }
    };

    const q = fastq.promise(worker, this.concurrency);
    const results = await Promise.all(
      batch.map((task, index) => q.push({ task, index })),
    );

    // Sort by original index to preserve batch ordering
    results.sort((a, b) => a.index - b.index);

    return {
      outputs: results.map((r) => r.output),
      scores: results.map((r) => r.score),
      trajectories: captureTraces ? results.map((r) => r.trajectory!) : null,
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

        // Enrich with agent trace data when available
        const agentMetrics = trace
          ? [
              trace.turnCount !== undefined && trace.turnCount !== null
                ? `Turns: ${trace.turnCount}`
                : '',
              trace.taskCostUsd !== undefined && trace.taskCostUsd !== null
                ? `Cost: $${trace.taskCostUsd.toFixed(4)}`
                : '',
              trace.toolSummaries?.length
                ? `Tool calls: ${trace.toolSummaries.join(', ')}`
                : '',
            ]
              .filter(Boolean)
              .join(' | ')
          : '';

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
          Feedback: agentMetrics
            ? `${feedback}\n\nAgent metrics: ${agentMetrics}`
            : feedback,
        });
      }
    }

    return dataset;
  }

  async propose_new_texts(
    candidate: Readonly<Record<string, string>>,
    reflectiveDataset: Readonly<Record<string, unknown[]>>,
    componentsToUpdate: readonly string[],
  ): Promise<Record<string, string>> {
    return proposeNewTexts({
      reflectionAI: this.reflectionAI,
      candidate,
      reflectiveDataset,
      componentsToUpdate,
    });
  }
}
