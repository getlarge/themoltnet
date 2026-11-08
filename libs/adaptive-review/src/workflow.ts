import {
  buildEvidence,
  type Git as ComplexityGit,
} from '@moltnet/complexity-review/evidence';
import {
  collectChangeSet,
  createGit,
  createSleepingContext,
  docsGlobs,
  loadReviewConfig,
} from '@moltnet/docs-impact-review';
import type { ClassifyOutput, WorkflowSpendReport } from '@moltnet/tasks';
import {
  createTaskStep,
  isWorkflowInterruption,
  parallelTasks,
  type TaskClient,
  type WorkflowContext,
} from '@themoltnet/tasks-orchestrator';
import { SuspendTask } from 'absurd-sdk';

import { runComplexityLane } from './complexity-lane.js';
import {
  CLASSIFIER_STAGE_BUDGET_SEC,
  MAX_CLASSIFIER_TASKS,
  type ReviewTaskBudgets,
  validateReviewTaskBudgets,
} from './config.js';
import { reviewCheckpoint, reviewContext } from './context.js';
import {
  buildClassifyTask,
  decideRoutes,
  isBinaryPatch,
  type Lane,
  mechanicalConcerns,
  type Mode,
  type PacketAnswer,
  packetize,
  type ReviewIdentity,
  type RoutingDecision,
  taskKey,
} from './core.js';
import { runDocsLane } from './docs-lane.js';
import { canonicalInput } from './execution.js';
import { runFocusedLane } from './focused-lane.js';
import { withReviewGuidance } from './guidance-tasks.js';
import {
  accepted,
  type LaneContext,
  laneFailureCode,
  type LaneResult,
  logClassifierFailure,
  logLaneFailure,
  withCreateHook,
} from './lane.js';
import {
  accountForPriorFindings,
  type PriorFindingReview,
} from './prior-findings.js';
import { runSecurityLane } from './security-lane.js';
import { changedPaths, loadAdaptivePolicy } from './snapshot.js';
import type { PreviousFinding } from './threads.js';
import {
  guardWorkers,
  type SpecialistPool,
  type WorkerLiveness,
  workerPool,
} from './workers.js';

export type { LaneResult } from './lane.js';

const FullOid = /^[0-9a-f]{40}$/;

export interface AdaptiveReport {
  priorFindingOutcomes?: PriorFindingReview[];
  spend?: WorkflowSpendReport;
  version: 1;
  mode: Mode;
  repo: string;
  pr: number;
  base: string;
  head: string;
  correlationId: string;
  policyDigest: string;
  referenceDigests: Record<string, string>;
  runtimeSha: string;
  routing: RoutingDecision;
  results: LaneResult[];
  packetCount: number;
  taskIds: string[];
  gaps: string[];
  durationMs: number;
}

export interface AdaptivePreparation {
  pinnedOptions?: {
    identity: ReviewIdentity;
    profiles: RunOptions['profiles'];
    profileRevisions?: Record<string, number>;
    projectId?: string;
  };
  version: 1;
  mode: Mode;
  repo: string;
  pr: number;
  base: string;
  head: string;
  correlationId: string;
  policyDigest: string;
  referenceDigests: Record<string, string>;
  runtimeSha: string;
  taskBudgets: ReviewTaskBudgets;
  routing: RoutingDecision;
  packetCount: number;
  classifierTaskIds: string[];
  docsTaskPossible: boolean;
  gaps: string[];
  durationMs: number;
}

export interface RunOptions {
  /** API profile revisions observed at execution admission; changed revisions reject resume. */
  profileRevisions?: Record<string, number>;
  ctx?: WorkflowContext;
  identity: ReviewIdentity;
  mode: Mode;
  tasks: TaskClient;
  cwd: string;
  profiles: Partial<Record<SpecialistPool, string>>;
  taskBudgets: ReviewTaskBudgets;
  runtimeSha: string;
  projectId?: string;
  previousFindings?: readonly PreviousFinding[];
  /** Stops waiting on tasks once the workers that could claim them stopped. */
  workers?: WorkerLiveness;
}

