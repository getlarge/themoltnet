/** gepa.ts — Shared GEPA runner infrastructure for gpack and skill-eval pipelines. */

import type {
  AxAIService,
  AxGEPAAdapter,
  AxGEPAEvaluationBatch,
  AxTypedExample,
} from '@ax-llm/ax';
import { ax, AxGEPA } from '@ax-llm/ax';

import { buildAverage, buildCacheKey } from './pipeline-shared.js';

// ── Replica handling ──────────────────────────────────────────────────────────

/**
 * GEPA requires at least 2 training examples. If only one task is provided,
 * duplicate it with a `-replica` suffix so the optimizer can run.
 */
export function buildReplicas<T extends { id: string }>(tasks: T[]): T[] {
  if (tasks.length >= 2) return tasks;
  return [...tasks, { ...tasks[0], id: `${tasks[0].id}-replica` }];
}

// ── Metric caching ────────────────────────────────────────────────────────────

/**
 * Wraps an evaluator function with a content-hash cache keyed by task ID and
 * instruction content. Identical (taskId, instruction) pairs return the cached
 * result without re-running the evaluator.
 */
export function buildMetricFn<TTrace>(
  evaluator: (
    taskId: string,
    instruction: string,
  ) => Promise<EvalOneResult<TTrace>>,
): (taskId: string, instruction: string) => Promise<EvalOneResult<TTrace>> {
  const cache = new Map<string, EvalOneResult<TTrace>>();
  return async (
    taskId: string,
    instruction: string,
  ): Promise<EvalOneResult<TTrace>> => {
    const key = buildCacheKey(taskId, instruction);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const result = await evaluator(taskId, instruction);
    cache.set(key, result);
    return result;
  };
}

// ── Runner interfaces ─────────────────────────────────────────────────────────

export type TaskExample = Readonly<
  AxTypedExample<Record<string, unknown> & { id: string }>
>;

/** Result from a single evaluation, optionally including a trace. */
export interface EvalOneResult<TTrace> {
  score: number;
  trace?: TTrace;
}

/** Entry emitted via onEvalComplete after each adapter.evaluate() call. */
export interface EvalTraceEntry<TTrace> {
  round: number;
  scores: number[];
  averageScore: number;
  instructionLength: number;
  trajectories: TTrace[] | null;
  timestamp: string;
}

export interface GepaRunnerOptions<
  TTask,
  TTrace,
  TOutput,
  TExample extends TaskExample = TaskExample,
> {
  tasks: TTask[];
  adapter: AxGEPAAdapter<TTask, TTrace, TOutput>;
  seedInstruction: string;
  studentAI: AxAIService;
  teacherAI?: AxAIService;
  numTrials: number;
  maxMetricCalls: number;
  verbose?: boolean;
  /** ax() program signature. Default: 'taskPrompt:string -> optimizedInstruction:string' */
  axSignature?: string;
  /** Build training examples from the (possibly replicated) task list. */
  buildExamples: (tasks: TTask[]) => TExample[];
  /** Evaluate a single task with the given instruction; returns score and optional trace. */
  evaluateOne: (
    task: TTask,
    instruction: string,
  ) => Promise<EvalOneResult<TTrace>>;
  /**
   * Called after each adapter.evaluate() completes — use for incremental
   * trace persistence. Fires on every GEPA evaluation round (both parent
   * and child instruction evaluations).
   */
  onEvalComplete?: (entry: EvalTraceEntry<TTrace>) => void | Promise<void>;
}

export interface GepaRunnerResult<TTrace> {
  bestScore: number;
  bestInstruction: string;
  traces: EvalTraceEntry<TTrace>[];
}

// ── Tracing adapter wrapper ──────────────────────────────────────────────────

/**
 * Wraps an AxGEPAAdapter to intercept evaluate() calls and collect traces.
 * GEPA uses adapter.evaluate() for all scoring when gepaAdapter is provided,
 * so this is the only reliable place to observe scores and trajectories.
 */
function wrapAdapterWithTracing<TTask, TTrace, TOutput>(
  adapter: AxGEPAAdapter<TTask, TTrace, TOutput>,
  onEvaluate: (
    instruction: string,
    batch: AxGEPAEvaluationBatch<TTrace, TOutput>,
  ) => void | Promise<void>,
): AxGEPAAdapter<TTask, TTrace, TOutput> {
  return {
    evaluate: async (
      batch: readonly TTask[],
      candidate: Readonly<Record<string, string>>,
      captureTraces?: boolean,
    ) => {
      const result = await adapter.evaluate(batch, candidate, captureTraces);
      const instruction = candidate.instruction ?? '';
      await onEvaluate(instruction, result);
      return result;
    },
    make_reflective_dataset: adapter.make_reflective_dataset.bind(adapter),
    propose_new_texts: adapter.propose_new_texts?.bind(adapter),
  };
}

