import { randomUUID } from 'node:crypto';

import {
  inlineContext,
  joinCondition,
  parallelTasks,
  type TaskClient,
  waitForAcceptedTask,
  type WorkflowContext,
} from '@moltnet/orchestration';

import type {
  BriefState,
  ParallelBriefsDeps,
  ParallelBriefsInput,
  ParallelBriefsOutput,
} from './types.js';

const LOG_PREFIX = 'parallel_briefs';
const DEFAULT_POLL_INTERVAL_SEC = 15;

type CreateBody = Parameters<TaskClient['createTask']>[0];

interface NormalizedInput extends ParallelBriefsInput {
  correlationId: string;
  pollIntervalSec: number;
}

export function normalizeParallelBriefsInput(
  input: ParallelBriefsInput,
): NormalizedInput {
  if (input.briefs.length === 0) {
    throw new Error('parallel-brief-runner requires at least one brief');
  }
  return {
    ...input,
    // A missing correlationId is generated once here; in durable runs the CLI
    // sets it before spawn so replay reuses the persisted value deterministically.
    correlationId: input.correlationId ?? randomUUID(),
    pollIntervalSec: input.pollIntervalSec ?? DEFAULT_POLL_INTERVAL_SEC,
  };
}

function parseBriefState(output: unknown): BriefState {
  const summary = (output as { summary?: unknown } | null)?.summary;
  if (typeof summary !== 'string' || summary.length === 0) {
    throw new Error('brief task output missing string `summary`');
  }
  return { summary };
}

function buildBriefTask(
  input: NormalizedInput,
  brief: string,
  index: number,
): CreateBody {
  return {
    taskType: 'freeform',
    title: `Brief ${index + 1}/${input.briefs.length}`,
    teamId: input.teamId,
    diaryId: input.diaryId,
    correlationId: input.correlationId,
    input: {
      brief,
      expectedOutput: 'Return a concise result in the `summary` string field.',
    },
  };
}

interface BriefRef {
  taskId: string;
  outputCid: string;
}

function buildSummaryTask(
  input: NormalizedInput,
  briefRefs: BriefRef[],
  priorSummaries: string[],
): CreateBody {
  const briefText = [
    input.summaryBrief ?? 'Synthesize the completed briefs into one summary.',
    '',
    'Prior brief summaries:',
    ...priorSummaries.map((summary, index) => `${index + 1}. ${summary}`),
  ].join('\n');
  return {
    taskType: 'freeform',
    title: 'Summarize parallel briefs',
    teamId: input.teamId,
    diaryId: input.diaryId,
    correlationId: input.correlationId,
    input: {
      brief: briefText,
      expectedOutput:
        'Return the combined summary in the `summary` string field.',
    },
    // Link each brief task's accepted output as a context reference (a task
    // output reference requires its outputCid). Summaries are also inlined into
    // the brief text since freeform input is a closed schema.
    references: briefRefs.map(({ taskId, outputCid }) => ({
      taskId,
      outputCid,
      role: 'context',
    })),
    // Server-enforced join: the summary task stays `waiting` until every brief
    // task is completed, then is promoted to `queued` by the task-service.
    claimCondition: joinCondition(briefRefs.map((ref) => ref.taskId)),
  };
}

/**
 * Fan out one freeform task per brief, then create a single summary
 * continuation gated on all of them via a `joinCondition`. Demonstrates the two
 * orchestration primitives (`parallelTasks` + `joinCondition`) end to end.
 */
export async function runParallelBriefs(
  rawInput: ParallelBriefsInput,
  deps: ParallelBriefsDeps,
  ctx: WorkflowContext = inlineContext,
): Promise<ParallelBriefsOutput> {
  const input = normalizeParallelBriefsInput(rawInput);
  deps.logger?.info(
    { correlationId: input.correlationId, briefs: input.briefs.length },
    `${LOG_PREFIX}.start`,
  );

  const { created, results } = await parallelTasks({
    ctx,
    items: input.briefs,
    createStepName: (_brief, index) => `brief.${index}.create`,
    create: (brief, index) =>
      deps.tasks.createTask(buildBriefTask(input, brief, index)),
    awaitResult: (task) =>
      waitForAcceptedTask(task.id, {
        tasks: deps.tasks,
        ctx,
        pollIntervalSec: input.pollIntervalSec,
        parse: parseBriefState,
        logger: deps.logger,
        logPrefix: LOG_PREFIX,
      }),
    concurrency: input.concurrency,
  });

  const briefTaskIds = created.map((task) => task.id);
  const priorSummaries = results.map((result) => result.state.summary);
  const briefRefs = results.map((result) => {
    const { outputCid } = result.attempt;
    if (!outputCid) {
      throw new Error(`brief task ${result.task.id} produced no outputCid`);
    }
    return { taskId: result.task.id, outputCid };
  });

  const summaryTask = await ctx.step('summary.create', () =>
    deps.tasks.createTask(buildSummaryTask(input, briefRefs, priorSummaries)),
  );
  const summary = await waitForAcceptedTask(summaryTask.id, {
    tasks: deps.tasks,
    ctx,
    pollIntervalSec: input.pollIntervalSec,
    parse: parseBriefState,
    logger: deps.logger,
    logPrefix: LOG_PREFIX,
  });

  deps.logger?.info(
    { correlationId: input.correlationId, summaryTaskId: summaryTask.id },
    `${LOG_PREFIX}.done`,
  );
  return {
    correlationId: input.correlationId,
    results: briefTaskIds.map((taskId, index) => ({
      taskId,
      summary: priorSummaries[index],
    })),
    summaryTaskId: summaryTask.id,
    summary: summary.state.summary,
  };
}
