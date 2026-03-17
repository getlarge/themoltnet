import { describe, expect, it } from 'vitest';

import {
  assembleTasksmithTask,
  truncateToTokenBudget,
} from './task-extractor.js';
import type { ExtractionResult, PrCandidate } from './types.js';

describe('assembleTasksmithTask', () => {
  it('merges Phase 1 candidate with Phase 2 extraction result', () => {
    const candidate: PrCandidate = {
      number: 408,
      title: 'fix(auth): validate JWT',
      body: '',
      baseRefName: 'main',
      headRefOid: 'abc',
      mergeCommitOid: 'def',
      labels: [],
      closedAt: '2026-01-01T00:00:00Z',
      changedFiles: ['libs/auth/src/jwt.ts', 'libs/auth/src/jwt.test.ts'],
      changedTestFiles: ['libs/auth/src/jwt.test.ts'],
      fixtureRef: 'base111',
      goldFixRef: 'def',
    };
    const extraction: ExtractionResult = {
      isViable: true,
      failToPass: ['pnpm --filter @moltnet/auth vitest run src/jwt.test.ts'],
      passToPass: [],
      problemStatement: 'JWT tokens are not validated for expiry.',
      family: 'bugfix',
      subsystems: ['@moltnet/auth'],
      criteria: [
        { description: 'Tests pass', check_type: 'test_passes', weight: 1.0 },
      ],
    };

    const task = assembleTasksmithTask(candidate, extraction);
    expect(task.task_id).toBe('pr-408');
    expect(task.fixture_ref).toBe('base111');
    expect(task.gold_fix_ref).toBe('def');
    expect(task.source_commit_ref).toBe('def');
    expect(task.fail_to_pass).toEqual(extraction.failToPass);
    expect(task.problem_statement).toBe(extraction.problemStatement);
    expect(task.family).toBe('bugfix');
    expect(task.confidence).toBe('high');
  });
});

describe('truncateToTokenBudget', () => {
  it('truncates text exceeding character limit', () => {
    const longText = 'a'.repeat(50000);
    const result = truncateToTokenBudget(longText, 8000);
    expect(result.length).toBeLessThanOrEqual(32000);
  });

  it('preserves short text', () => {
    const shortText = 'hello world';
    expect(truncateToTokenBudget(shortText, 8000)).toBe(shortText);
  });
});
