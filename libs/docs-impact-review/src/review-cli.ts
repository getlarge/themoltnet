import { execFileSync } from 'node:child_process';
import { Console } from 'node:console';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { connect } from '@themoltnet/sdk/node';
import { createSdkTaskClient } from '@themoltnet/tasks-orchestrator';

import { resolveBudgets } from './budgets.js';
import {
  createGit,
  ensureRevisions,
  existsAt,
  type Git,
  requireFullOid,
} from './git.js';
import { boundDiff, collectChangeSet } from './ingest.js';
import { renderComment, summarizeCorpus } from './report.js';
import {
  loadReviewConfig,
  loadReviewConfigFile,
  REVIEW_CONFIG_PATH,
  type ReviewConfig,
  ReviewConfigError,
  type ReviewConfigSource,
} from './review-config.js';
import { reviewEach, type ReviewTarget } from './review-each.js';
import { routeDocs, selectCandidates } from './routing.js';
import { parseLabels, scoreReports } from './score.js';
import type { DocsImpactReport, StageName } from './types.js';
import {
  createSleepingContext,
  DEFAULT_POLL_INTERVAL_SEC,
  diffBudget,
  docsGlobs,
  runDocsImpactReview,
} from './workflow.js';

const USAGE = `Usage: moltnet-docs-impact-review --repo owner/repo --pr N [--pr N ...]
  --team <uuid> --diary <uuid> --profile <name-or-id>
  [--project <uuid>] [--correlation-id <uuid>]
  [--base-sha <oid> --head-sha <oid>]
  [--profile-extract|--profile-coverage|--profile-docs-check <name-or-id>]
  [--out <dir>] [--poll-interval <sec>] [--config <path>] [--dry-run]
  [--labels <path>]
       moltnet-docs-impact-review --rescore <summary.json> --labels <path>

Runs the experimental docs-impact review against existing pull requests from a
local checkout. PR metadata is read with \`gh\`; base/head are fetched as inert
git objects. The review configuration is read from ${REVIEW_CONFIG_PATH} at
each pull request's base revision; --config uses a local file instead.
--dry-run performs ingestion and routing only (no tasks).
--labels scores the run against expected/forbidden findings; --rescore scores
a saved run's summary.json without creating tasks.`;

const GH_TIMEOUT_MS = 60_000;

/** stdout carries the summary JSON, so diagnostics (read retries) go to stderr. */
const stderrLogger = new Console({
  stdout: process.stderr,
  stderr: process.stderr,
});

interface PullRequest {
  title: string;
  headRefOid: string;
  baseRefOid: string;
}

function readPullRequest(repo: string, pr: number): PullRequest {
  const raw = execFileSync(
    'gh',
    [
      'pr',
      'view',
      String(pr),
      '--repo',
      repo,
      '--json',
      'title,headRefOid,baseRefOid',
    ],
    { encoding: 'utf8', timeout: GH_TIMEOUT_MS },
  );
  return JSON.parse(raw) as PullRequest;
}

/** One line naming the configuration and what it adds to the defaults. */
function describeConfig(
  config: ReviewConfig,
  source: ReviewConfigSource,
): string {
  if (source.kind === 'default') {
    return `defaults (no ${REVIEW_CONFIG_PATH} at the base revision)`;
  }
  return [
    source.location,
    `${config.routing.rules.length} routing rules`,
    `${config.docsInclude.length} docs inclusions`,
    `${config.docsExclude.length} exclusions`,
    `${config.agentFacing.length} agent-facing globs`,
    config.instructions
      ? `${config.instructions.length} characters of instructions`
      : 'no instructions',
    `${Object.keys(config.budgets).length} budget overrides`,
  ].join(', ');
}

