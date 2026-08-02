import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Rubric } from '@moltnet/tasks';
import { describe, expect, it } from 'vitest';

import {
  buildPrReviewInput,
  type PullRequestInfo,
} from './pr-complexity-review.js';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const rubric = JSON.parse(
  readFileSync(
    resolve(process.cwd(), '../rubrics/pr-complexity-binary-v1.json'),
    'utf8',
  ),
) as Rubric;

function pullRequest(
  overrides: Partial<PullRequestInfo> = {},
): PullRequestInfo {
  return {
    title: 'A reviewable change',
    body: '',
    url: 'https://github.com/getlarge/themoltnet/pull/42',
    headRefName: 'feature/reviewable-change',
    headRefOid: HEAD,
    baseRefOid: BASE,
    commitMessages: [],
    ...overrides,
  };
}

describe('buildPrReviewInput', () => {
  it('binds the immutable base and head revisions into the task input', () => {
    const input = buildPrReviewInput({
      prNumber: 42,
      repoSlug: 'getlarge/themoltnet',
      pr: pullRequest(),
      rubric,
    });

    expect(input.subject.summary).toContain(HEAD);
    expect(input.subject.summary).toContain(BASE);
    expect(input.taskPrompt).toContain(`Reviewed head: ${HEAD}`);
    expect(input.taskPrompt).toContain(`git diff ${BASE}...${HEAD}`);
    expect(input.taskPrompt).toContain(
      'trusted workflow code publishes the accepted output',
    );
    expect(input.taskPrompt).not.toContain('gh pr comment');
  });

  it('rejects abbreviated revisions', () => {
    expect(() =>
      buildPrReviewInput({
        prNumber: 42,
        repoSlug: 'getlarge/themoltnet',
        pr: pullRequest({ headRefOid: 'abc123' }),
        rubric,
      }),
    ).toThrow('headRefOid must be a full 40-character lowercase git OID');
  });
});
