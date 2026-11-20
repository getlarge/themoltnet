import { createGit } from '@moltnet/docs-impact-review';
import { checkEligibility } from '@moltnet/docs-impact-review/eligibility';
import { collectWorkflowSpend } from '@moltnet/tasks';
import type { WorkflowContext } from '@themoltnet/tasks-orchestrator';

import type { ReviewTaskBudgets } from './config.js';
import { reviewCheckpoint, reviewContext } from './context.js';
import type { Mode } from './core.js';
import { executeAdaptiveWorkflow } from './execution.js';
import type { PinnedPullRequest, ReviewHostDeps } from './host-deps.js';
import type { ReviewRetentionPolicy } from './retention.js';
import { scopedReviewTasks } from './review-tasks.js';
import { loadAdaptivePolicy } from './snapshot.js';
import { previousFindings } from './threads.js';
import {
  MAX_FOCUSED_WORKERS,
  type ReviewCapacity,
  type SpecialistPool,
  workerPool,
} from './workers.js';
import {
  type AdaptiveReport,
  prepareAdaptiveReview,
  type RunOptions,
  runRoutedAdaptiveReview,
} from './workflow.js';

/** Immutable intent, independent of Actions events, artifacts and job IDs. */
export interface StandaloneReviewInput {
  repo: string;
  pr: number;
  correlationId: string;
  teamId: string;
  diaryId: string;
  projectId?: string;
  runtimeSha: string;
  mode: Mode;
  profiles: { classifier: string } & Partial<Record<SpecialistPool, string>>;
  taskBudgets: ReviewTaskBudgets;
  protectedPaths: string[];
  appLogin: string;
  publication: 'report-only' | 'github';
  runUrl: string;
  inlineFindings: boolean;
}

export type StandaloneReviewResult =
  | { status: 'skipped'; reason: string }
  | { status: 'completed'; report: AdaptiveReport; published: boolean };

export interface StandaloneReviewServices {
  cwd: string;
  /** Host-only request, replayed for unfinished work; never persisted as a checkpoint. */
  ensureCapacity?(capacity: readonly ReviewCapacity[]): Promise<void>;
  github: ReviewHostDeps['github'];
  connect: ReviewHostDeps['connect'];
  /** Host operation: fetch inert pinned objects, including after replacement. */
  ensureGit(prepared: PinnedPullRequest): Promise<void>;
  publish(report: AdaptiveReport, input: StandaloneReviewInput): Promise<void>;
}

function resolveProfiles(
  selectors: StandaloneReviewInput['profiles'],
  lanes: readonly Parameters<typeof workerPool>[0][],
  available: Array<{ id: string; name: string; revision: number }>,
) {
  const revisions: Record<string, number> = {};
  const resolve = (selector: string | undefined): string => {
    const profile = available.find(
      (item) => item.id === selector || item.name === selector,
    );
    if (
      !profile ||
      !Number.isSafeInteger(profile.revision) ||
      profile.revision < 1
    )
      throw new Error(`Missing or invalid review runtime profile: ${selector}`);
    revisions[profile.id] = profile.revision;
    return profile.id;
  };
  const classifier = resolve(selectors.classifier);
  const profiles = Object.fromEntries(
    [...new Set(lanes.map(workerPool))].map((pool) => [
      pool,
      resolve(selectors[pool]),
    ]),
  );
  return { classifier, profiles, revisions };
}

/** One durable task owns all decisions, branches, waits and publication. */
export async function conductAdaptiveReview(
  input: StandaloneReviewInput,
  ctx: WorkflowContext,
  services: StandaloneReviewServices,
): Promise<StandaloneReviewResult> {
  const admission = await ctx.step('prepare', async () => {
    const pr = await services.github.pullRequest(input.repo, input.pr);
    const eligibility = checkEligibility({
      headRepo: pr.head.repo?.full_name ?? null,
      baseRepo: input.repo,
      author: pr.user.login,
      files: await services.github.files(input.repo, input.pr),
      changedFiles: pr.changed_files,
      protectedPaths: input.protectedPaths,
    });
    if (!eligibility.eligible)
      return { skip: true as const, reason: eligibility.reason };
    return {
      skip: false as const,
      prepared: {
        repo: input.repo,
        pr: input.pr,
        title: pr.title.slice(0, 500),
        body: (pr.body ?? '').slice(0, 4000),
        base: pr.base.sha,
        head: pr.head.sha,
        correlationId: input.correlationId,
      },
    };
  });
  if (admission.skip) return { status: 'skipped', reason: admission.reason };
  const finalReport = await reviewCheckpoint(
    ctx,
    'investigation',
    async (): Promise<AdaptiveReport | null> => {
      return investigateReview(input, admission.prepared, ctx, services);
    },
  );
  if (!finalReport)
    return {
      status: 'skipped',
      reason: 'No adaptive review policy on the base',
    };
  if (input.publication === 'github')
    await ctx.step('publish', async () => {
      await services.publish(finalReport, input);
      return { published: true };
    });
  return {
    status: 'completed',
    report: finalReport,
    published: input.publication === 'github',
  };
}

