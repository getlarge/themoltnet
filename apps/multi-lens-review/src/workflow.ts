import {
  inlineContext,
  joinCondition,
  MAX_JOIN_TASKS,
  parallelTasks,
  type SdkTask,
  type TaskClient,
  waitForAcceptedTask,
  type WorkflowContext,
} from '@themoltnet/tasks-orchestrator';

import {
  DEFAULT_LENSES,
  type MultiLensReviewDeps,
  type MultiLensReviewInput,
  type MultiLensReviewOutput,
  type ReviewState,
} from './types.js';

const LOG_PREFIX = 'multi_lens_review';
const DEFAULT_POLL_INTERVAL_SEC = 15;

/**
 * MoltNet injects a `submit-output` gate into every freeform task's success
 * criteria: the attempt only completes if the agent calls `submit_freeform_output`
 * with a `verification` record satisfying that gate. Append these instructions to
 * every task brief so the reviews/synthesis actually close out (otherwise they
 * run but never reach `completed`).
 */
const FREEFORM_SUBMIT_INSTRUCTIONS = [
  'To submit: first call `moltnet_get_task` for THIS task id and read its `inputCid`.',
  'Then call `submit_freeform_output` exactly once with the FreeformOutput object directly (not wrapped): `summary` (your markdown answer), `artifacts` as an array (may be empty), and `verification` as an object with `inputCid` (the value you just read), `results: [{ id: "submit-output", kind: "gate", status: "pass", detail: "submit_freeform_output called with valid args" }]`, and `passed: true`.',
].join('\n\n');

type CreateBody = Parameters<TaskClient['createTask']>[0];

interface NormalizedInput extends MultiLensReviewInput {
  correlationId: string;
  lenses: string[];
  pollIntervalSec: number;
}

export function normalizeMultiLensReviewInput(
  input: MultiLensReviewInput,
): NormalizedInput {
  const lenses = input.lenses?.length ? input.lenses : [...DEFAULT_LENSES];
  if (!input.target || input.target.trim().length === 0) {
    throw new Error('multi-lens-review requires a non-empty target');
  }
  // Validate the fan-in against the joinCondition ceiling BEFORE creating any
  // tasks, so an oversized run fails fast instead of after producing completed
  // review tasks that can never be joined.
  if (lenses.length > MAX_JOIN_TASKS) {
    throw new Error(
      `multi-lens-review supports at most ${MAX_JOIN_TASKS} lenses (got ${lenses.length})`,
    );
  }
  // correlationId is a required, caller-persisted input — never generated inside
  // the (durable) workflow.
  if (!input.correlationId) {
    throw new Error('multi-lens-review requires a correlationId');
  }
  return {
    ...input,
    lenses,
    correlationId: input.correlationId,
    pollIntervalSec: input.pollIntervalSec ?? DEFAULT_POLL_INTERVAL_SEC,
  };
}

/** Human-readable scope for each lens, used to focus the reviewer. */
function lensGuidance(lens: string): string {
  switch (lens) {
    case 'security':
      return 'security vulnerabilities — injection, broken authorization, secret exposure, unsafe deserialization/eval, SSRF, path traversal, and unvalidated input';
    case 'correctness':
      return 'logic and correctness bugs — wrong conditions, off-by-one errors, unhandled edge cases, race conditions, incorrect error handling, and broken invariants';
    case 'performance':
      return 'performance and resource issues — needless allocations, N+1 queries, unbounded work, blocking the event loop, and missing back-pressure';
    case 'test-coverage':
      return 'test-coverage gaps — untested branches, missing edge-case and failure-path tests, and assertions that do not actually pin behavior';
    default:
      return `${lens} concerns`;
  }
}

function buildReviewPrompt(input: NormalizedInput, lens: string): string {
  const parts = [
    `You are a specialist code reviewer. Review the change below and report ONLY ${lens} issues: ${lensGuidance(
      lens,
    )}.`,
    `Target: ${input.target}`,
  ];
  if (input.diff) {
    parts.push('Change under review:\n\n```diff\n' + input.diff + '\n```');
  } else {
    parts.push(
      'The repository is mounted in your workspace — inspect the target files to review the relevant code.',
    );
  }
  parts.push(
    `For each issue give: a severity (high | medium | low), the file:line or symbol, a one-sentence description, and a concrete fix. ` +
      `If you find no ${lens} issues, respond exactly "No ${lens} issues found." Be specific — no generic advice.`,
    `Put your full review markdown in the \`summary\` field.`,
    FREEFORM_SUBMIT_INSTRUCTIONS,
  );
  return parts.join('\n\n');
}