async function assertPinnedOptions(
  options: RunOptions,
  ctx: WorkflowContext,
): Promise<void> {
  const {
    identity,
    profiles,
    taskBudgets,
    profileRevisions,
    runtimeSha,
    mode,
    projectId,
    previousFindings,
  } = options;
  const input = canonicalInput({
    identity,
    profiles,
    taskBudgets,
    profileRevisions,
    runtimeSha,
    mode,
    projectId,
    previousFindings,
  });
  const pinned = await ctx.step('inputs', () => Promise.resolve(input));
  if (pinned !== input) throw new Error('incompatible pinned inputs on resume');
}

function requiredProfile(options: RunOptions, lane: Lane): string {
  const value = options.profiles[workerPool(lane)];
  if (!value)
    throw new Error(`missing runtime profile for enabled ${lane} lane`);
  return value;
}

function classifyOutput(output: unknown): ClassifyOutput {
  if (typeof output !== 'object' || output === null || !('answers' in output)) {
    throw new Error('invalid classifier output');
  }
  return output as ClassifyOutput;
}

/** Records the IDs of tasks a lane creates, for failure reporting. */
function trackingTaskClient(tasks: TaskClient, taskIds: string[]): TaskClient {
  const record = (id: string) => {
    if (!taskIds.includes(id)) taskIds.push(id);
  };
  const tracked = withCreateHook(tasks, (task) => record(task.id));
  return {
    ...tracked,
    getTask: (id) => {
      record(id);
      return tasks.getTask(id);
    },
  };
}

const LANE_RUNNERS: Record<Lane, (ctx: LaneContext) => Promise<LaneResult>> = {
  docs: runDocsLane,
  complexity: runComplexityLane,
  security: runSecurityLane,
  tests: (ctx) => runFocusedLane('tests', ctx),
  conventions: (ctx) => runFocusedLane('conventions', ctx),
  'blast-radius': (ctx) => runFocusedLane('blast-radius', ctx),
  performance: (ctx) => runFocusedLane('performance', ctx),
};

function projectScopedTaskClient(
  tasks: TaskClient,
  projectId?: string,
): TaskClient {
  if (!projectId) return tasks;
  const listMessages = tasks.listMessages?.bind(tasks);
  return {
    createTask: (body, options) =>
      tasks.createTask({ ...body, projectId }, options),
    getTask: (id) => tasks.getTask(id),
    listAttempts: (id) => tasks.listAttempts(id),
    ...(listMessages ? { listMessages } : {}),
  };
}

