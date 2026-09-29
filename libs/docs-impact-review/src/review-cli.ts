import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { connect } from '@themoltnet/sdk/node';
import { createSdkTaskClient } from '@themoltnet/tasks-orchestrator';

import {
  createGit,
  ensureRevisions,
  existsAt,
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
import { reviewEach } from './review-each.js';
import { routeDocs, selectCandidates } from './routing.js';
import { parseLabels, scoreReports } from './score.js';
import type { DocsImpactReport, StageName } from './types.js';
import {
  createSleepingContext,
  DEFAULT_BUDGETS,
  DEFAULT_POLL_INTERVAL_SEC,
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
    `${config.docsExclude.length} exclusions`,
    `${config.agentFacing.length} agent-facing globs`,
    config.instructions
      ? `${config.instructions.length} characters of instructions`
      : 'no instructions',
  ].join(', ');
}

function positiveInt(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

/** The review CLI; returns the process exit code. */
export async function runReviewCli(args: string[]): Promise<number> {
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
  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const labels = values.labels
    ? parseLabels(JSON.parse(readFileSync(values.labels, 'utf8')) as unknown)
    : undefined;
  if (values.rescore) {
    if (!labels) {
      process.stderr.write('--rescore requires --labels\n');
      return 2;
    }
    const saved = JSON.parse(readFileSync(values.rescore, 'utf8')) as {
      reports: DocsImpactReport[];
    };
    process.stdout.write(
      `${JSON.stringify(scoreReports(saved.reports, labels), null, 2)}\n`,
    );
    return 0;
  }
  const dryRun = values['dry-run'];
  if (
    !values.repo ||
    !values.pr?.length ||
    (!dryRun && (!values.team || !values.diary || !values.profile))
  ) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  // Drain workers claim by correlation, so CI passes the id it gave them.
  // One id cannot span several PRs without mixing their tasks.
  const correlationArg = values['correlation-id'];
  const pinned = values['base-sha'] || values['head-sha'];
  if ((correlationArg || pinned) && values.pr.length !== 1) {
    process.stderr.write(
      '--correlation-id, --base-sha and --head-sha require exactly one --pr\n',
    );
    return 2;
  }
  if (pinned && !(values['base-sha'] && values['head-sha'])) {
    process.stderr.write('--base-sha and --head-sha must be given together\n');
    return 2;
  }
  if (
    correlationArg &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      correlationArg,
    )
  ) {
    process.stderr.write('--correlation-id must be a UUID\n');
    return 2;
  }
  const repo = values.repo;
  const teamId = values.team ?? '';
  const diaryId = values.diary ?? '';
  const prs = values.pr.map((value) => positiveInt(value, '--pr'));
  const pollIntervalSec = values['poll-interval']
    ? Number(values['poll-interval'])
    : DEFAULT_POLL_INTERVAL_SEC;
  // A --config file applies to every pull request, so a bad one stops the
  // run before any work; a bad base config fails only its own review.
  let configOverride: ReturnType<typeof loadReviewConfigFile> | undefined;
  if (values.config) {
    try {
      configOverride = loadReviewConfigFile(
        (path) => readFileSync(path, 'utf8'),
        values.config,
      );
    } catch (error) {
      if (!(error instanceof ReviewConfigError)) throw error;
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
  }
  const git = createGit(process.cwd());

  const agent = dryRun ? undefined : await connect();
  let profileId = values.profile ?? '';
  const stageProfileIds: Partial<Record<StageName, string>> = {};
  if (agent && values.team) {
    const { items } = await agent.runtimeProfiles.list({ teamId: values.team });
    const resolve = (ref: string): string => {
      const match =
        items.find((profile) => profile.id === ref) ??
        items.find((profile) => profile.name === ref);
      if (!match) throw new Error(`runtime profile "${ref}" not found in team`);
      return match.id;
    };
    profileId = resolve(profileId);
    for (const stage of ['extract', 'coverage', 'docs-check'] as const) {
      const ref = values[`profile-${stage}`];
      if (ref) stageProfileIds[stage] = resolve(ref);
    }
  }
  const tasks = agent ? createSdkTaskClient(agent) : undefined;

  const writeReport = (report: DocsImpactReport): void => {
    process.stderr.write(`\n${renderComment(report)}\n`);
    if (!values.out) return;
    mkdirSync(values.out, { recursive: true });
    writeFileSync(
      join(values.out, `pr-${report.pr}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  };

  const reports = await reviewEach(
    repo,
    prs,
    async (target) => {
      const { pr } = target;
      // CI pins the revisions it validated, so a push between preparation
      // and review cannot change what gets reviewed. Pinned revisions are
      // recorded first: a report that fails later still names its head.
      const pinnedBase = values['base-sha'];
      const pinnedHead = values['head-sha'];
      let title = `#${pr}`;
      if (pinnedBase && pinnedHead) {
        target.baseRevision = requireFullOid(pinnedBase, 'base revision');
        target.headRevision = requireFullOid(pinnedHead, 'head revision');
        // Only the title is still needed, and it is not worth failing for.
        try {
          title = readPullRequest(repo, pr).title;
        } catch (error) {
          process.stderr.write(
            `[pr ${pr}] title unavailable, reviewing without it: ${error instanceof Error ? error.message : String(error)}\n`,
          );
        }
      } else {
        target.phase = 'gh pr view';
        const meta = readPullRequest(repo, pr);
        title = meta.title;
        target.baseRevision = requireFullOid(meta.baseRefOid, 'base revision');
        target.headRevision = requireFullOid(meta.headRefOid, 'head revision');
      }
      const base = target.baseRevision;
      const head = target.headRevision;
      target.phase = 'fetch';
      ensureRevisions(git, [base, head]);
      // A bad base config fails only this pull request's review; the error
      // carries the file that failed.
      target.phase = 'config';
      const { config, source } = configOverride ?? loadReviewConfig(git, base);
      target.configSource = source;
      target.phase = 'review';
      process.stderr.write(
        `[config] pr ${pr}: ${describeConfig(config, source)}\n`,
      );

      if (dryRun || !tasks) {
        const changeSet = collectChangeSet(git, base, head, config.docsExclude);
        const diff = boundDiff(git, changeSet, {
          totalBytes: DEFAULT_BUDGETS.diffTotalBytes,
          perFileBytes: DEFAULT_BUDGETS.diffPerFileBytes,
        });
        const routed = routeDocs(changeSet.files, config.routing, (path) =>
          existsAt(git, head, path),
        );
        // The same exclusion and ranking as a real review, over routing
        // alone: a dry run has no extraction, so no evidence filter and no
        // symbol search.
        const selection = selectCandidates(
          routed.candidates,
          config,
          DEFAULT_BUDGETS.maxDocs,
        );
        process.stdout.write(
          `${JSON.stringify(
            {
              pr,
              config: source,
              files: changeSet.files.map(({ path, category }) => ({
                path,
                category,
              })),
              diffBytes: diff.bytes,
              omittedPaths: diff.omittedPaths,
              truncatedPaths: diff.truncatedPaths,
              candidateDocs: Object.fromEntries(routed.candidates),
              selectedDocs: selection.selected.map((doc) => doc.path),
              unroutedSources: routed.unroutedSources,
            },
            null,
            2,
          )}\n`,
        );
        return undefined;
      }

      return runDocsImpactReview(
        { git, tasks, ctx: createSleepingContext() },
        {
          config,
          configSource: source,
          repo,
          pr,
          prTitle: title,
          baseRevision: base,
          headRevision: head,
          teamId,
          diaryId,
          correlationId: correlationArg ?? randomUUID(),
          profileId,
          stageProfileIds,
          projectId: values.project,
          tags: [
            'review:docs-impact',
            'experiment:docs-impact',
            `repo:${repo}`,
            `pr:${pr}`,
            `revision:${head}`,
          ],
          pollIntervalSec,
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
