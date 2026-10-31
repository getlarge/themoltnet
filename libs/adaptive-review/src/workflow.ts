import {
  buildEvidence,
  type Git as ComplexityGit,
} from '@moltnet/complexity-review/evidence';
import {
  collectChangeSet,
  createGit,
  docsGlobs,
  loadReviewConfig,
} from '@moltnet/docs-impact-review';
import type { ClassifyOutput, WorkflowSpendReport } from '@moltnet/tasks';
import type { TaskClient } from '@themoltnet/tasks-orchestrator';

import { runComplexityLane } from './complexity-lane.js';
import { type ReviewTaskBudgets, validateReviewTaskBudgets } from './config.js';
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
const MAX_CLASSIFIER_PACKETS = 4;

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
  return withCreateHook(tasks, (task) => taskIds.push(task.id));
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
  const started = Date.now();
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
  const packetBudgetReached = packets.length > MAX_CLASSIFIER_PACKETS;
  if (packetBudgetReached) {
    gaps.push(
      `Classifier packet budget exceeded: ${packets.length} > ${MAX_CLASSIFIER_PACKETS}; all lanes routed for review.`,
    );
  }
  for (const packet of packetBudgetReached ? [] : packets) {
    let taskId: string | undefined;
    try {
      const task = await classifierTasks.createTask(
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
          idempotencyKey: taskKey(reviewIdentity, `classify-${packet.id}`),
        },
      );
      taskId = task.id;
      classifierTaskIds.push(task.id);
      const output = await accepted(classifierTasks, task.id, classifyOutput);
      answers.push({ packetId: packet.id, answers: output.answers });
    } catch (reason) {
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
    { classifierSkipped: packetBudgetReached },
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
  return packets.length > 0 && packets.length <= MAX_CLASSIFIER_PACKETS;
}

export async function runRoutedAdaptiveReview(
  options: RunOptions,
  preparation: AdaptivePreparation,
): Promise<AdaptiveReport> {
  const started = Date.now();
  const { identity, mode } = options;
  const tasks = projectScopedTaskClient(options.tasks, options.projectId);
  const git = createGit(options.cwd);
  const snapshot = loadAdaptivePolicy(git, identity.base);
  if (!snapshot)
    throw new Error('adaptive review policy is absent on the base');
  validateReviewTaskBudgets(options.taskBudgets, snapshot.policy.lanes);
  const reviewIdentity = { ...identity, policyDigest: snapshot.digest };
  if (
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
  const routed = await Promise.allSettled(
    routing.routes.map(async (route, index): Promise<LaneResult> => {
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
      return LANE_RUNNERS[route.lane]({
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
    }),
  );
  const results = routed.map((item, index): LaneResult => {
    if (item.status === 'fulfilled') return item.value;
    const lane = routing.routes[index].lane;
    const code = laneFailureCode(item.reason);
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
  const preparation = await prepareAdaptiveReview(options);
  return runRoutedAdaptiveReview(options, preparation);
}
