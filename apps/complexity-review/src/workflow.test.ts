import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Rubric } from '@moltnet/tasks';
import { describe, expect, it } from 'vitest';

import {
  buildEvidence,
  buildReviewTask,
  MAX_DIFF_BYTES,
  parseReviewOutput,
  type ReviewInput,
} from './workflow.js';

const rubric = JSON.parse(
  readFileSync(
    resolve(
      import.meta.dirname,
      '../../../rubrics/pr-complexity-binary-v1.json',
    ),
    'utf8',
  ),
) as Rubric;
const base = 'a'.repeat(40);
const head = 'b'.repeat(40);
const input: ReviewInput = {
  repo: 'getlarge/themoltnet',
  pr: 2545,
  title: 'Update actions',
  body: 'A small dependency update',
  commits: ['Update setup-node'],
  base,
  head,
  teamId: 'team',
  diaryId: 'diary',
  correlationId: 'correlation',
  profileId: 'profile',
  rubric,
};

describe('bounded complexity workflow', () => {
  it('passes a pinned diff as inert prompt data and budgets one task', () => {
    const calls: string[][] = [];
    const evidence = buildEvidence(
      (args) => {
        calls.push(args);
        return args.includes('--stat')
          ? '7 files changed'
          : '+uses: actions/setup-node@v6';
      },
      base,
      head,
    );
    const task = buildReviewTask(input, evidence);
    expect(calls).toEqual([
      ['diff', '--no-ext-diff', '--stat', `${base}...${head}`],
      ['diff', '--no-ext-diff', '--unified=2', `${base}...${head}`],
    ]);
    expect(task.input.brief).toContain('<untrusted-diff');
    expect(task.input.brief).toContain('Do not call shell');
    expect(task.runningTimeoutSec).toBe(180);
    expect(task.maxAttempts).toBe(1);
    expect(task.allowedProfiles).toEqual([{ profileId: 'profile' }]);
  });

  it('fails before model work when the diff exceeds its coverage limit', () => {
    expect(() =>
      buildEvidence(() => 'x'.repeat(MAX_DIFF_BYTES + 1), base, head),
    ).toThrow('above the 96000-byte review limit');
  });

  it('rejects an incomplete or arithmetically inconsistent judgment', () => {
    const scores = rubric.criteria.map((criterion) => ({
      criterionId: criterion.id,
      score: 1 as const,
      rationale: 'reviewable',
    }));
    expect(
      parseReviewOutput({ scores, composite: 1, verdict: 'Low burden' }, rubric)
        .composite,
    ).toBe(1);
    expect(() =>
      parseReviewOutput(
        { scores: scores.slice(1), composite: 1, verdict: 'Low burden' },
        rubric,
      ),
    ).toThrow('scores length');
    expect(() =>
      parseReviewOutput(
        { scores, composite: 0, verdict: 'Low burden' },
        rubric,
      ),
    ).toThrow();
  });
});
