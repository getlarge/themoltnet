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
const workflow = readFileSync(
  resolve(
    process.cwd(),
    '../.github/workflows/legreffier-complexity-review.yml',
  ),
  'utf8',
);
const reviewProfile = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      '../.github/runtime-profiles/legreffier-review-v1.json',
    ),
    'utf8',
  ),
) as { maxTurns: number; toolEnforcement: string };
const reviewPolicy = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      '../.github/runtime-policies/legreffier-review-readonly-v1.json',
    ),
    'utf8',
  ),
) as { tools: string[]; shellCommands: { argvPrefix: string[] }[] };

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
    expect(input.taskPrompt).toContain(
      'Do not use `gh`, `curl`, web tools, or any network fallback',
    );
    expect(input.taskPrompt).not.toContain('gh pr comment');
  });

  // The reviewer's turns are capped by the runtime profile. On PR #2253 a
  // 44-file diff needed 21 to 24+ bash calls under a cap of 24 and failed with
  // max_turns_exceeded on one attempt; the prompt now steers the reviewer to
  // read the diff in bulk instead of one file per turn.
  it('tells the reviewer its turns are bounded and how to spend them', () => {
    const input = buildPrReviewInput({
      prNumber: 42,
      repoSlug: 'getlarge/themoltnet',
      pr: pullRequest(),
      rubric,
    });

    expect(input.taskPrompt).toContain('Your tool-use turns are bounded');
    expect(input.taskPrompt).toContain(`git diff --stat ${BASE}...${HEAD}`);
    expect(input.taskPrompt).toContain('Never walk the diff one file per turn');
    expect(input.subject.inspectionHints?.join(' ')).toContain(
      'Tool turns are bounded',
    );
  });

  it('preserves revision ancestry required by the three-dot diff', () => {
    expect(workflow).toContain('fetch-depth: 0');
    expect(workflow).toContain(
      'git fetch --no-tags origin "$BASE_SHA" "$HEAD_SHA"',
    );
    expect(workflow).not.toContain(
      'git fetch --no-tags --depth=1 origin "$BASE_SHA" "$HEAD_SHA"',
    );
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

describe('review runtime definitions', () => {
  // Measured on PR #2253: 17 bash calls for a 5-commit diff, 21 to 24+ for a
  // 44-file diff. 40 keeps roughly 1.7x headroom over the largest observed
  // review without removing the bound.
  it('keeps enough turn headroom for large pull requests', () => {
    expect(reviewProfile.maxTurns).toBeGreaterThanOrEqual(40);
  });

  // Every executable the daemon audit stream showed reviewers using. If one is
  // missing, `watch` mode logs it as tool_not_permitted on every call and
  // `enforce` would fail the review outright.
  it('grants the executables a review actually runs', () => {
    for (const tool of [
      'cat',
      'cd',
      'find',
      'grep',
      'head',
      'ls',
      'pwd',
      'read',
      'tail',
    ]) {
      expect(reviewPolicy.tools).toContain(tool);
    }
    const gitPrefixes = reviewPolicy.shellCommands
      .filter((rule) => rule.argvPrefix[0] === 'git')
      .map((rule) => rule.argvPrefix[1]);
    for (const sub of ['diff', 'show', 'log', 'rev-parse', 'ls-files']) {
      expect(gitPrefixes).toContain(sub);
    }
  });

  it('grants no write or network capability', () => {
    const all = reviewPolicy.shellCommands.map((r) => r.argvPrefix.join(' '));
    for (const forbidden of [
      'git push',
      'git commit',
      'git checkout',
      'curl',
      'gh',
    ]) {
      expect(all.some((c) => c.startsWith(forbidden))).toBe(false);
      expect(reviewPolicy.tools).not.toContain(forbidden.split(' ')[0]);
    }
    expect(reviewPolicy.tools).not.toContain('bash');
    expect(reviewPolicy.tools).not.toContain('write');
  });
});
