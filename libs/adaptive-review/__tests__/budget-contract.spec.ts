import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  CLASSIFIER_STAGE_BUDGET_SEC,
  parseReviewTaskBudgets,
} from '../src/config.js';
import { REVIEW_REPAIR_LIMITS } from '../src/lane.js';

const root = resolve(import.meta.dirname, '../../..');

function callerBudgets() {
  const caller = readFileSync(
    resolve(root, '.github/workflows/adaptive-review.yml'),
    'utf8',
  );
  const workflow = parse(caller) as {
    jobs: { review: { with: { 'task-budgets': string } } };
  };
  const raw = workflow.jobs.review.with['task-budgets'];
  if (!raw) throw new Error('adaptive review caller has no task budgets');
  const budgets = parseReviewTaskBudgets(raw, [
    'tests',
    'conventions',
    'security',
    'blast-radius',
    'performance',
  ]);
  if (!budgets.focused || !budgets.security)
    throw new Error('adaptive review caller is missing a deep lane budget');
  return { focused: budgets.focused, security: budgets.security };
}

interface CommittedProfile {
  maxTurns: number;
  models: { generation?: { thinkingLevel?: string | null } };
}

function profile(name: string): CommittedProfile {
  return JSON.parse(
    readFileSync(
      resolve(root, `.github/runtime-profiles/${name}.json`),
      'utf8',
    ),
  ) as CommittedProfile;
}

describe('adaptive review task budgets', () => {
  it('leaves routing-job time outside the classifier stage budget', () => {
    const workflow = parse(
      readFileSync(
        resolve(root, '.github/workflows/adaptive-review-reusable.yml'),
        'utf8',
      ),
    ) as { jobs: { route: { 'timeout-minutes': number } } };
    expect(
      workflow.jobs.route['timeout-minutes'] * 60 - CLASSIFIER_STAGE_BUDGET_SEC,
    ).toBeGreaterThanOrEqual(10 * 60);
  });

  it('allows the repository-reading profiles to use their configured turns', () => {
    const budgets = callerBudgets();
    const focused = profile('legreffier-adaptive-focused-review-v1');
    const security = profile('legreffier-security-review-v2');

    // Cloud model calls and repository inspection can each consume a turn.
    // The high-reasoning security profile needs more time per turn.
    expect(
      budgets.focused.runningTimeoutSec / focused.maxTurns,
    ).toBeGreaterThanOrEqual(18);
    expect(security.models.generation?.thinkingLevel).toBe('high');
    expect(
      budgets.security.runningTimeoutSec / security.maxTurns,
    ).toBeGreaterThanOrEqual(22);
  });

  it('leaves review-job time for both security stages and all bounded corrections', () => {
    const { security } = callerBudgets();
    const workflow = readFileSync(
      resolve(root, '.github/workflows/adaptive-review-reusable.yml'),
      'utf8',
    );
    const review =
      /^ {2}review:\n(?:(?!^ {2}[\w-]+:).)*?^ {4}timeout-minutes: (\d+)/ms.exec(
        workflow,
      );
    expect(review).not.toBeNull();
    const jobSec = Number(review?.[1]) * 60;
    const repairSec =
      REVIEW_REPAIR_LIMITS.maxRepairs *
      (REVIEW_REPAIR_LIMITS.runningTimeoutSec +
        REVIEW_REPAIR_LIMITS.dispatchTimeoutSec);
    const twoStagesSec =
      2 *
      (security.dispatchTimeoutSec + security.runningTimeoutSec + repairSec);

    expect(jobSec - twoStagesSec).toBeGreaterThanOrEqual(5 * 60);
    expect(
      workflow.match(
        /ADAPTIVE_TASK_BUDGETS: \$\{\{ inputs\.task-budgets \}\}/g,
      ),
    ).toHaveLength(2);
  });
});