export async function prepareAdaptiveReview(
  options: RunOptions,
): Promise<AdaptivePreparation> {
  const ctx = options.ctx ?? createSleepingContext();
  await assertPinnedOptions(options, ctx);
  const started = await ctx.step('started', () => Promise.resolve(Date.now()));
  const { identity, mode } = options;
  const tasks = projectScopedTaskClient(options.tasks, options.projectId);
  if (!FullOid.test(identity.base) || !FullOid.test(identity.head))
    throw new Error('base and head must be full Git OIDs');
  if (!FullOid.test(options.runtimeSha))
    throw new Error('runtime SHA must be a full Git OID');
  const git = createGit(options.cwd);
  const snapshot = loadAdaptivePolicy(git, identity.base);
  if (!snapshot)
    throw new Error('adaptive review policy is absent on the base');
  validateReviewTaskBudgets(options.taskBudgets, snapshot.policy.lanes);
  const reviewIdentity = { ...identity, policyDigest: snapshot.digest };
  const changes = changedPaths(git, identity.base, identity.head);
  const evidence = buildEvidence(
    git as ComplexityGit,
    identity.base,
    identity.head,
  );
  const packets = packetize(evidence);
  const gaps = evidence.generatedPaths.map(
    (path) => `Generated path not classified: ${path}`,
  );
  gaps.push(
    ...evidence.files
      .filter((file) => file.summarized)
      .map((file) => `Summarized contents not reviewed: ${file.path}`),
  );
  gaps.push(
    ...evidence.files
      .filter((file) => isBinaryPatch(file.patch))
      .map((file) => `Binary contents not reviewed: ${file.path}`),
  );
  const classifierTasks = guardWorkers(tasks, 'classifier', options.workers);
  const classifierTaskIds: string[] = [];
  const answers: PacketAnswer[] = [];
  const classifierDeadline = await ctx.step('classifier.deadline', () =>
    Promise.resolve(Date.now() + CLASSIFIER_STAGE_BUDGET_SEC * 1000),
  );
  const classifierTaskMs =
    (options.taskBudgets.classifier.dispatchTimeoutSec +
      options.taskBudgets.classifier.runningTimeoutSec) *
    1000;
  let classifierSkipped = false;
  let classifierFailed = false;
  for (const [index, packet] of packets.entries()) {
    // Keep the same per-packet request and idempotency key on replay. Only
    // dispatch another task when its full budget fits the remaining stage.
    const budgetReached = await ctx.step(`classifier.${packet.id}.admit`, () =>
      Promise.resolve(
        index >= MAX_CLASSIFIER_TASKS
          ? 'task'
          : index > 0 && Date.now() + classifierTaskMs > classifierDeadline
            ? 'time'
            : null,
      ),
    );
    if (budgetReached) {
      classifierSkipped = true;
      gaps.push(
        `Classifier ${budgetReached} budget reached after ${index} of ${packets.length} packets; unclassified packets: ${packets.length - index}; all lanes routed for review.`,
      );
      break;
    }
    let taskId: string | undefined;
    try {
      const task = await createTaskStep(
        ctx,
        `classifier.${packet.id}.create`,
        (meta) =>
          classifierTasks.createTask(
            buildClassifyTask(
              reviewIdentity,
              evidence,
              packet,
              snapshot.policy,
              changes,
              options.taskBudgets.classifier,
              snapshot.guidance,
            ),
            {
              idempotencyKey:
                meta.idempotencyKey ??
                taskKey(reviewIdentity, `classify-${packet.id}`),
            },
          ),
      );
      taskId = task.id;
      classifierTaskIds.push(task.id);
      const output = await reviewCheckpoint(
        ctx,
        `classifier.${packet.id}.result`,
        () => accepted(classifierTasks, task.id, classifyOutput, ctx),
      );
      answers.push({ packetId: packet.id, answers: output.answers });
    } catch (reason) {
      if (isWorkflowInterruption(reason)) throw reason;
      classifierFailed = true;
      const code = laneFailureCode(reason);
      logClassifierFailure(packet.id, taskId, code);
      gaps.push(
        `Classifier failed for packet ${packet.id} (${code}); inspect ${taskId ? 'its task outcome' : 'workflow logs'}.`,
      );
    }
  }
  const routing = decideRoutes(
    mode,
    snapshot.policy.lanes,
    packets,
    answers,
    mechanicalConcerns(changes, evidence.files, snapshot.policy.checks),
    { classifierSkipped: classifierSkipped && !classifierFailed },
  );
  let docsTaskPossible = false;
  if (routing.routes.some((route) => route.lane === 'docs' && route.run)) {
    try {
      const { config } = loadReviewConfig(
        git,
        identity.base,
        snapshot.policy.docs?.config,
      );
      docsTaskPossible = collectChangeSet(
        git,
        identity.base,
        identity.head,
        docsGlobs(config),
      ).files.some(
        (file) => file.category === 'source' || file.category === 'docs',
      );
    } catch {
      // Let the docs lane report its own failure; keep a worker available.
      docsTaskPossible = true;
    }
  }
  return {
    version: 1,
    mode,
    repo: identity.repo,
    pr: identity.pr,
    base: identity.base,
    head: identity.head,
    correlationId: identity.correlationId,
    policyDigest: snapshot.digest,
    referenceDigests: snapshot.referenceDigests,
    runtimeSha: options.runtimeSha,
    pinnedOptions: {
      identity,
      profiles: options.profiles,
      profileRevisions: options.profileRevisions,
      projectId: options.projectId,
    },
    taskBudgets: options.taskBudgets,
    routing,
    packetCount: packets.length,
    classifierTaskIds,
    docsTaskPossible,
    gaps,
    durationMs: Date.now() - started,
  };
}

