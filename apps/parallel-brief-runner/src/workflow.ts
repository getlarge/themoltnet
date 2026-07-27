import {
  inlineContext,
  joinCondition,
  MAX_JOIN_TASKS,
  parallelTasks,
  type SdkTask,
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
  // Validate the fan-in against the joinCondition ceiling BEFORE creating any
  // tasks, so an oversized run fails fast instead of after producing completed
  // brief tasks that can never be joined.
  if (input.briefs.length > MAX_JOIN_TASKS) {
    throw new Error(
      `parallel-brief-runner supports at most ${MAX_JOIN_TASKS} briefs (got ${input.briefs.length})`,
    );
  }
  // correlationId is a required, caller-persisted input — never generated inside
  // the (durable) workflow. Generating it here would let a replay after a
  // partial checkpoint reuse earlier tasks under one id while later steps use
  // another.
  if (!input.correlationId) {
    throw new Error('parallel-brief-runner requires a correlationId');
  }
  return {
    ...input,
    correlationId: input.correlationId,
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

function buildSummaryTask(
  input: NormalizedInput,
  briefTaskIds: string[],
): CreateBody {
  return {
    taskType: 'freeform',
    title: 'Summarize parallel briefs',
    teamId: input.teamId,
    diaryId: input.diaryId,
    correlationId: input.correlationId,
    input: {
      brief:
        input.summaryBrief ??
        'Synthesize the completed briefs into one summary.',
      briefTaskIds,
      expectedOutput:
        'Return the combined summary in the `summary` string field.',
    },
    // Server-enforced join. This task is created UP FRONT — before the briefs
    // finish — so it starts `waiting` and is promoted to `queued` by the
    // task-service only once every brief is completed; that promotion is what
    // actually exercises the gate. No output references here: the briefs have no
    // accepted output/outputCid at creation time (a task-output ref requires an
    // outputCid), so the join alone expresses the dependency.
    claimCondition: joinCondition(briefTaskIds),
  };
}

/**
 * Fan out one freeform task per brief, declare a single summary continuation
 * up front (gated on all briefs via a `joinCondition`), then await both. The
 * summary is created before the briefs complete so its `waiting -> queued`
 * server-side join transition is genuinely exercised. Demonstrates the two
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

  let summaryTask: SdkTask | undefined;
  const { created, results } = await parallelTasks({
    ctx,
    items: input.briefs,
    createStepName: (_brief, index) => `brief.${index}.create`,
    create: (brief, index) =>
      deps.tasks.createTask(buildBriefTask(input, brief, index)),
    // Every brief task id now exists but none has completed — declare the
    // joined summary continuation here so it starts `waiting`.
    onCreated: async (briefs) => {
      summaryTask = await ctx.step('summary.create', () =>
        deps.tasks.createTask(
          buildSummaryTask(
            input,
            briefs.map((task) => task.id),
          ),
        ),
      );
    },
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

  if (!summaryTask) {
    throw new Error('summary task was not created by onCreated');
  }
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
    results: created.map((task, index) => ({
      taskId: task.id,
      summary: results[index].state.summary,
    })),
    summaryTaskId: summaryTask.id,
    summary: summary.state.summary,
  };
}
