import type { Logger, TaskClient } from '@themoltnet/tasks-orchestrator';

/** The review lenses fanned out by default when none are supplied. */
export const DEFAULT_LENSES = [
  'security',
  'correctness',
  'performance',
  'test-coverage',
] as const;

export interface MultiLensReviewInput {
  teamId: string;
  diaryId: string;
  /**
   * Caller-persisted correlation id tying the fan-out together. Required and
   * never generated inside the workflow: a durable replay after a partial
   * checkpoint must reuse the same id (the CLI generates it once before spawn).
   */
  correlationId: string;
  /** What to review — a description, path(s), or context for the reviewers. */
  target: string;
  /** Optional diff text embedded verbatim in each review prompt. */
  diff?: string;
  /** One review lens per parallel task. Defaults to {@link DEFAULT_LENSES}. */
  lenses?: string[];
  /** Instruction override for the joining synthesis task. */
  synthesisBrief?: string;
  pollIntervalSec?: number;
  /** Optional bound on how many review tasks are awaited concurrently. */
  concurrency?: number;
}

export interface MultiLensReviewDeps {
  tasks: TaskClient;
  logger?: Logger;
}

/** The state artifact each review/synthesis task is expected to produce. */
export interface ReviewState {
  summary: string;
}

export interface ReviewResult {
  taskId: string;
  lens: string;
  findings: string;
}

export interface MultiLensReviewOutput {
  correlationId: string;
  reviews: ReviewResult[];
  verdictTaskId: string;
  verdict: string;
}
