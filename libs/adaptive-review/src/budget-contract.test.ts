import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEEP_REVIEW_DISPATCH_TIMEOUT_SEC,
  FOCUSED_RUNNING_TIMEOUT_SEC,
  SECURITY_RUNNING_TIMEOUT_SEC,
} from './workflow.js';

const root = resolve(import.meta.dirname, '../../..');

function profile(name: string): { maxTurns: number; thinkingLevel?: string } {
  return JSON.parse(
    readFileSync(
      resolve(root, `.github/runtime-profiles/${name}.json`),
      'utf8',
    ),
  ) as { maxTurns: number; thinkingLevel?: string };
}

describe('adaptive review task budgets', () => {
  it('allows the repository-reading profiles to use their configured turns', () => {
    const focused = profile('legreffier-adaptive-focused-review-v1');
    const security = profile('legreffier-security-review-v2');

    // Cloud model calls and repository inspection can each consume a turn.
    // The high-reasoning security profile needs more time per turn.
    expect(
      FOCUSED_RUNNING_TIMEOUT_SEC / focused.maxTurns,
    ).toBeGreaterThanOrEqual(18);
    expect(security.thinkingLevel).toBe('high');
    expect(
      SECURITY_RUNNING_TIMEOUT_SEC / security.maxTurns,
    ).toBeGreaterThanOrEqual(22);
  });

  it('leaves review-job time for both sequential security stages', () => {
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
    const twoStagesSec =
      2 * (DEEP_REVIEW_DISPATCH_TIMEOUT_SEC + SECURITY_RUNNING_TIMEOUT_SEC);

    expect(jobSec - twoStagesSec).toBeGreaterThanOrEqual(10 * 60);
  });
});
