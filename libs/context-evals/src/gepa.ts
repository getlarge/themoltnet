/** gepa.ts — Shared GEPA runner infrastructure for gpack and skill-eval pipelines. */

import type { AxAIService, AxGEPAAdapter, AxTypedExample } from '@ax-llm/ax';
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

/** Entry emitted via onEvalComplete after each evaluation. */
export interface EvalTraceEntry<TTrace> {
  taskId: string;
  round: number;
  score: number;
  instructionLength: number;
  trace?: TTrace;
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
  /** ax() program signature. Default: 'taskPrompt:string -> output:string' */
  axSignature?: string;
  /** Build training examples from the (possibly replicated) task list. */
  buildExamples: (tasks: TTask[]) => TExample[];
  /** Evaluate a single task with the given instruction; returns score and optional trace. */
  evaluateOne: (
    task: TTask,
    instruction: string,
  ) => Promise<EvalOneResult<TTrace>>;
  /**
   * Called after each evaluation completes — use for incremental trace persistence.
   * If multiple consumers are needed (e.g., JSONL writer + live dashboard),
   * consider replacing this callback with a typed EventEmitter.
   */
  onEvalComplete?: (entry: EvalTraceEntry<TTrace>) => void | Promise<void>;
}

export interface GepaRunnerResult<TTrace> {
  bestScore: number;
  bestInstruction: string;
  traces: EvalTraceEntry<TTrace>[];
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
    axSignature = 'taskPrompt:string -> output:string',
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

  const getCurrentInstruction = (): string =>
    (program as { instruction?: string }).instruction ?? seedInstruction;

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

  // AxGEPA.compile expects AxTypedExample with AxFieldValue index signature.
  // Our generic TExample uses unknown — safe to widen here since GEPA only
  // reads the `id` field and forwards the rest to the adapter.
  const result = await optimizer.compile(
    program,
    trainingExamples,
    async ({ example }) => {
      const taskId =
        typeof example.id === 'string'
          ? example.id.replace(/-replica$/, '')
          : '';
      const instruction = getCurrentInstruction();
      const evalResult = await cachedEvaluate(taskId, instruction);

      evalRound++;
      const entry: EvalTraceEntry<TTrace> = {
        taskId,
        round: evalRound,
        score: evalResult.score,
        instructionLength: instruction.length,
        trace: evalResult.trace,
        timestamp: new Date().toISOString(),
      };
      allTraces.push(entry);
      await onEvalComplete?.(entry);

      return evalResult.score;
    },
    {
      maxMetricCalls,
      gepaAdapter: adapter,
      feedbackExamples: trainingExamples,
      validationExamples: trainingExamples,
    },
  );

  return {
    bestScore: result.bestScore,
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
