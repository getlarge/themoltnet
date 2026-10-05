import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { DecisionClient } from './decision.js';
import type { Domain, Problem } from './ir.js';
import { forcedAnalysis } from './planner.js';
import { reviewPlan } from './review.js';
import { blocksDomain, blocksProblem } from './test-fixtures.js';

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', name),
      'utf8',
    ),
  ) as { domain: Domain; problem: Problem };

/** Answers from a fixed table, recording the steps it was asked about. */
function decisions(answers: Record<string, number>) {
  const asked: string[] = [];
  const client: DecisionClient = {
    yesNo: (state) => {
      const step = (state as { step: string }).step;
      asked.push(step);
      return Promise.resolve(answers[step] ?? 0);
    },
  };
  return { client, asked };
}

describe('forcedAnalysis', () => {
  it('finds what the Blocks World goal forces, per block', () => {
    // Act
    const result = forcedAnalysis(blocksDomain, blocksProblem);

    // Assert
    expect(result).toEqual({
      forced: ['pick-up', 'stack'],
      skippable: ['put-down', 'unstack'],
      shared: [],
    });
  });

  it(
    'finds work shared between issues in the explicit issue-workflow run',
    { timeout: 30_000 },
    () => {
      // Arrange
      const { domain, problem } = fixture('issue-explicit-run.json');

      // Act
      const result = forcedAnalysis(domain, problem);

      // Assert: issue-102 and issue-101 can each reuse the other's work
      expect(result.shared.map((s) => s.action)).toEqual([
        'write-patch',
        'open-pull-request',
      ]);
      expect(result.shared[0].items).toEqual(['issue-101', 'issue-102']);
    },
  );
});

describe('reviewPlan', () => {
  const texts = { description: 'process', situation: 'situation' };

  it('flags a skippable step the decision model says is required', async () => {
    // Arrange: extraction is skippable in this generated domain
    const { domain, problem } = fixture('docs-guided-shortcut-run.json');
    const { client, asked } = decisions({ 'extract-contract-changes': 0.99 });

    // Act
    const review = await reviewPlan(domain, problem, texts, {
      decisions: client,
    });

    // Assert
    expect(asked).toEqual(review.skippable);
    expect(review.findings).toEqual([
      expect.objectContaining({
        code: 'required-step-skippable',
        path: 'actions/extract-contract-changes',
      }),
    ]);
  });

  it('accepts optional steps the decision model says are not required', async () => {
    // Arrange
    const { client } = decisions({ 'put-down': 0.3, unstack: 0.01 });

    // Act
    const review = await reviewPlan(blocksDomain, blocksProblem, texts, {
      decisions: client,
    });

    // Assert
    expect(review.findings).toEqual([]);
    expect(review.required).toEqual({ 'put-down': 0.3, unstack: 0.01 });
  });

  it(
    'reports shared work without asking the decision model',
    { timeout: 30_000 },
    async () => {
      // Arrange
      const { domain, problem } = fixture('issue-explicit-run.json');

      // Act
      const review = await reviewPlan(domain, problem, texts);

      // Assert
      expect(review.findings.map((f) => f.code)).toContain('shared-work');
    },
  );
});
