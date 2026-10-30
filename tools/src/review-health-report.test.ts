import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const script = fileURLToPath(
  new URL('../review-health-report.sh', import.meta.url),
);
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function runReport(failGroup = '') {
  const directory = mkdtempSync(join(tmpdir(), 'review-health-report-'));
  directories.push(directory);
  const cli = join(directory, 'moltnet');
  writeFileSync(
    cli,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$@" >> "$REPORT_CALLS"
for group do :; done
if [[ -n "$FAIL_GROUP" && "$group" == "$FAIL_GROUP" ]]; then
  echo 'analytics unavailable' >&2
  exit 7
fi
cat "$REPORT_FIXTURE"
`,
  );
  chmodSync(cli, 0o755);
  const fixture = join(directory, 'activity.json');
  writeFileSync(
    fixture,
    JSON.stringify({
      groups: [
        {
          label: 'lane:focused',
          metrics: {
            success: { taskCount: 2, terminalFailureTaskCount: 1 },
            productivity: { attemptCount: 3, medianTimeToAcceptedMs: 65000 },
            hurdles: { timeoutAttemptCount: 1, failedToolCallCount: 4 },
            roi: { estimatedCostUsd: 1.23 },
          },
        },
      ],
    }),
  );
  const calls = join(directory, 'calls.txt');
  const result = spawnSync(
    'bash',
    [
      script,
      '--team-id',
      'test-team',
      '--since',
      '2026-10-01T00:00:00Z',
      '--tags',
      'review:adaptive',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: directory + delimiter + process.env.PATH,
        REPORT_FIXTURE: fixture,
        REPORT_CALLS: calls,
        FAIL_GROUP: failGroup,
      },
    },
  );
  return { ...result, calls: readFileSync(calls, 'utf8') };
}

describe('review health report', () => {
  it('renders model and lane reports using the released CLI interface', () => {
    const result = runReport();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('### Per model');
    expect(result.stdout).toContain('### Per lane');
    expect(result.stdout).toContain(
      '| lane:focused | 2 | 3 | 1 | 1 | 4 | 1m 5s | $1.23 |',
    );
    expect(result.calls).toContain('--group-by\nprofile');
    expect(result.calls).toContain('--group-by\ntag');
    expect(result.calls).toContain('--completed-after\n2026-10-01T00:00:00Z');
  });

  it.each(['profile', 'tag'])('fails when %s analytics fail', (group) => {
    const result = runReport(group);
    expect(result.status).toBe(7);
    expect(result.stderr).toContain('analytics unavailable');
  });

  it('offers manual dispatch on the default branch and publishes the report', () => {
    const workflow = parse(
      readFileSync(
        new URL(
          '../../.github/workflows/review-health-report.yml',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as {
      on: Record<string, { inputs: Record<string, { default?: string }> }>;
      permissions: Record<string, string>;
      jobs: Record<
        string,
        {
          if: string;
          environment: string;
          steps: {
            name?: string;
            uses?: string;
            run?: string;
            env?: Record<string, string>;
            with?: Record<string, string>;
          }[];
        }
      >;
    };
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
    expect(workflow.on.workflow_dispatch.inputs.tags.default).toBe(
      'review:adaptive',
    );
    expect(workflow.permissions).toEqual({ contents: 'read' });
    const job = workflow.jobs.report;
    expect(job.if).toContain('github.event.repository.default_branch');
    expect(job.environment).toBe('legreffier');
    const generate = job.steps.find((step) =>
      step.name?.startsWith('Generate report'),
    )!;
    expect(generate.env?.REPORT_SINCE).toBe('${{ inputs.since }}');
    expect(generate.env?.REPORT_TAGS).toBe('${{ inputs.tags }}');
    expect(generate.run).not.toContain('${{');
    expect(generate.run).toContain(
      'bash tools/review-health-report.sh "${args[@]}"',
    );
    expect(generate.run).toContain('>> "$GITHUB_STEP_SUMMARY"');
    expect(
      job.steps.some((step) =>
        step.uses?.startsWith('actions/upload-artifact@'),
      ),
    ).toBe(true);
  });
});
