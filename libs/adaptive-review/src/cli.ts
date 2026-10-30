import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

import { createGit } from '@moltnet/docs-impact-review';
import {
  checkEligibility,
  type PullRequestFile,
} from '@moltnet/docs-impact-review/eligibility';
import { workflowCommandValue } from '@moltnet/docs-impact-review/workflow-command';
import { collectWorkflowSpend, formatWorkflowSpend } from '@moltnet/tasks';
import type { TaskClient } from '@themoltnet/tasks-orchestrator';

import {
  formatReviewTaskBudgets,
  parseReviewTaskBudgets,
  required,
} from './config.js';
import type { Lane } from './core.js';
import { hasIncompleteCoverage } from './report.js';
import { loadAdaptivePolicy } from './snapshot.js';
import {
  type SpecialistPool,
  type WorkerLiveness,
  workerPool,
} from './workers.js';
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
    /** The pull request a comment event names only by number. */
    pullRequest(repo: string, pr: number): Promise<PullRequest>;
  };
  connect(
    teamId: string,
    signal?: AbortSignal,
  ): Promise<{
    profiles(teamId: string): Promise<Array<{ id: string; name: string }>>;
    tasks: TaskClient;
  }>;
  workers(): WorkerLiveness | undefined;
  stdout(text: string): void;
}

/** The pull request a `pull_request` or `issue_comment` event is about. */
export function pullNumberFromEvent(eventName: string, event: unknown): number {
  const payload = event as {
    pull_request?: { number?: number };
    issue?: { number?: number; pull_request?: unknown };
  };
  const number =
    eventName === 'issue_comment'
      ? payload.issue?.pull_request
        ? payload.issue.number
        : undefined
      : payload.pull_request?.number;
  if (!number) {
    throw new Error(
      `run on pull_request or on a pull request's issue_comment (got ${eventName})`,
    );
  }
  return number;
}

export interface PullRequest {
  number: number;
  title: string;
  body: string | null;
  changed_files: number;
  user: { login: string };
  base: { sha: string };
  head: { sha: string; repo: { full_name: string } | null };
}

/** The environment variable naming each specialist pool's runtime profile. */
export const PROFILE_ENV: Record<SpecialistPool, string> = {
  docs: 'ADAPTIVE_DOCS_PROFILE',
  complexity: 'ADAPTIVE_COMPLEXITY_PROFILE',
  security: 'ADAPTIVE_SECURITY_PROFILE',
  focused: 'ADAPTIVE_FOCUSED_PROFILE',
};

function profileEnv(lane: Lane): string {
  const name = PROFILE_ENV[workerPool(lane)];
  if (!name) throw new Error(`Unknown review lane: ${lane}`);
  return name;
}

