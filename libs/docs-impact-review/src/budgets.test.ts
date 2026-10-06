import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  BUDGET_LIMITS,
  DEFAULT_BUDGETS,
  DEFAULT_DOCS_RESERVE_SHARE,
  resolveBudgets,
  REVIEW_JOB_MARGIN_SEC,
} from './budgets.js';
import { STAGE_DISPATCH_TIMEOUT_SEC } from './stages.js';

describe('resolveBudgets', () => {
  it('reserves a share of the diff for docs unless configured', () => {
    // Act
    const defaults = resolveBudgets();
    const smallTotal = resolveBudgets({ diffTotalBytes: 8_000 });
    const configured = resolveBudgets({
      diffTotalBytes: 8_000,
      diffDocsReserveBytes: 0,
    });

    // Assert
    expect(defaults.diffDocsReserveBytes).toBe(
      DEFAULT_BUDGETS.diffTotalBytes * DEFAULT_DOCS_RESERVE_SHARE,
    );
    expect(smallTotal.diffDocsReserveBytes).toBe(2_000);
    expect(configured.diffDocsReserveBytes).toBe(0);
  });

  it('keeps a default when a key is set to undefined', () => {
    // Act
    const budgets = resolveBudgets({
      diffTotalBytes: undefined,
      stageRunningTimeoutSec: undefined,
    });

    // Assert
    expect(budgets.diffTotalBytes).toBe(DEFAULT_BUDGETS.diffTotalBytes);
    expect(budgets.stageRunningTimeoutSec).toBe(
      DEFAULT_BUDGETS.stageRunningTimeoutSec,
    );
  });
});

describe('stage timeout limits', () => {
  it('leave the review job its margin at the largest allowed timeout', () => {
    // Arrange: the reusable workflow's review job runs the chained stages.
    const workflow = parse(
      readFileSync(
        resolve(
          import.meta.dirname,
          '../../../.github/workflows/docs-impact-review-reusable.yml',
        ),
        'utf8',
      ),
    ) as { jobs: { review: { 'timeout-minutes': number } } };
    const jobSec = workflow.jobs.review['timeout-minutes'] * 60;

    // Act: extract, then coverage and docs check in parallel.
    const worstStagesSec =
      2 *
      (STAGE_DISPATCH_TIMEOUT_SEC +
        BUDGET_LIMITS.stageRunningTimeoutSec.maximum);

    // Assert
    expect(jobSec - worstStagesSec).toBeGreaterThanOrEqual(
      REVIEW_JOB_MARGIN_SEC,
    );
  });
});