export function classifierTaskPossible(
  cwd: string,
  base: string,
  head: string,
): boolean {
  if (!FullOid.test(base) || !FullOid.test(head))
    throw new Error('base and head must be full Git OIDs');
  const git = createGit(cwd);
  if (!loadAdaptivePolicy(git, base)) return false;
  const packets = packetize(buildEvidence(git as ComplexityGit, base, head));
  return packets.length > 0;
}

export async function runRoutedAdaptiveReview(
  options: RunOptions,
  preparation: AdaptivePreparation,
): Promise<AdaptiveReport> {
  const ctx = options.ctx ?? createSleepingContext();
  await assertPinnedOptions(options, ctx);
  const started = await ctx.step('started', () => Promise.resolve(Date.now()));
  const { identity, mode } = options;
  const tasks = projectScopedTaskClient(options.tasks, options.projectId);
  const git = createGit(options.cwd);
  const snapshot = loadAdaptivePolicy(git, identity.base);
  if (!snapshot)
    throw new Error('adaptive review policy is absent on the base');
  validateReviewTaskBudgets(options.taskBudgets, snapshot.policy.lanes);
  const reviewIdentity = { ...identity, policyDigest: snapshot.digest };
  if (
    (preparation.pinnedOptions !== undefined &&
      canonicalInput(preparation.pinnedOptions) !==
        canonicalInput({
          identity,
          profiles: options.profiles,
          profileRevisions: options.profileRevisions,
          projectId: options.projectId,
        })) ||
    preparation.version !== 1 ||
    preparation.mode !== mode ||
    preparation.repo !== identity.repo ||
    preparation.pr !== identity.pr ||
    preparation.base !== identity.base ||
    preparation.head !== identity.head ||
    preparation.correlationId !== identity.correlationId ||
    preparation.policyDigest !== snapshot.digest ||
    JSON.stringify(preparation.referenceDigests) !==
      JSON.stringify(snapshot.referenceDigests) ||
    preparation.runtimeSha !== options.runtimeSha ||
    JSON.stringify(preparation.taskBudgets) !==
      JSON.stringify(options.taskBudgets) ||
    JSON.stringify(preparation.routing.routes.map((route) => route.lane)) !==
      JSON.stringify(snapshot.policy.lanes)
  ) {
    throw new Error('routing does not match the pinned review');
  }
  const changes = changedPaths(git, identity.base, identity.head);
  const evidence = buildEvidence(
    git as ComplexityGit,
    identity.base,
    identity.head,
  );
  const { routing } = preparation;
  const createdTaskIds = routing.routes.map((): string[] => []);
  // Absurd schedule_run sleeps the whole run immediately. Branches yield
  // locally, finish their in-flight effects, then the coordinator sleeps once.
  let waiting = false;
  const laneContext: WorkflowContext = {
    ...ctx,
    sleepFor: (name, seconds) => {
      if (!ctx.suspendsOnSleep) return ctx.sleepFor(name, seconds);
      waiting = true;
      return Promise.reject(new SuspendTask());
    },
  };
  const routed = await parallelTasks({
    ctx,
    items: routing.routes,
    createStepName: (route) => `lane.${route.lane}.plan`,
    create: (route) => Promise.resolve(route),
    awaitResult: async (route, _item, index) => {
      // Settle every sibling before propagating Absurd control flow.
      try {
        const value = await reviewCheckpoint(
          ctx,
          `lane.${route.lane}.result`,
          async (): Promise<LaneResult> => {
            try {
              const laneTasks = trackingTaskClient(
                guardWorkers(tasks, workerPool(route.lane), options.workers),
                createdTaskIds[index],
              );
              if (!route.run)
                return {
                  lane: route.lane,
                  status: 'screened',
                  summary: 'Screened by classifier; not verified.',
                  taskIds: [],
                  findings: [],
                };
              const profileId = requiredProfile(options, route.lane);
              return await LANE_RUNNERS[route.lane]({
                ctx: reviewContext(laneContext, route.lane),
                taskIds: createdTaskIds[index],
                identity: reviewIdentity,
                git,
                evidence,
                changes,
                policy: snapshot.policy,
                tasks: withReviewGuidance(
                  laneTasks,
                  snapshot.guidance,
                  changes.flatMap((change) =>
                    change.previousPath
                      ? [change.previousPath, change.path]
                      : [change.path],
                  ),
                ),
                profileId,
                budget: options.taskBudgets[route.lane],
                projectId: options.projectId,
                previousFindings: options.previousFindings,
              });
            } catch (reason) {
              if (isWorkflowInterruption(reason)) throw reason;
              const lane = route.lane;
              const code = laneFailureCode(reason);
              logLaneFailure(lane, createdTaskIds[index], code);
              return {
                lane,
                status: 'failed',
                summary: createdTaskIds[index].length
                  ? `${lane} review failed (${code}); inspect task ${createdTaskIds[index].at(-1)}.`
                  : `${lane} review failed before a task was created (${code}); inspect workflow logs.`,
                taskIds: createdTaskIds[index],
                findings: [],
              };
            }
          },
        );
        return { status: 'fulfilled' as const, value };
      } catch (reason) {
        return { status: 'rejected' as const, reason };
      }
    },
  });
  const interrupted = routed.results.filter(
    (result) => result.status === 'rejected',
  );
  const failure = interrupted.find(
    (result) => !(result.reason instanceof SuspendTask),
  );
  if (failure) throw failure.reason;
  if (waiting) {
    // Replaying consumes elapsed timer slots, then parks on exactly one new
    // slot. Branches run once per handler attempt, preserving checkpoint names.
    for (;;) await ctx.sleepFor('lanes.poll', 2);
  }
  const results = routed.results.map((result) => {
    if (result.status === 'rejected') throw result.reason;
    return result.value;
  });
  return {
    version: 1,
    mode,
    repo: identity.repo,
    pr: identity.pr,
    base: identity.base,
    head: identity.head,
    correlationId: identity.correlationId,
    policyDigest: snapshot.digest,
    referenceDigests: snapshot.referenceDigests,
    runtimeSha: options.runtimeSha,
    routing,
    results,
    priorFindingOutcomes: accountForPriorFindings(
      options.previousFindings ?? [],
      results,
    ),
    packetCount: preparation.packetCount,
    taskIds: [
      ...preparation.classifierTaskIds,
      ...results.flatMap((result) => result.taskIds),
    ],
    gaps: preparation.gaps,
    durationMs: preparation.durationMs + Date.now() - started,
  };
}

export async function runAdaptiveReview(
  options: RunOptions,
): Promise<AdaptiveReport> {
  const ctx = options.ctx ?? createSleepingContext();
  await assertPinnedOptions(options, ctx);
  const preparation = await reviewCheckpoint(ctx, 'routing.result', () =>
    prepareAdaptiveReview({ ...options, ctx: reviewContext(ctx, 'routing') }),
  );
  return reviewCheckpoint(ctx, 'review.result', () =>
    runRoutedAdaptiveReview(
      {
        ...options,
        ctx: options.ctx ? reviewContext(ctx, 'review') : undefined,
      },
      preparation,
    ),
  );
}
