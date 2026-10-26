import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

import { createGit } from '@moltnet/docs-impact-review';
import {
  checkEligibility,
  type PullRequestFile,
} from '@moltnet/docs-impact-review/eligibility';
import { workflowCommandValue } from '@moltnet/docs-impact-review/workflow-command';
import type { TaskClient } from '@themoltnet/tasks-orchestrator';

import { formatReviewTaskBudgets, parseReviewTaskBudgets } from './config.js';
import type { Lane } from './core.js';
import { loadAdaptivePolicy } from './snapshot.js';
import type { WorkerLiveness } from './workers.js';
import {
  type AdaptivePreparation,
  classifierTaskPossible,
  prepareAdaptiveReview,
  type RunOptions,
  runRoutedAdaptiveReview,
} from './workflow.js';

/** The pull request pinned by the prepare stage and read by later stages. */
export interface Prepared {
  repo: string;
  pr: number;
  title: string;
  body: string;
  base: string;
  head: string;
  correlationId: string;
}

/** Process boundaries of the adaptive review CLI, injectable for tests. */
export interface CliDeps {
  env: NodeJS.ProcessEnv;
  cwd: string;
  github: {
    revisions(
      repo: string,
      pr: number,
    ): Promise<{ head: string; base: string }>;
    files(repo: string, pr: number): Promise<PullRequestFile[]>;
  };
  connect(): Promise<{
    profiles(teamId: string): Promise<Array<{ id: string; name: string }>>;
    tasks: TaskClient;
  }>;
  workers(): WorkerLiveness | undefined;
  stdout(text: string): void;
}

interface PullRequestEvent {
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    changed_files: number;
    user: { login: string };
    base: { sha: string };
    head: { sha: string; repo: { full_name: string } | null };
  };
}

const PROFILE_ENV: Record<Lane, string> = {
  docs: 'ADAPTIVE_DOCS_PROFILE',
  complexity: 'ADAPTIVE_COMPLEXITY_PROFILE',
  security: 'ADAPTIVE_SECURITY_PROFILE',
  tests: 'ADAPTIVE_FOCUSED_PROFILE',
  conventions: 'ADAPTIVE_FOCUSED_PROFILE',
  'blast-radius': 'ADAPTIVE_FOCUSED_PROFILE',
};

