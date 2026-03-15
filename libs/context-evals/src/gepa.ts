/**
 * gepa.ts — Shared GEPA runner infrastructure for gpack and skill-eval pipelines.
 *
 * Architecture (matching mirror-optimize.ts and ax-llm examples):
 *
 * GEPA calls metricFn({prediction, example}) for each training example.
 * The metricFn ignores the prediction (program.forward output is unreliable)
 * and reads the current instruction directly from the program object.
 * It then calls evaluateOne() to run the real evaluation and returns
 * the score as a bare number. Traces are emitted inside metricFn.
 *
 * gepaAdapter is passed to GEPA for its proposal logic (reflective
 * mutation, acceptance gating) but is NOT the primary scoring path.
 */

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

/** Entry emitted via onEvalComplete after each metricFn call. */
export interface EvalTraceEntry<TTrace> {
  eval: number;
  taskId: string;
  instruction: string;
  instructionLength: number;
  score: number;
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
  /** ax() program signature. Default: 'task_id:string -> evalScore:number'. */
  axSignature?: string;
  /** Build training examples from the (possibly replicated) task list. */
  buildExamples: (tasks: TTask[]) => TExample[];
  /** Evaluate a single task with the given instruction; returns score and optional trace. */
  evaluateOne: (
    task: TTask,
    instruction: string,
  ) => Promise<EvalOneResult<TTrace>>;
  /** Called after each metricFn evaluation. Use for incremental trace persistence. */
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
    axSignature,
    buildExamples,
    evaluateOne,
    onEvalComplete,
  } = options;

  const trainingTasks = buildReplicas(tasks);
  const taskById = new Map(tasks.map((task) => [task.id, task]));

  const program = ax(
    axSignature ??
      'task_id:string -> evalScore:number "quality score of the evaluation"',
  );
  program.setInstruction(seedInstruction);

  const optimizer = new AxGEPA({
    studentAI,
    ...(teacherAI ? { teacherAI } : {}),
    numTrials,
    verbose,
    seed: 42,
  });

  // Training examples need task_id field to match program signature.
  const trainingExamples = buildExamples(trainingTasks).map((ex) => ({
    ...ex,
    task_id: (ex as Record<string, unknown>).id as string,
  }));

  const allTraces: EvalTraceEntry<TTrace>[] = [];
  let evalCount = 0;

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
    (program as unknown as { instruction?: string }).instruction ??
    seedInstruction;

  // metricFn: called by GEPA for each training example.
  // Ignores prediction (program.forward output), reads instruction from program,
  // calls evaluateOne, returns bare score number.
  // This matches the mirror-optimize.ts pattern exactly.
  const metricFn = async ({
    example,
  }: Readonly<{
    example: Record<string, unknown>;
    prediction: unknown;
  }>) => {
    evalCount++;
    const rawTaskId =
      typeof example.task_id === 'string'
        ? example.task_id
        : typeof example.id === 'string'
          ? example.id
          : '';
    const taskId = rawTaskId.replace(/-replica$/, '');
    const instruction = getCurrentInstruction();

    const evalResult = await cachedEvaluate(taskId, instruction);

    const entry: EvalTraceEntry<TTrace> = {
      eval: evalCount,
      taskId,
      instruction,
      instructionLength: instruction.length,
      score: evalResult.score,
      trace: evalResult.trace,
      timestamp: new Date().toISOString(),
    };
    allTraces.push(entry);

    try {
      await onEvalComplete?.(entry);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[GEPA-trace] onEvalComplete error:', err);
    }

    // GEPA's internal normalizeScores expects Record<string, number>, not a bare number.
    // Returning a plain number silently produces bestScore: 0.
    return { score: evalResult.score } as unknown as number;
  };

  const result = await optimizer.compile(
    program,
    trainingExamples as Parameters<typeof optimizer.compile>[1],
    metricFn as unknown as Parameters<typeof optimizer.compile>[2],
    {
      maxMetricCalls,
      gepaAdapter: adapter,
      feedbackExamples: trainingExamples as Parameters<
        typeof optimizer.compile
      >[1],
      validationExamples: trainingExamples as Parameters<
        typeof optimizer.compile
      >[1],
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