export function runStandaloneReview(args: {
  databaseUrl: string;
  input: StandaloneReviewInput;
  services: StandaloneReviewServices;
  retryFailed?: boolean;
  retention?: ReviewRetentionPolicy;
  signal?: AbortSignal;
}): Promise<StandaloneReviewResult> {
  return executeAdaptiveWorkflow({
    databaseUrl: args.databaseUrl,
    executionId: args.input.correlationId,
    input: args.input,
    retryFailed: args.retryFailed,
    retention: args.retention,
    signal: args.signal,
    run: (input, ctx) =>
      conductAdaptiveReview(input, ctx, {
        ...args.services,
        connect: (teamId, signal) =>
          args.services.connect(
            teamId,
            args.signal && signal
              ? AbortSignal.any([args.signal, signal])
              : (args.signal ?? signal),
          ),
      }),
  });
}

async function investigateReview(
  input: StandaloneReviewInput,
  prepared: PinnedPullRequest,
  ctx: WorkflowContext,
  services: StandaloneReviewServices,
): Promise<AdaptiveReport | null> {
  // Filesystem state is host-local and must be reconstructed on every host.
  await services.ensureGit(prepared);
  const snapshot = loadAdaptivePolicy(createGit(services.cwd), prepared.base);
  if (!snapshot) return null;
  const client = await services.connect(input.teamId);
  const resolved = await ctx.step('profiles', async () =>
    resolveProfiles(
      input.profiles,
      snapshot.policy.lanes,
      await client.profiles(input.teamId),
    ),
  );
  const tasks = scopedReviewTasks(client.tasks, input);
  const options: RunOptions = {
    identity: {
      ...prepared,
      teamId: input.teamId,
      diaryId: input.diaryId,
      classifierProfileId: resolved.classifier,
    },
    mode: input.mode,
    tasks,
    cwd: services.cwd,
    profiles: resolved.profiles,
    profileRevisions: resolved.revisions,
    taskBudgets: input.taskBudgets,
    runtimeSha: input.runtimeSha,
    ...(input.projectId ? { projectId: input.projectId } : {}),
  };
  const assertCurrent = () =>
    assertPinnedRevisions(
      input,
      prepared,
      resolved.revisions,
      client,
      services,
    );
  const routing = await reviewCheckpoint(ctx, 'routing', async () => {
    await assertCurrent();
    await services.ensureCapacity?.([
      { pool: 'classifier', profile: resolved.classifier, count: 1 },
    ]);
    return prepareAdaptiveReview({
      ...options,
      ctx: reviewContext(ctx, 'route'),
    });
  });
  const prior = await ctx.step('previous-findings', async () =>
    previousFindings(
      await services.github.reviewThreads(input.repo, input.pr),
      input.appLogin,
    ),
  );
  const report = await reviewCheckpoint(ctx, 'report', async () => {
    await assertCurrent();
    const pools = new Map<SpecialistPool, number>();
    for (const route of routing.routing.routes)
      if (route.run) {
        const pool = workerPool(route.lane);
        pools.set(pool, (pools.get(pool) ?? 0) + 1);
      }
    if (pools.size)
      await services.ensureCapacity?.(
        [...pools].map(([pool, count]) => ({
          pool,
          profile: resolved.profiles[pool],
          count: pool === 'focused' ? Math.min(count, MAX_FOCUSED_WORKERS) : 1,
        })),
      );
    return runRoutedAdaptiveReview(
      {
        ...options,
        previousFindings: prior,
        ctx: reviewContext(ctx, 'review'),
      },
      routing,
    );
  });
  const spend = await ctx.step('spend', () =>
    collectWorkflowSpend(
      report.taskIds.map((taskId) => ({
        taskId,
        stage:
          report.results.find((result) => result.taskIds.includes(taskId))
            ?.lane ?? 'classifier',
      })),
      (id) => client.tasks.listAttempts(id),
    ),
  );
  return { ...report, spend };
}

async function assertPinnedRevisions(
  input: StandaloneReviewInput,
  prepared: PinnedPullRequest,
  revisions: Record<string, number>,
  client: Awaited<ReturnType<StandaloneReviewServices['connect']>>,
  services: StandaloneReviewServices,
): Promise<void> {
  const current = await services.github.revisions(input.repo, input.pr);
  if (current.base !== prepared.base || current.head !== prepared.head)
    throw new Error('PR revisions changed; start a new review');
  const available = await client.profiles(input.teamId);
  for (const [id, revision] of Object.entries(revisions))
    if (available.find((profile) => profile.id === id)?.revision !== revision)
      throw new Error('Runtime profile changed; start a new review');
}
