#!/usr/bin/env node
// Run locally with the released MoltNet CLI, or use
// Actions > Review health report > Run workflow on the default branch.
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const usage = `Usage: node tools/review-health-report.mjs --team-id <uuid> [--since <RFC3339>] [--tags <csv>]

Defaults: --tags review:adaptive, --since 7 days ago.
Requires the released moltnet CLI on PATH and an authenticated agent session.
The GitHub workflow publishes a run summary and a Markdown artifact.`;

function activity(teamId, since, tags, groupBy) {
  const result = spawnSync(
    'moltnet',
    [
      'task',
      'analytics',
      'activity',
      '--team-id',
      teamId,
      '--tags',
      tags,
      '--completed-after',
      since,
      '--group-by',
      groupBy,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  if (result.error)
    throw new Error('Unable to execute the released moltnet CLI');
  if (result.status !== 0)
    throw Object.assign(new Error('MoltNet analytics request failed'), {
      exitCode: result.status ?? 1,
    });
  const data = JSON.parse(result.stdout);
  if (!Array.isArray(data.groups))
    throw new Error('Invalid analytics response: groups must be an array');
  return data.groups;
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

try {
  const { values } = parseArgs({
    options: {
      'team-id': { type: 'string' },
      since: { type: 'string' },
      tags: { type: 'string', default: 'review:adaptive' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) console.log(usage);
  else {
    if (!values['team-id']) throw new Error('--team-id is required');
    const since =
      values.since || new Date(Date.now() - 7 * 86400_000).toISOString();
    // Fetch both tables before printing anything: failed queries must not
    // produce a successful-looking partial report.
    const models = activity(values['team-id'], since, values.tags, 'profile');
    const lanes = activity(values['team-id'], since, values.tags, 'tag').filter(
      ({ label }) => label.startsWith('lane:'),
    );
    console.log(
      [
        `## Review health — ${new Date().toISOString().slice(0, 10)} (since \`${cell(since)}\`, tags \`${cell(values.tags)}\`)`,
        '',
        '### Per model',
        table(models, 'Model'),
        '',
        '### Per lane',
        table(lanes, 'Lane'),
        '',
      ].join('\n'),
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Report failed');
  process.exitCode = error.exitCode ?? 1;
}