function positiveInt(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FULL_OID = /^[0-9a-f]{40}$/;
const STAGES = ['extract', 'coverage', 'docs-check'] as const;

/** A review run, as the command line describes it. */
export interface ReviewCliOptions {
  repo: string;
  prs: number[];
  dryRun: boolean;
  teamId: string;
  diaryId: string;
  /** Runtime profile references (names or ids), resolved against the team. */
  profile: string;
  stageProfiles: Partial<Record<StageName, string>>;
  projectId?: string;
  /** Given by CI so drain workers can claim by it; one PR only. */
  correlationId?: string;
  /** Revisions CI validated; one PR only. */
  pinned?: { base: string; head: string };
  out?: string;
  pollIntervalSec: number;
  configPath?: string;
  labelsPath?: string;
}

export type ParsedCli =
  | { kind: 'help' }
  | { kind: 'usage'; message: string }
  | { kind: 'rescore'; summaryPath: string; labelsPath: string }
  | { kind: 'review'; options: ReviewCliOptions };

/** Parses and validates the arguments; reads no files and calls nothing. */
export function parseReviewCliArgs(args: string[]): ParsedCli {
  const { values } = parseArgs({
    args,
    options: {
      repo: { type: 'string' },
      pr: { type: 'string', multiple: true },
      team: { type: 'string' },
      diary: { type: 'string' },
      profile: { type: 'string' },
      'profile-extract': { type: 'string' },
      'profile-coverage': { type: 'string' },
      'profile-docs-check': { type: 'string' },
      project: { type: 'string' },
      'correlation-id': { type: 'string' },
      'base-sha': { type: 'string' },
      'head-sha': { type: 'string' },
      out: { type: 'string' },
      'poll-interval': { type: 'string' },
      config: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      labels: { type: 'string' },
      rescore: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) return { kind: 'help' };
  if (values.rescore) {
    return values.labels
      ? {
          kind: 'rescore',
          summaryPath: values.rescore,
          labelsPath: values.labels,
        }
      : { kind: 'usage', message: '--rescore requires --labels' };
  }
  const dryRun = values['dry-run'];
  if (
    !values.repo ||
    !values.pr?.length ||
    (!dryRun && (!values.team || !values.diary || !values.profile))
  ) {
    return { kind: 'usage', message: USAGE };
  }
  // Drain workers claim by correlation, so CI passes the id it gave them.
  // One id cannot span several PRs without mixing their tasks.
  const correlationId = values['correlation-id'];
  const base = values['base-sha'];
  const head = values['head-sha'];
  if ((correlationId || base || head) && values.pr.length !== 1) {
    return {
      kind: 'usage',
      message:
        '--correlation-id, --base-sha and --head-sha require exactly one --pr',
    };
  }
  if ((base || head) && !(base && head)) {
    return {
      kind: 'usage',
      message: '--base-sha and --head-sha must be given together',
    };
  }
  if (base && head && !(FULL_OID.test(base) && FULL_OID.test(head))) {
    return {
      kind: 'usage',
      message: '--base-sha and --head-sha must be full 40-character git OIDs',
    };
  }
  if (correlationId && !UUID.test(correlationId)) {
    return { kind: 'usage', message: '--correlation-id must be a UUID' };
  }
  const stageProfiles: Partial<Record<StageName, string>> = {};
  for (const stage of STAGES) {
    const ref = values[`profile-${stage}`];
    if (ref) stageProfiles[stage] = ref;
  }
  return {
    kind: 'review',
    options: {
      repo: values.repo,
      prs: values.pr.map((value) => positiveInt(value, '--pr')),
      dryRun,
      teamId: values.team ?? '',
      diaryId: values.diary ?? '',
      profile: values.profile ?? '',
      stageProfiles,
      projectId: values.project,
      correlationId,
      pinned: base && head ? { base, head } : undefined,
      out: values.out,
      pollIntervalSec: values['poll-interval']
        ? Number(values['poll-interval'])
        : DEFAULT_POLL_INTERVAL_SEC,
      configPath: values.config,
      labelsPath: values.labels,
    },
  };
}

/** Scores a saved run's summary.json without creating tasks. */
function rescore(summaryPath: string, labelsPath: string): number {
  const labels = parseLabels(
    JSON.parse(readFileSync(labelsPath, 'utf8')) as unknown,
  );
  const saved = JSON.parse(readFileSync(summaryPath, 'utf8')) as {
    reports: DocsImpactReport[];
  };
  process.stdout.write(
    `${JSON.stringify(scoreReports(saved.reports, labels), null, 2)}\n`,
  );
  return 0;
}

/** Resolves profile names or ids to ids in the team. */
async function resolveProfiles(
  agent: Awaited<ReturnType<typeof connect>>,
  options: ReviewCliOptions,
): Promise<{
  profileId: string;
  stageProfileIds: Partial<Record<StageName, string>>;
}> {
  const { items } = await agent.runtimeProfiles.list({
    teamId: options.teamId,
  });
  const resolve = (ref: string): string => {
    const match =
      items.find((profile) => profile.id === ref) ??
      items.find((profile) => profile.name === ref);
    if (!match) throw new Error(`runtime profile "${ref}" not found in team`);
    return match.id;
  };
  const stageProfileIds: Partial<Record<StageName, string>> = {};
  for (const [stage, ref] of Object.entries(options.stageProfiles)) {
    stageProfileIds[stage as StageName] = resolve(ref);
  }
  return { profileId: resolve(options.profile), stageProfileIds };
}

/**
 * Fills in the target's revisions and returns the pull request title. CI
 * pins the revisions it validated, so a push between preparation and review
 * cannot change what gets reviewed; pinned revisions are recorded before
 * anything can fail, and the title is then optional.
 */
function resolveRevisions(
  target: ReviewTarget,
  options: ReviewCliOptions,
): string {
  if (options.pinned) {
    target.baseRevision = options.pinned.base;
    target.headRevision = options.pinned.head;
    try {
      return readPullRequest(options.repo, target.pr).title;
    } catch (error) {
      process.stderr.write(
        `[pr ${target.pr}] title unavailable, reviewing without it: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return `#${target.pr}`;
    }
  }
  target.phase = 'gh pr view';
  const meta = readPullRequest(options.repo, target.pr);
  target.baseRevision = requireFullOid(meta.baseRefOid, 'base revision');
  target.headRevision = requireFullOid(meta.headRefOid, 'head revision');
  return meta.title;
}

/**
 * What a review would read, without tasks: the same exclusion and ranking
 * as a real review, over routing alone (a dry run has no extraction, so no
 * evidence filter and no symbol search).
 */
function dryRunSummary(
  git: Git,
  target: ReviewTarget,
  config: ReviewConfig,
  source: ReviewConfigSource,
): unknown {
  const { baseRevision: base, headRevision: head } = target;
  const budgets = resolveBudgets(config.budgets);
  const changeSet = collectChangeSet(git, base, head, docsGlobs(config));
  const diff = boundDiff(git, changeSet, diffBudget(config, budgets));
  const routed = routeDocs(changeSet.files, config.routing, (path) =>
    existsAt(git, head, path),
  );
  const selection = selectCandidates(
    routed.candidates,
    config,
    budgets.maxDocs,
  );
  return {
    pr: target.pr,
    config: source,
    files: changeSet.files.map(({ path, category }) => ({ path, category })),
    diffBytes: diff.bytes,
    omittedPaths: diff.omittedPaths,
    truncatedPaths: diff.truncatedPaths,
    candidateDocs: Object.fromEntries(routed.candidates),
    selectedDocs: selection.selected.map((doc) => doc.path),
    unroutedSources: routed.unroutedSources,
  };
}

/** The review CLI; returns the process exit code. */
export async function runReviewCli(args: string[]): Promise<number> {
  const parsed = parseReviewCliArgs(args);
  if (parsed.kind === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (parsed.kind === 'usage') {
    process.stderr.write(`${parsed.message}\n`);
    return 2;
  }
  if (parsed.kind === 'rescore') {
    return rescore(parsed.summaryPath, parsed.labelsPath);
  }
  const { options } = parsed;
  const labels = options.labelsPath
    ? parseLabels(
        JSON.parse(readFileSync(options.labelsPath, 'utf8')) as unknown,
      )
    : undefined;
  // A --config file applies to every pull request, so a bad one stops the
  // run before any work; a bad base config fails only its own review.
  let configOverride: ReturnType<typeof loadReviewConfigFile> | undefined;
  if (options.configPath) {
    try {
      configOverride = loadReviewConfigFile(
        (path) => readFileSync(path, 'utf8'),
        options.configPath,
      );
    } catch (error) {
      if (!(error instanceof ReviewConfigError)) throw error;
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
  }
  const git = createGit(process.cwd());
  const agent = options.dryRun ? undefined : await connect();
  const profiles = agent ? await resolveProfiles(agent, options) : undefined;
  const tasks = agent ? createSdkTaskClient(agent) : undefined;

  const writeReport = (report: DocsImpactReport): void => {
    process.stderr.write(`\n${renderComment(report)}\n`);
    if (!options.out) return;
    mkdirSync(options.out, { recursive: true });
    writeFileSync(
      join(options.out, `pr-${report.pr}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  };

  const reports = await reviewEach(
    options.repo,
    options.prs,
    async (target) => {
      const title = resolveRevisions(target, options);
      target.phase = 'fetch';
      ensureRevisions(git, [target.baseRevision, target.headRevision]);
      // A bad base config fails only this pull request's review; the error
      // carries the file that failed.
      target.phase = 'config';
      const { config, source } =
        configOverride ?? loadReviewConfig(git, target.baseRevision);
      target.configSource = source;
      target.phase = 'review';
      process.stderr.write(
        `[config] pr ${target.pr}: ${describeConfig(config, source)}\n`,
      );
      if (!tasks || !profiles) {
        process.stdout.write(
          `${JSON.stringify(dryRunSummary(git, target, config, source), null, 2)}\n`,
        );
        return undefined;
      }
      return runDocsImpactReview(
        { git, tasks, ctx: createSleepingContext(), logger: stderrLogger },
        {
          config,
          configSource: source,
          repo: options.repo,
          pr: target.pr,
          prTitle: title,
          baseRevision: target.baseRevision,
          headRevision: target.headRevision,
          teamId: options.teamId,
          diaryId: options.diaryId,
          correlationId: options.correlationId ?? randomUUID(),
          ...profiles,
          projectId: options.projectId,
          tags: [
            'review:docs-impact',
            'experiment:docs-impact',
            `repo:${options.repo}`,
            `pr:${target.pr}`,
            `revision:${target.headRevision}`,
          ],
          pollIntervalSec: options.pollIntervalSec,
        },
      );
    },
    writeReport,
  );

  if (reports.length > 0) {
    process.stdout.write(
      `${JSON.stringify(
        {
          summary: summarizeCorpus(reports),
          ...(labels ? { score: scoreReports(reports, labels) } : {}),
          reports,
        },
        null,
        2,
      )}\n`,
    );
  }
  return reports.some((report) => report.status === 'failed') ? 1 : 0;
}
