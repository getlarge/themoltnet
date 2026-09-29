import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { connect } from '@themoltnet/sdk/node';
import { createSdkTaskClient } from '@themoltnet/tasks-orchestrator';

import { createGit, existsAt, requireFullOid } from './git.js';
import { boundDiff, collectChangeSet } from './ingest.js';
import { renderComment, summarizeCorpus } from './report.js';
import {
  loadReviewConfig,
  loadReviewConfigFile,
  REVIEW_CONFIG_PATH,
  ReviewConfigError,
} from './review-config.js';
import { excludeCandidates, routeDocs, selectDocs } from './routing.js';
import { parseLabels, scoreReports } from './score.js';
import type { DocsImpactReport, StageName } from './types.js';
import {
  configFailureReport,
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
    { encoding: 'utf8' },
  );
  return JSON.parse(raw) as PullRequest;
}

function positiveInt(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
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

  const reports: DocsImpactReport[] = [];
  for (const pr of prs) {
    const meta = readPullRequest(repo, pr);
    // CI pins the revisions it validated, so a push between preparation and
    // review cannot change what gets reviewed.
    const base = requireFullOid(
      values['base-sha'] ?? meta.baseRefOid,
      'base revision',
    );
    const head = requireFullOid(
      values['head-sha'] ?? meta.headRefOid,
      'head revision',
    );
    git(['fetch', '--no-tags', '--quiet', 'origin', base, head]);
    let loaded: ReturnType<typeof loadReviewConfig>;
    try {
      loaded = configOverride ?? loadReviewConfig(git, base);
    } catch (error) {
      if (!(error instanceof ReviewConfigError)) throw error;
      process.stderr.write(`[config] pr ${pr}: ${error.message}\n`);
      const failed = configFailureReport(
        { repo, pr, baseRevision: base, headRevision: head },
        error.message,
      );
      reports.push(failed);
      process.stderr.write(`\n${renderComment(failed)}\n`);
      continue;
    }
    const { config, source } = loaded;
    process.stderr.write(
      `[config] pr ${pr}: ${
        source.kind === 'default'
          ? `defaults (no ${REVIEW_CONFIG_PATH} at ${base})`
          : `${source.location}, ${config.routing.rules.length} routing rules`
      }\n`,
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
      // The same exclusion and ranking as a real review.
      excludeCandidates(routed.candidates, config.docsExclude);
      const selection = selectDocs(
        routed.candidates,
        DEFAULT_BUDGETS.maxDocs,
        config.agentFacing,
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
      continue;
    }

    const report = await runDocsImpactReview(
      { git, tasks, ctx: createSleepingContext() },
      {
        config,
        configSource: source,
        repo,
        pr,
        prTitle: meta.title,
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
    reports.push(report);
    process.stderr.write(`\n${renderComment(report)}\n`);
    if (values.out) {
      mkdirSync(values.out, { recursive: true });
      writeFileSync(
        join(values.out, `pr-${pr}.json`),
        `${JSON.stringify(report, null, 2)}\n`,
      );
    }
  }

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

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `[fatal] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
