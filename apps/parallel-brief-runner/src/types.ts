import type { Logger, TaskClient } from '@themoltnet/tasks-orchestrator';

export interface ParallelBriefsInput {
  teamId: string;
  diaryId: string;
  /** One freeform brief per parallel task. */
  briefs: string[];
  /** Instruction for the joining summary task. */
  summaryBrief?: string;
  /**
   * Caller-persisted correlation id tying the fan-out together. Required and
   * never generated inside the workflow: a durable replay after a partial
   * checkpoint must reuse the same id, so it must be fixed before the run starts
   * (the CLI generates it once at parse time, before spawn).
   */
  correlationId: string;
  pollIntervalSec?: number;
  /** Optional bound on how many brief tasks are awaited concurrently. */
  concurrency?: number;
}

export interface ParallelBriefsDeps {
  tasks: TaskClient;
  logger?: Logger;
}

/** The state artifact each brief/summary task is expected to produce. */
export interface BriefState {
  summary: string;
}

export interface BriefResult {
  taskId: string;
  summary: string;
}

export interface ParallelBriefsOutput {
  correlationId: string;
  results: BriefResult[];
  summaryTaskId: string;
  summary: string;
}
