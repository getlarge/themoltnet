import { readFileSync } from 'node:fs';

import { connect } from '@themoltnet/sdk/node';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

import { generateReport, parseSince } from '../review-health-report.mjs';

vi.mock('@themoltnet/sdk/node', () => ({ connect: vi.fn() }));

interface Workflow {
  on: {
    workflow_dispatch: {
      inputs: Record<string, { default?: string; description: string }>;
    };
  };
  permissions: Record<string, string>;
  jobs: {
    report: {
      if: string;
      environment: string;
      steps: { run?: string; uses?: string }[];
    };
  };
}

const analytics = vi.fn();
const args = ['--team-id', 'test-team', '--since', '2026-10-01'];
function response(label = 'lane:focused') {
  return {
    groups: [
      {
        label,
        metrics: {
          success: { taskCount: 2, terminalFailureTaskCount: 1 },
          productivity: { attemptCount: 3, medianTimeToAcceptedMs: 65000 },
          hurdles: { timeoutAttemptCount: 1, failedToolCallCount: 4 },
          roi: { estimatedCostUsd: 1.23 },
        },
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  analytics.mockReset().mockResolvedValue(response());
  vi.mocked(connect).mockResolvedValue({
    tasks: { getActivityAnalytics: analytics },
  } as unknown as Awaited<ReturnType<typeof connect>>);
});

describe('review health report', () => {
  it('uses SDK analytics with a team, tag arrays and actual model grouping', async () => {
    const result = await generateReport([
      ...args,
      '--tags',
      'review:adaptive, review:manual',
    ]);
    expect(result).toContain('### Per model');
    expect(result).toContain('### Per lane');
    expect(result).toContain(
      '| lane:focused | 2 | 3 | 1 | 1 | 4 | 1m 5s | $1.23 |',
    );
    for (const [index, groupBy] of ['providerModel', 'tag'].entries()) {
      expect(analytics).toHaveBeenNthCalledWith(
        index + 1,
        { teamId: 'test-team' },
        {
          completedAfter: '2026-10-01T00:00:00.000Z',
          tags: ['review:adaptive', 'review:manual'],
          groupBy,
        },
      );
    }
  });

  it('escapes table delimiters and line breaks in analytics labels', async () => {
    analytics.mockResolvedValue(response('lane:focused|extra\nrow'));
    expect(await generateReport(args)).toContain(
      '| lane:focused\\|extra row |',
    );
  });

  it('limits the lane table to lane tags', async () => {
    analytics
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response('review:adaptive'));
    const report = await generateReport(args);
    expect(report.split('### Per lane')[1]).not.toContain('review:adaptive');
  });

  it('prints help without connecting or querying analytics', async () => {
    expect(await generateReport(['--help'])).toContain('--since 2026-10-01');
    expect(connect).not.toHaveBeenCalled();
  });

  it.each([1, 2])(
    'rejects rather than returning a partial report if query %s fails',
    async (query) => {
      if (query === 2) analytics.mockResolvedValueOnce(response());
      analytics.mockRejectedValueOnce(new Error('analytics unavailable'));
      await expect(generateReport(args)).rejects.toThrow(
        'analytics unavailable',
      );
    },
  );

  it.each(['2026-02-30', 'yesterday', '1730000000', '2026-10-01T12:00:00'])(
    'rejects invalid date %s before connecting',
    async (date) => {
      await expect(
        generateReport(['--team-id', 'test-team', '--since', date]),
      ).rejects.toThrow('--since must be a date like 2026-10-01');
      expect(connect).not.toHaveBeenCalled();
    },
  );

  it('accepts full timestamps with explicit timezones', () => {
    expect(parseSince('2026-10-01T09:30:00Z')).toBe('2026-10-01T09:30:00.000Z');
    expect(parseSince('2026-10-01T09:30:00+02:00')).toBe(
      '2026-10-01T07:30:00.000Z',
    );
  });

  it('defaults empty dates to the last seven days', () => {
    expect(parseSince('', Date.parse('2026-10-30T12:00:00Z'))).toBe(
      '2026-10-23T12:00:00.000Z',
    );
  });

  it('offers understandable dates, manual dispatch and a pinned released SDK', () => {
    const workflow = parse(
      readFileSync(
        new URL(
          '../../.github/workflows/review-health-report.yml',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as Workflow;
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
    expect(workflow.on.workflow_dispatch.inputs.since.description).toContain(
      '2026-10-01',
    );
    expect(workflow.on.workflow_dispatch.inputs.tags.default).toBe(
      'review:adaptive',
    );
    expect(workflow.permissions).toEqual({ contents: 'read' });
    const job = workflow.jobs.report;
    expect(job.if).toContain('github.event.repository.default_branch');
    expect(job.environment).toBe('legreffier');
    const runs = job.steps
      .map((step: { run?: string }) => step.run ?? '')
      .join('\n');
    expect(runs).toContain('@themoltnet/sdk@0.154.2');
    expect(runs).not.toContain('@themoltnet/cli');
    expect(runs).toContain('node "$RUNNER_TEMP/review-health/report.mjs"');
    expect(runs).not.toContain('${{');
    expect(
      job.steps.some((step: { uses?: string }) =>
        step.uses?.startsWith('actions/upload-artifact@'),
      ),
    ).toBe(true);
  });
});