// ── Full GEPA compile loop ────────────────────────────────────────────────────

export async function runGepaOptimization<
  TTask extends { id: string },
  TTrace,
  TOutput,
  TExample extends TaskExample,
>(
  options: GepaRunnerOptions<TTask, TTrace, TOutput, TExample>,
): Promise<GepaRunnerResult<TTrace>> {
  const {
    tasks,
    adapter,
    seedInstruction,
    studentAI,
    teacherAI,
    numTrials,
    maxMetricCalls,
    verbose,
    axSignature = 'taskPrompt:string -> optimizedInstruction:string',
    buildExamples,
    evaluateOne,
    onEvalComplete,
  } = options;

  const trainingTasks = buildReplicas(tasks);

  const program = ax(axSignature);
  program.setInstruction(seedInstruction);

  const optimizer = new AxGEPA({
    studentAI,
    ...(teacherAI ? { teacherAI } : {}),
    numTrials,
    verbose,
    seed: 42,
  });

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const trainingExamples = buildExamples(trainingTasks);
  const allTraces: EvalTraceEntry<TTrace>[] = [];
  let evalRound = 0;

  // Wrap the adapter to intercept evaluate() calls for tracing.
  // GEPA calls adapter.evaluate() for all scoring decisions when gepaAdapter
  // is provided — this is the only reliable observation point.
  const tracingAdapter = wrapAdapterWithTracing<TTask, TTrace, TOutput>(
    adapter,
    async (instruction, batch) => {
      evalRound++;
      const entry: EvalTraceEntry<TTrace> = {
        round: evalRound,
        scores: batch.scores,
        averageScore: buildAverage(batch.scores),
        instructionLength: instruction.length,
        trajectories: batch.trajectories ?? null,
        timestamp: new Date().toISOString(),
      };
      allTraces.push(entry);
      await onEvalComplete?.(entry);
    },
  );

  // The metric function is called by GEPA via program.forward() → metricFn.
  // With gepaAdapter, GEPA primarily uses adapter.evaluate() for scoring,
  // but still calls program.forward() for the Pareto archive. We return
  // { score: N } as Record<string, number> since GEPA v19 does
  // Object.entries() on the return value (not normalizeScores).
  const cachedEvaluate = buildMetricFn<TTrace>(
    async (
      taskId: string,
      instruction: string,
    ): Promise<EvalOneResult<TTrace>> => {
      const task = taskById.get(taskId);
      if (!task) return { score: 0 };
      return evaluateOne(task, instruction);
    },
  );

  const getCurrentInstruction = (): string =>
    (program as { instruction?: string }).instruction ?? seedInstruction;

  const metricFn = async ({
    example,
  }: Readonly<{ example: Record<string, unknown> }>) => {
    const taskId =
      typeof example.id === 'string' ? example.id.replace(/-replica$/, '') : '';
    const instruction = getCurrentInstruction();
    const evalResult = await cachedEvaluate(taskId, instruction);
    return { score: evalResult.score };
  };

  const result = await optimizer.compile(
    program,
    trainingExamples,
    // AxGEPA v19 expects Record<string, number> at runtime but types say number.
    metricFn as unknown as Parameters<typeof optimizer.compile>[2],
    {
      maxMetricCalls,
      gepaAdapter: tracingAdapter,
      feedbackExamples: trainingExamples,
      validationExamples: trainingExamples,
    },
  );

  // Derive bestScore from adapter traces (reliable) rather than GEPA's
  // Pareto front (depends on program.forward() producing valid predictions).
  const adapterBestScore =
    allTraces.length > 0
      ? Math.max(...allTraces.map((t) => t.averageScore))
      : 0;

  return {
    bestScore: Math.max(result.bestScore, adapterBestScore),
    bestInstruction: result.optimizedProgram?.instruction ?? seedInstruction,
    traces: allTraces,
  };
}

// ── Baseline runner ───────────────────────────────────────────────────────────

export interface BaselineResult<TTrace> {
  scores: number[];
  averageScore: number;
  trajectories: TTrace[] | null;
}

/**
 * Run a single evaluation pass with a fixed instruction. Used to establish
 * a baseline before running GEPA optimization.
 */
export async function runBaseline<TTask, TTrace, TOutput>(
  adapter: AxGEPAAdapter<TTask, TTrace, TOutput>,
  tasks: TTask[],
  instruction: string,
): Promise<BaselineResult<TTrace>> {
  const evalResult = await adapter.evaluate(tasks, { instruction }, true);
  return {
    scores: evalResult.scores,
    averageScore: buildAverage(evalResult.scores),
    trajectories: evalResult.trajectories ?? null,
  };
}