/** One drain worker per runnable task, grouped by the profile that claims it. */
export function specialistMatrix(
  preparation: Pick<AdaptivePreparation, 'routing' | 'docsTaskPossible'>,
  env: NodeJS.ProcessEnv,
): { include: Array<{ profile: string; worker: number }> } {
  const capacity = new Map<string, number>();
  for (const route of preparation.routing.routes) {
    if (!route.run) continue;
    if (route.lane === 'docs' && !preparation.docsTaskPossible) continue;
    const profile = env[PROFILE_ENV[route.lane]];
    if (!profile) throw new Error(`${PROFILE_ENV[route.lane]} is required`);
    capacity.set(profile, (capacity.get(profile) ?? 0) + 1);
  }
  return {
    include: [...capacity].flatMap(([profile, count]) =>
      Array.from({ length: count }, (_, index) => ({
        profile,
        worker: index + 1,
      })),
    ),
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function writeOutputs(
  env: NodeJS.ProcessEnv,
  outputs: Record<string, string | boolean>,
): void {
  appendFileSync(
    required(env, 'GITHUB_OUTPUT'),
    Object.entries(outputs)
      .map(([key, value]) => `${key}=${String(value)}\n`)
      .join(''),
  );
}

async function prepare(deps: CliDeps): Promise<number> {
  const { env } = deps;
  const repo = required(env, 'GITHUB_REPOSITORY');
  const event = JSON.parse(
    readFileSync(required(env, 'GITHUB_EVENT_PATH'), 'utf8'),
  ) as PullRequestEvent;
  const pr = event.pull_request;
  const eligibility = checkEligibility({
    headRepo: pr.head.repo?.full_name ?? null,
    baseRepo: repo,
    author: pr.user.login,
    files: await deps.github.files(repo, pr.number),
    changedFiles: pr.changed_files,
    protectedPaths: (env.PROTECTED_PATHS ?? '').split('\n'),
  });
  if (!eligibility.eligible) {
    writeOutputs(env, { skip: true });
    deps.stdout(
      `::notice::Adaptive review skipped: ${workflowCommandValue(eligibility.reason)}\n`,
    );
    return 0;
  }
  const prepared: Prepared = {
    repo,
    pr: pr.number,
    title: pr.title.slice(0, 500),
    body: (pr.body ?? '').slice(0, 4000),
    base: pr.base.sha,
    head: pr.head.sha,
    correlationId: randomUUID(),
  };
  writeOutputs(env, {
    skip: false,
    prepared: JSON.stringify(prepared),
    base: prepared.base,
    head: prepared.head,
    correlation: prepared.correlationId,
  });
  return 0;
}

async function runOptions(
  deps: CliDeps,
  prepared: Prepared,
  lanes: readonly Lane[],
): Promise<RunOptions> {
  const { env } = deps;
  const mode = required(env, 'ADAPTIVE_MODE');
  if (mode !== 'shadow' && mode !== 'active')
    throw new Error('ADAPTIVE_MODE must be shadow or active');
  const taskBudgets = parseReviewTaskBudgets(env.ADAPTIVE_TASK_BUDGETS, lanes);
  if (env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      formatReviewTaskBudgets(taskBudgets),
    );
  const teamId = required(env, 'MOLTNET_TEAM_ID');
  const client = await deps.connect();
  const items = await client.profiles(teamId);
  const resolve = (name: string): string => {
    const profile = items.find(
      (item) => item.id === name || item.name === name,
    );
    if (!profile) throw new Error(`runtime profile ${name} not found`);
    return profile.id;
  };
  const enabled = (...candidates: Lane[]) =>
    candidates.some((lane) => lanes.includes(lane));
  return {
    identity: {
      ...prepared,
      teamId,
      diaryId: required(env, 'MOLTNET_DIARY_ID'),
      classifierProfileId: resolve(
        required(env, 'ADAPTIVE_CLASSIFIER_PROFILE'),
      ),
    },
    mode,
    tasks: client.tasks,
    cwd: deps.cwd,
    runtimeSha: required(env, 'ADAPTIVE_RUNTIME_SHA'),
    taskBudgets,
    profiles: {
      ...(enabled('docs')
        ? { docs: resolve(required(env, 'ADAPTIVE_DOCS_PROFILE')) }
        : {}),
      ...(enabled('complexity')
        ? { complexity: resolve(required(env, 'ADAPTIVE_COMPLEXITY_PROFILE')) }
        : {}),
      ...(enabled('security')
        ? { security: resolve(required(env, 'ADAPTIVE_SECURITY_PROFILE')) }
        : {}),
      ...(enabled('tests', 'conventions', 'blast-radius')
        ? { focused: resolve(required(env, 'ADAPTIVE_FOCUSED_PROFILE')) }
        : {}),
    },
    projectId: env.MOLTNET_PROJECT_ID || undefined,
    workers: deps.workers(),
  };
}

/**
 * Runs one adaptive review stage. `prepare` pins the pull request; `plan`,
 * `route`, and `review` hand off through the files named by
 * `ADAPTIVE_PREPARED`, `ADAPTIVE_ROUTE`, and `ADAPTIVE_REPORT`. Returns the
 * process exit code.
 */
export async function runAdaptiveStage(
  stage: string,
  deps: CliDeps,
): Promise<number> {
  const { env } = deps;
  if (stage === 'prepare') return prepare(deps);
  if (stage !== 'plan' && stage !== 'route' && stage !== 'review')
    throw new Error('ADAPTIVE_STAGE must be prepare, plan, route, or review');
  const prepared = JSON.parse(
    readFileSync(required(env, 'ADAPTIVE_PREPARED'), 'utf8'),
  ) as Prepared;
  const current = await deps.github.revisions(prepared.repo, prepared.pr);
  if (current.head !== prepared.head || current.base !== prepared.base)
    throw new Error('PR revisions changed after preparation');
  const snapshot = loadAdaptivePolicy(createGit(deps.cwd), prepared.base);
  if (stage === 'plan') {
    const enabled = snapshot !== null;
    writeOutputs(env, {
      'review-enabled': enabled,
      'classifier-needed':
        enabled &&
        classifierTaskPossible(deps.cwd, prepared.base, prepared.head),
    });
    return 0;
  }
  if (!snapshot)
    throw new Error('adaptive review policy is absent on the base');
  const options = await runOptions(deps, prepared, snapshot.policy.lanes);
  if (stage === 'route') {
    const preparation = await prepareAdaptiveReview(options);
    writeFileSync(
      required(env, 'ADAPTIVE_ROUTE'),
      `${JSON.stringify(preparation, null, 2)}\n`,
      { mode: 0o600 },
    );
    const matrix = specialistMatrix(preparation, env);
    writeOutputs(env, {
      specialists: JSON.stringify(matrix),
      'has-specialists': matrix.include.length > 0,
    });
    deps.stdout(
      `Adaptive routing finished: ${preparation.routing.routes
        .filter((route) => route.run)
        .map((route) => route.lane)
        .join(', ')}\n`,
    );
    return 0;
  }
  const preparation = JSON.parse(
    readFileSync(required(env, 'ADAPTIVE_ROUTE'), 'utf8'),
  ) as AdaptivePreparation;
  const report = await runRoutedAdaptiveReview(options, preparation);
  writeFileSync(
    required(env, 'ADAPTIVE_REPORT'),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  );
  deps.stdout(
    `Adaptive review finished: ${report.results.map((result) => `${result.lane}=${result.status}`).join(', ')}\n`,
  );
  return report.results.some((result) => result.status === 'failed') ? 1 : 0;
}
