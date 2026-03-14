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
 * score without re-running the evaluator.
 */
export function buildMetricFn(
  evaluator: (taskId: string, instruction: string) => Promise<number>,
): (taskId: string, instruction: string) => Promise<number> {
  const cache = new Map<string, number>();
  return async (taskId: string, instruction: string): Promise<number> => {
    const key = buildCacheKey(taskId, instruction);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const score = await evaluator(taskId, instruction);
    cache.set(key, score);
    return score;
  };
}

// ── Runner interfaces ─────────────────────────────────────────────────────────

export type TaskExample = Readonly<
  AxTypedExample<Record<string, unknown> & { id: string }>
>;

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
  /** Evaluate a single task with the given instruction; returns 0–1 score. */
  evaluateOne: (task: TTask, instruction: string) => Promise<number>;
}

export interface GepaRunnerResult {
  bestScore: number;
  bestInstruction: string;
}

// ── Full GEPA compile loop ────────────────────────────────────────────────────

export async function runGepaOptimization<
  TTask extends { id: string },
  TTrace,
  TOutput,
  TExample extends TaskExample,
>(
  options: GepaRunnerOptions<TTask, TTrace, TOutput, TExample>,
): Promise<GepaRunnerResult> {
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

  const getCurrentInstruction = (): string =>
    (program as { instruction?: string }).instruction ?? seedInstruction;

  const cachedEvaluate = buildMetricFn(
    async (taskId: string, instruction: string): Promise<number> => {
      const task = taskById.get(taskId);
      if (!task) return 0;
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
      return cachedEvaluate(taskId, instruction);
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