function buildReviewTask(input: NormalizedInput, lens: string): CreateBody {
  return {
    taskType: 'freeform',
    title: `Review (${lens})`,
    teamId: input.teamId,
    diaryId: input.diaryId,
    correlationId: input.correlationId,
    input: {
      lens,
      brief: buildReviewPrompt(input, lens),
      expectedOutput:
        'Return the review markdown in the `summary` string field.',
    },
  };
}

function buildSynthesisTask(
  input: NormalizedInput,
  reviewTaskIds: string[],
): CreateBody {
  const brief =
    input.synthesisBrief ??
    [
      `You are the lead reviewer consolidating ${reviewTaskIds.length} specialist reviews of the same change (${input.target}).`,
      `Each review is the accepted output of one of these task ids: ${reviewTaskIds.join(
        ', ',
      )}. Fetch each task's output and read its \`summary\` field.`,
      'Produce a single consolidated verdict: (1) the top issues ranked by severity and deduped across lenses, each with its fix; (2) an overall recommendation — exactly one of approve | approve-with-nits | request-changes — with a one-line justification.',
      'Put the consolidated verdict markdown in the `summary` field.',
      FREEFORM_SUBMIT_INSTRUCTIONS,
    ].join('\n\n');
  return {
    taskType: 'freeform',
    title: 'Consolidated review verdict',
    teamId: input.teamId,
    diaryId: input.diaryId,
    correlationId: input.correlationId,
    input: {
      brief,
      reviewTaskIds,
      expectedOutput: 'Return the verdict in the `summary` string field.',
    },
    // Server-enforced join. Created UP FRONT — before the reviews finish — so it
    // starts `waiting` and is promoted to `queued` by the task-service only once
    // every review is completed; that promotion is what exercises the gate.
    claimCondition: joinCondition(reviewTaskIds),
  };
}

function parseReviewState(output: unknown): ReviewState {
  const summary = (output as { summary?: unknown } | null)?.summary;
  if (typeof summary !== 'string' || summary.length === 0) {
    throw new Error('review task output missing string `summary`');
  }
  return { summary };
}

/**
 * Fan out one freeform review task per lens (security, correctness, …), declare
 * a single synthesis continuation up front (server-gated on all reviews via a
 * `joinCondition`), then await both. The synthesis is created before the reviews
 * complete so its `waiting -> queued` server-side join transition is genuinely
 * exercised.
 */
export async function runMultiLensReview(
  rawInput: MultiLensReviewInput,
  deps: MultiLensReviewDeps,
  ctx: WorkflowContext = inlineContext,
): Promise<MultiLensReviewOutput> {
  const input = normalizeMultiLensReviewInput(rawInput);
  deps.logger?.info(
    { correlationId: input.correlationId, lenses: input.lenses },
    `${LOG_PREFIX}.start`,
  );

  let synthesisTask: SdkTask | undefined;
  const { created, results } = await parallelTasks({
    ctx,
    items: input.lenses,
    createStepName: (_lens, index) => `review.${index}.create`,
    create: (lens) => deps.tasks.createTask(buildReviewTask(input, lens)),
    // Every review task id now exists but none has completed — declare the
    // joined synthesis continuation here so it starts `waiting`.
    onCreated: async (reviews) => {
      synthesisTask = await ctx.step('synthesis.create', () =>
        deps.tasks.createTask(
          buildSynthesisTask(
            input,
            reviews.map((task) => task.id),
          ),
        ),
      );
    },
    awaitResult: (task) =>
      waitForAcceptedTask(task.id, {
        tasks: deps.tasks,
        ctx,
        pollIntervalSec: input.pollIntervalSec,
        parse: parseReviewState,
        logger: deps.logger,
        logPrefix: LOG_PREFIX,
      }),
    concurrency: input.concurrency,
  });

  if (!synthesisTask) {
    throw new Error('synthesis task was not created by onCreated');
  }
  const verdict = await waitForAcceptedTask(synthesisTask.id, {
    tasks: deps.tasks,
    ctx,
    pollIntervalSec: input.pollIntervalSec,
    parse: parseReviewState,
    logger: deps.logger,
    logPrefix: LOG_PREFIX,
  });

  deps.logger?.info(
    { correlationId: input.correlationId, verdictTaskId: synthesisTask.id },
    `${LOG_PREFIX}.done`,
  );
  return {
    correlationId: input.correlationId,
    reviews: created.map((task, index) => ({
      taskId: task.id,
      lens: input.lenses[index],
      findings: results[index].state.summary,
    })),
    verdictTaskId: synthesisTask.id,
    verdict: verdict.state.summary,
  };
}
