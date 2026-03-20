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
  minibatchSize?: number;
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

export interface ParetoCandidate {
  instruction: string;
  scores: Record<string, number>;
  dominatedSolutions: number;
}

export interface GepaRunnerResult<TTrace> {
  bestScore: number;
  bestInstruction: string;
  traces: EvalTraceEntry<TTrace>[];
  paretoFront: ParetoCandidate[];
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
    minibatchSize,
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

  // Workaround: ax-llm v19's AxGen.getInstruction() returns null even after
  // setInstruction() is called — the AxPromptTemplate stores the value in
  // `customInstruction` but getInstruction() doesn't read it back correctly.
  // We intercept setInstruction() to track the current instruction ourselves.
  // TODO: remove when ax-llm fixes getInstruction() (tested on v19.0.13).
  const origSetInstruction = program.setInstruction.bind(program);
  let lastSetInstruction = seedInstruction;
  program.setInstruction = (instruction: string) => {
    lastSetInstruction = instruction;
    return origSetInstruction(instruction);
  };

  const optimizer = new AxGEPA({
    studentAI,
    ...(teacherAI ? { teacherAI } : {}),
    numTrials,
    ...(minibatchSize ? { minibatchSize } : {}),
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

  const getCurrentInstruction = (): string => {
    return lastSetInstruction;
  };

  // metricFn: called by GEPA for each training example.
  // Ignores prediction (program.forward output), reads instruction from program,
  // calls evaluateOne, returns { score: number } (Record<string, number>).
  // IMPORTANT: GEPA's normalizeScores expects an object, NOT a bare number.
  // Returning a plain number silently produces bestScore: 0.
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

    if (verbose) {
      // buildCacheKey returns "taskId:sha256prefix" — extract just the hash part
      const instHash = buildCacheKey('_', instruction).split(':')[1];
      // eslint-disable-next-line no-console
      console.log(
        `[GEPA-metric] eval #${evalCount} task=${taskId} len=${instruction.length} sha=${instHash}`,
      );
    }

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

    // GEPA's normalizeScores expects Record<string, number> at runtime, but
    // AxMetricFn types say number. Cast through unknown to satisfy both.
    // DO NOT simplify to `return evalResult.score` — bare numbers produce bestScore: 0.
    // TODO: remove cast when ax-llm fixes AxMetricFn return type.
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

  const rawFront = (
    result as unknown as {
      paretoFront?: Array<{
        scores: Record<string, number>;
        configuration?: { instruction?: string };
        dominatedSolutions?: number;
      }>;
    }
  ).paretoFront;

  const paretoFront: ParetoCandidate[] =
    rawFront
      ?.map((p) => ({
        instruction: p.configuration?.instruction ?? '',
        scores: p.scores,
        dominatedSolutions: p.dominatedSolutions ?? 0,
      }))
      .filter((p) => p.instruction.length > 0) ?? [];

  return {
    bestScore: result.bestScore,
    bestInstruction: result.optimizedProgram?.instruction ?? seedInstruction,
    traces: allTraces,
    paretoFront,
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
