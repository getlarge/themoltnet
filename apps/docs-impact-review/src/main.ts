import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { connect } from '@themoltnet/sdk/node';
import { createSdkTaskClient } from '@themoltnet/tasks-orchestrator';

import { createGit, requireFullOid } from './git.js';
import { boundDiff, collectChangeSet } from './ingest.js';
import { renderComment, summarizeCorpus } from './report.js';
import { parseRoutingMap, routeDocs } from './routing.js';
import type { DocsImpactReport } from './types.js';
import {
  createSleepingContext,
  DEFAULT_BUDGETS,
  DEFAULT_POLL_INTERVAL_SEC,
  runDocsImpactReview,
} from './workflow.js';

const USAGE = `Usage: moltnet-docs-impact-review --repo owner/repo --pr N [--pr N ...]
  --team <uuid> --diary <uuid> --profile <name-or-id>
  [--out <dir>] [--poll-interval <sec>] [--routing <path>] [--dry-run]

Runs the experimental docs-impact review against existing pull requests from a
local checkout. PR metadata is read with \`gh\`; base/head are fetched as inert
git objects. --dry-run performs ingestion and routing only (no tasks).`;

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
      out: { type: 'string' },
      'poll-interval': { type: 'string' },
      routing: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
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
  const repo = values.repo;
  const teamId = values.team ?? '';
  const diaryId = values.diary ?? '';
  const prs = values.pr.map((value) => positiveInt(value, '--pr'));
  const pollIntervalSec = values['poll-interval']
    ? Number(values['poll-interval'])
    : DEFAULT_POLL_INTERVAL_SEC;
  const routingPath =
    values.routing ?? new URL('../docs-routing.json', import.meta.url);
  const routingMap = parseRoutingMap(
    JSON.parse(readFileSync(routingPath, 'utf8')) as unknown,
  );
  const git = createGit(process.cwd());

  const agent = dryRun ? undefined : await connect();
  let profileId = values.profile ?? '';
  if (agent && values.team) {
    const { items } = await agent.runtimeProfiles.list({ teamId: values.team });
    const match =
      items.find((profile) => profile.id === profileId) ??
      items.find((profile) => profile.name === profileId);
    if (!match) {
      throw new Error(`runtime profile "${profileId}" not found in team`);
    }
    profileId = match.id;
  }
  const tasks = agent ? createSdkTaskClient(agent) : undefined;

  const reports: DocsImpactReport[] = [];
  for (const pr of prs) {
    const meta = readPullRequest(repo, pr);
    const base = requireFullOid(meta.baseRefOid, 'baseRefOid');
    const head = requireFullOid(meta.headRefOid, 'headRefOid');
    git(['fetch', '--no-tags', '--quiet', 'origin', base, head]);

    if (dryRun || !tasks) {
      const changeSet = collectChangeSet(git, base, head);
      const diff = boundDiff(git, changeSet, {
        totalBytes: DEFAULT_BUDGETS.diffTotalBytes,
        perFileBytes: DEFAULT_BUDGETS.diffPerFileBytes,
      });
      const routed = routeDocs(changeSet.files, routingMap, (path) => {
        try {
          git(['cat-file', '-e', `${head}:${path}`]);
          return true;
        } catch {
          return false;
        }
      });
      process.stdout.write(
        `${JSON.stringify(
          {
            pr,
            files: changeSet.files.map(({ path, category }) => ({
              path,
              category,
            })),
            diffBytes: diff.bytes,
            omittedPaths: diff.omittedPaths,
            truncatedPaths: diff.truncatedPaths,
            candidateDocs: Object.fromEntries(routed.candidates),
            unroutedSources: routed.unroutedSources,
          },
          null,
          2,
        )}\n`,
      );
      continue;
    }

    const report = await runDocsImpactReview(
      { git, tasks, ctx: createSleepingContext(), routingMap },
      {
        repo,
        pr,
        prTitle: meta.title,
        baseRevision: base,
        headRevision: head,
        teamId,
        diaryId,
        correlationId: randomUUID(),
        profileId,
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
        { summary: summarizeCorpus(reports), reports },
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
