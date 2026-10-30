#!/usr/bin/env node
// Actions > Review health report > Run workflow on the default branch.
// Local workspace source imports require: node --import tsx tools/review-health-report.mjs
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { connect } from '@themoltnet/sdk/node';

const usage = `Usage: node --import tsx tools/review-health-report.mjs --team-id <uuid> [--since <date>] [--tags <csv>]

--since 2026-10-01 means midnight UTC on October 1, 2026.
A full timestamp is also accepted: 2026-10-01T09:30:00Z or 2026-10-01T09:30:00+02:00.
Defaults: --tags review:adaptive, --since 7 days ago.
Uses the MoltNet SDK with your selected identity, or MOLTNET_AGENT_KEY and MOLTNET_API_URL.
The GitHub workflow publishes a run summary and a Markdown artifact.`;

export function parseSince(input, now = Date.now()) {
  if (!input?.trim()) return new Date(now - 7 * 86400_000).toISOString();
  const value = input.trim();
  const format =
    /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/;
  const day = value.slice(0, 10);
  const dayTime = Date.parse(`${day}T00:00:00Z`);
  const time = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (
    !format.test(value) ||
    !Number.isFinite(dayTime) ||
    new Date(dayTime).toISOString().slice(0, 10) !== day ||
    !Number.isFinite(time)
  ) {
    throw new Error(
      '--since must be a date like 2026-10-01 (UTC) or a timestamp like 2026-10-01T09:30:00Z',
    );
  }
  return new Date(time).toISOString();
}

function duration(ms) {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function cell(value) {
  return String(value)
    .replaceAll('|', '\\|')
    .replace(/[\r\n]+/g, ' ');
}

const dollars = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

function table(groups, label) {
  return [
    `| ${label} | Tasks | Attempts | Term. failures | Timeouts | Failed tool calls | Median time→accept | Cost |`,
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...groups.map(({ label, metrics }) => {
      const values = [
        label,
        metrics.success?.taskCount ?? 0,
        metrics.productivity?.attemptCount ?? 0,
        metrics.success?.terminalFailureTaskCount ?? 0,
        metrics.hurdles?.timeoutAttemptCount ?? 0,
        metrics.hurdles?.failedToolCallCount ?? 0,
        duration(metrics.productivity?.medianTimeToAcceptedMs ?? 0),
        dollars.format(metrics.roi?.estimatedCostUsd ?? 0),
      ];
      return `| ${values.map(cell).join(' | ')} |`;
    }),
  ].join('\n');
}

export async function generateReport(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      'team-id': { type: 'string', default: process.env.MOLTNET_TEAM_ID },
      since: { type: 'string', default: process.env.REPORT_SINCE },
      tags: {
        type: 'string',
        default: process.env.REPORT_TAGS || 'review:adaptive',
      },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) return usage;
  if (!values['team-id']?.trim()) throw new Error('--team-id is required');
  const since = parseSince(values.since);
  const tags = values.tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (tags.length === 0)
    throw new Error('--tags must contain at least one tag');
  const agent = await connect();
  const options = { teamId: values['team-id'] };
  const query = { completedAfter: since, tags };
  // Fetch both tables before publishing anything: failures must not leave a
  // successful-looking partial report or workflow summary.
  const models = await agent.tasks.getActivityAnalytics(options, {
    ...query,
    groupBy: 'providerModel',
  });
  const lanes = await agent.tasks.getActivityAnalytics(options, {
    ...query,
    groupBy: 'tag',
  });
  return [
    `## Review health — ${new Date().toISOString().slice(0, 10)} (since \`${cell(since)}\`, tags \`${cell(tags.join(','))}\`)`,
    '',
    '### Per model',
    table(models.groups, 'Model'),
    '',
    '### Per lane',
    table(
      lanes.groups.filter(({ label }) => label.startsWith('lane:')),
      'Lane',
    ),
    '',
  ].join('\n');
}

if (import.meta.main) {
  try {
    const report = await generateReport();
    if (process.env.GITHUB_STEP_SUMMARY) {
      writeFileSync(
        join(process.env.RUNNER_TEMP, 'review-health-report.md'),
        report,
      );
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
    } else console.log(report);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Report failed');
    process.exitCode = 1;
  }
}
