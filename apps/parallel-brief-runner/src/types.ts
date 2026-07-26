import type { Logger, TaskClient } from '@moltnet/orchestration';

export interface ParallelBriefsInput {
  teamId: string;
  diaryId: string;
  /** One freeform brief per parallel task. */
  briefs: string[];
  /** Instruction for the joining summary task. */
  summaryBrief?: string;
  correlationId?: string;
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