/** `gh api --paginate --jq` output: one JSON value per line. */
export function jsonLines<T>(stdout: string): T[] {
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

/** Keeps the fields of a pull request files API page the trust gate reads. */
export function pullRequestFiles(pages: unknown): PullRequestFile[] {
  if (!Array.isArray(pages)) throw new Error('unexpected pull request files');
  return pages.flat().map((item: unknown) => {
    const file = item as { filename?: unknown; previous_filename?: unknown };
    if (typeof file.filename !== 'string')
      throw new Error('pull request file has no filename');
    return typeof file.previous_filename === 'string'
      ? { filename: file.filename, previous_filename: file.previous_filename }
      : { filename: file.filename };
  });
}

/** Annotates a failed stage and returns the process exit code. */
export function reportStageFailure(
  stage: string | undefined,
  error: unknown,
  write: { stdout(text: string): void; stderr(text: string): void },
): number {
  const message = error instanceof Error ? error.message : String(error);
  write.stdout(
    `::error::Adaptive ${workflowCommandValue(stage || 'unknown')} stage failed: ${workflowCommandValue(message)}\n`,
  );
  write.stderr(
    `${error instanceof Error && error.stack ? error.stack : message}\n`,
  );
  return 1;
}

/** One drain worker per runnable task, grouped by the profile that claims it. */
export function specialistMatrix(
  preparation: Pick<AdaptivePreparation, 'routing' | 'docsTaskPossible'>,
  env: NodeJS.ProcessEnv,
): { include: Array<{ profile: string; worker: number }> } {
  const capacity = new Map<string, number>();
  for (const route of preparation.routing.routes) {
    if (!route.run) continue;
    if (route.lane === 'docs' && !preparation.docsTaskPossible) continue;
    const profile = required(profileEnv(route.lane), env);
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

function writeOutputs(
  env: NodeJS.ProcessEnv,
  outputs: Record<string, string | boolean>,
): void {
  const lines = Object.entries(outputs).map(([key, value]) => {
    // One line per output: a newline would let a value set another output.
    if (/[\r\n]/.test(String(value)))
      throw new Error(`output ${key} must be a single line`);
    return `${key}=${String(value)}\n`;
  });
  appendFileSync(required('GITHUB_OUTPUT', env), lines.join(''));
}

async function prepare(deps: CliDeps): Promise<number> {
  const { env } = deps;
  const repo = required('GITHUB_REPOSITORY', env);
  const event = JSON.parse(
    readFileSync(required('GITHUB_EVENT_PATH', env), 'utf8'),
  ) as { pull_request?: PullRequest };
  // An on-demand comment carries only the number; read the rest from the API.
  const pr =
    event.pull_request ??
    (await deps.github.pullRequest(
      repo,
      pullNumberFromEvent(required('GITHUB_EVENT_NAME', env), event),
    ));
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
  const mode = required('ADAPTIVE_MODE', env);
  if (mode !== 'shadow' && mode !== 'active')
    throw new Error('ADAPTIVE_MODE must be shadow or active');
  const taskBudgets = parseReviewTaskBudgets(env.ADAPTIVE_TASK_BUDGETS, lanes);
  if (env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      formatReviewTaskBudgets(taskBudgets),
    );
  const teamId = required('MOLTNET_TEAM_ID', env);
  const client = await deps.connect(teamId);
  const items = await client.profiles(teamId);
  const resolve = (name: string): string => {
    const profile = items.find(
      (item) => item.id === name || item.name === name,
    );
    if (!profile) throw new Error(`runtime profile ${name} not found`);
    return profile.id;
  };
  return {
    identity: {
      ...prepared,
      teamId,
      diaryId: required('MOLTNET_DIARY_ID', env),
      classifierProfileId: resolve(
        required('ADAPTIVE_CLASSIFIER_PROFILE', env),
      ),
    },
    mode,
    tasks: client.tasks,
    cwd: deps.cwd,
    runtimeSha: required('ADAPTIVE_RUNTIME_SHA', env),
    taskBudgets,
    profiles: Object.fromEntries(
      [...new Set(lanes.map(workerPool))].map((pool) => [
        pool,
        resolve(required(PROFILE_ENV[pool], env)),
      ]),
    ),
    projectId: env.MOLTNET_PROJECT_ID || undefined,
    workers: deps.workers(),
  };
}

function plan(deps: CliDeps, prepared: Prepared, enabled: boolean): number {
  if (!enabled)
    deps.stdout(
      `::notice::Adaptive review skipped: no adaptive review policy on base ${prepared.base}\n`,
    );
  writeOutputs(deps.env, {
    'review-enabled': enabled,
    'classifier-needed':
      enabled && classifierTaskPossible(deps.cwd, prepared.base, prepared.head),
  });
  return 0;
}

async function route(deps: CliDeps, options: RunOptions): Promise<number> {
  const { env } = deps;
  const preparation = await prepareAdaptiveReview(options);
  writeFileSync(
    required('ADAPTIVE_ROUTE', env),
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
      .filter((item) => item.run)
      .map((item) => item.lane)
      .join(', ')}\n`,
  );
  return 0;
}

async function review(deps: CliDeps, options: RunOptions): Promise<number> {
  const { env } = deps;
  const preparation = JSON.parse(
    readFileSync(required('ADAPTIVE_ROUTE', env), 'utf8'),
  ) as AdaptivePreparation;
  const report = await runRoutedAdaptiveReview(options, preparation);
  const spendTasks = report.taskIds?.length
    ? await deps
        .connect(options.identity.teamId, AbortSignal.timeout(30_000))
        .then((client) => client.tasks)
        .catch(() => undefined)
    : undefined;
  report.spend = await collectWorkflowSpend(
    (report.taskIds ?? []).map((taskId) => ({
      taskId,
      stage:
        report.results.find((result) => result.taskIds?.includes(taskId))
          ?.lane ?? 'classifier',
    })),
    (id) => {
      if (!spendTasks) throw new Error('Spend connection unavailable');
      return spendTasks.listAttempts(id);
    },
  );
  if (env.GITHUB_STEP_SUMMARY)
    appendFileSync(env.GITHUB_STEP_SUMMARY, formatWorkflowSpend(report.spend));
  writeFileSync(
    required('ADAPTIVE_REPORT', env),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  );
  deps.stdout(
    `Adaptive review finished: ${report.results.map((result) => `${result.lane}=${result.status}`).join(', ')}\n`,
  );
  if (hasIncompleteCoverage(report)) {
    const message =
      'Adaptive review has incomplete coverage. Task completion is not review clearance; inspect the report and team-scoped tasks.';
    // Fixed text only: private security evidence must not enter annotations.
    deps.stdout(`::warning title=Incomplete adaptive review::${message}\n`);
    if (env.GITHUB_STEP_SUMMARY)
      appendFileSync(env.GITHUB_STEP_SUMMARY, `\n**${message}**\n`);
  }
  return report.results.some((result) => result.status === 'failed') ? 1 : 0;
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
    readFileSync(required('ADAPTIVE_PREPARED', env), 'utf8'),
  ) as Prepared;
  const current = await deps.github.revisions(prepared.repo, prepared.pr);
  if (current.head !== prepared.head || current.base !== prepared.base)
    throw new Error(
      `PR revisions changed after preparation: head ${prepared.head} -> ${current.head}, base ${prepared.base} -> ${current.base}`,
    );
  const snapshot = loadAdaptivePolicy(createGit(deps.cwd), prepared.base);
  if (stage === 'plan') return plan(deps, prepared, snapshot !== null);
  if (!snapshot)
    throw new Error('adaptive review policy is absent on the base');
  const options = await runOptions(deps, prepared, snapshot.policy.lanes);
  return stage === 'route' ? route(deps, options) : review(deps, options);
}
