/**
 * Regression tests on IR produced by live runs (gpt-oss:120b): the planner and
 * the reachability check must reproduce what was diagnosed by hand with Fast
 * Downward.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { Domain, Problem } from './ir.js';
import { checkPlan, validatePlan } from './planner.js';
import { checkProblemWithReachability } from './problem-check.js';

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', name),
      'utf8',
    ),
  ) as { domain: Domain; problem: Problem };

describe('explicit issue-workflow run', () => {
  const { domain, problem } = fixture('issue-explicit-run.json');

  it('finds a valid plan where breadth-first search hit its state limit', () => {
    // Act
    const result = checkPlan(domain, problem);

    // Assert
    expect(result.plan.status).toBe('found');
    if (result.plan.status !== 'found') return;
    expect(result.plan.explored).toBeLessThan(5_000);
    expect(validatePlan(domain, problem, result.plan.steps)).toMatchObject({
      valid: true,
    });
  });

  it('accepts the loophole Fast Downward found: one commit and PR for both issues', () => {
    // Arrange: plan returned by Fast Downward (LAMA) on the rendered PDDL
    const loophole = [
      '(claim-issue coder-a issue-101)',
      '(allocate-worktree coder-a issue-101 wt-1)',
      '(write-patch coder-a issue-101 wt-1 patch-1)',
      '(run-tests coder-a issue-101 wt-1 patch-1)',
      '(commit coder-a issue-101 wt-1 cs-1 ds-1 commit-1)',
      '(open-pull-request coder-a issue-101 commit-1 ps-2 pr-1)',
      '(ready-pull-request coder-a pr-1 commit-1)',
      '(review-and-approve reviewer-r pr-1 coder-a)',
      '(claim-issue coder-b issue-102)',
      '(allocate-worktree coder-b issue-102 wt-2)',
      '(write-patch coder-b issue-102 wt-2 patch-2)',
      '(run-tests coder-a issue-102 wt-2 patch-2)',
      '(commit coder-b issue-102 wt-2 cs-2 ds-2 commit-1)',
      '(open-pull-request coder-b issue-102 commit-1 ps-1 pr-1)',
      '(merge-pull-request coder-a issue-101 wt-1 pr-1 patch-1 commit-1)',
      '(ready-pull-request coder-b pr-1 commit-1)',
      '(review-and-approve reviewer-r pr-1 coder-b)',
      '(merge-pull-request coder-b issue-102 wt-2 pr-1 patch-1 commit-1)',
    ];

    // Act / Assert: the generated domain allows it, which is the bug a
    // gold "must fail" plan is meant to catch
    expect(validatePlan(domain, problem, loophole)).toMatchObject({
      valid: true,
    });
  });
});

describe('docs-review run', () => {
  const { domain, problem } = fixture('docs-review-run.json');

  it('proves the goal unreachable and names the facts missing at the root', () => {
    // Act
    const result = checkPlan(domain, problem);

    // Assert
    expect(result.plan).toMatchObject({ status: 'unsolvable', explored: 0 });
    const roots = Object.fromEntries(
      (result.reachability?.blocked ?? [])
        .filter((b) => b.rootMissing.length)
        .map((b) => [b.action, b.rootMissing]),
    );
    expect(roots).toEqual({
      'retrieve-documents-with-cc': ['(idle ra-1)'],
      'retrieve-documents-docs-only': ['(idle ra-1)'],
      'docs-check-passage': [
        '(pr-has-passage pr-42 dp-1)',
        '(doc-passage-added dp-1)',
      ],
    });
  });

  it('turns them into errors for the problem stage', () => {
    // Act
    const issues = checkProblemWithReachability(domain, problem);

    // Assert
    expect(
      issues.filter((i) => i.severity === 'error').map((i) => i.message),
    ).toContain(
      'can never run: (retrieve-documents-with-cc pr-42 ra-1 cc-1 doc-1) needs (idle ra-1), which no action adds and the initial facts do not contain',
    );
  });
});

describe('original issue-workflow run', () => {
  it('names the diary-entry pool that is never made available', () => {
    // Arrange
    const { domain, problem } = fixture('issue-original-run.json');

    // Act
    const result = checkPlan(domain, problem);

    // Assert
    expect(result.plan.status).toBe('unsolvable');
    expect(
      result.reachability?.blocked.find((b) => b.action === 'sign-commit'),
    ).toMatchObject({
      rootMissing: ['(unused diary-1)'],
    });
  });
});

describe('validatePlan', () => {
  const { domain, problem } = fixture('issue-explicit-run.json');

  it('reports the first step whose preconditions fail', () => {
    // Act
    const result = validatePlan(domain, problem, [
      '(allocate-worktree coder-a issue-101 wt-1)',
    ]);

    // Assert
    expect(result).toEqual({
      valid: false,
      step: 0,
      reason: 'missing (claimed issue-101 coder-a) (busy coder-a)',
    });
  });
});
