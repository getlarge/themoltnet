import { describe, expect, it } from 'vitest';

import { checkEligibility, type PullRequestFacts } from '../src/eligibility.js';

const REPO = 'getlarge/themoltnet';
const PROTECTED = [
  '.github/workflows/review.yml',
  '.github/runtime-profiles/legreffier-docs-review-',
  '.github/runtime-policies/',
  'libs/docs-impact-review/',
  'packages/agent-daemon-action/',
];

function pr(overrides: Partial<PullRequestFacts> = {}): PullRequestFacts {
  const files = overrides.files ?? [{ filename: 'apps/cli/src/flags.ts' }];
  return {
    headRepo: REPO,
    baseRepo: REPO,
    author: 'someone',
    files,
    changedFiles: files.length,
    protectedPaths: PROTECTED,
    ...overrides,
  };
}

describe('checkEligibility', () => {
  it('admits a file list longer than the reported count', () => {
    // Act / Assert
    expect(checkEligibility(pr({ changedFiles: 0 }))).toEqual({
      eligible: true,
    });
  });

  it.each([
    './libs/docs-impact-review/',
    '/libs/docs-impact-review/',
    '  libs/docs-impact-review/  ',
    'libs/docs-impact-review/\r',
    './/libs/docs-impact-review/',
  ])('normalizes the protected prefix %j', (prefix) => {
    // Act
    const result = checkEligibility(
      pr({
        files: [{ filename: 'libs/docs-impact-review/src/review.ts' }],
        protectedPaths: [prefix],
      }),
    );

    // Assert
    expect(result).toMatchObject({ eligible: false });
  });

  it('admits a same-repository PR that leaves the runtime alone', () => {
    // Act / Assert
    expect(checkEligibility(pr())).toEqual({ eligible: true });
  });

  it.each([
    ['a fork', { headRepo: 'someone/themoltnet' }, /fork/],
    ['a deleted fork', { headRepo: null }, /fork/],
    ['Dependabot', { author: 'dependabot[bot]' }, /Dependabot/],
    [
      'a truncated file list',
      { changedFiles: 3001 },
      /listed 1 of 3001 changed files/,
    ],
  ])('rejects %s', (_label, overrides, reason) => {
    // Act
    const result = checkEligibility(pr(overrides));

    // Assert
    expect(result.eligible).toBe(false);
    expect(!result.eligible && result.reason).toMatch(reason);
  });

  it('admits a complete file list', () => {
    // Act / Assert
    expect(checkEligibility(pr({ changedFiles: 1 }))).toEqual({
      eligible: true,
    });
  });

  it.each([
    ['the workflow', '.github/workflows/review.yml'],
    [
      'a docs-review profile',
      '.github/runtime-profiles/legreffier-docs-review-gemma-v1.json',
    ],
    [
      'a runtime policy',
      '.github/runtime-policies/legreffier-review-readonly-v1.json',
    ],
    ['the reviewer', 'libs/docs-impact-review/src/stages.ts'],
    ['the daemon action', 'packages/agent-daemon-action/action.yml'],
  ])('rejects a PR that changes %s', (_label, filename) => {
    // Act
    const result = checkEligibility(pr({ files: [{ filename }] }));

    // Assert
    expect(result).toEqual({
      eligible: false,
      reason: `the PR changes the trusted review runtime (${filename})`,
    });
  });

  it('rejects a rename that moves a runtime file out of the protected paths', () => {
    // Arrange: only the old path is protected.
    const files = [
      {
        filename: 'tools/harmless.ts',
        previous_filename: 'libs/docs-impact-review/src/stages.ts',
      },
    ];

    // Act
    const result = checkEligibility(pr({ files }));

    // Assert
    expect(result.eligible).toBe(false);
  });

  it('rejects a rename that moves a file into the protected paths', () => {
    // Act
    const result = checkEligibility(
      pr({
        files: [
          {
            filename: 'libs/docs-impact-review/src/new.ts',
            previous_filename: 'tools/old.ts',
          },
        ],
      }),
    );

    // Assert
    expect(result.eligible).toBe(false);
  });
});

describe('protected paths', () => {
  it('protects nothing a repository did not name', () => {
    // Act
    const result = checkEligibility(
      pr({
        protectedPaths: undefined,
        files: [{ filename: '.github/workflows/review.yml' }],
      }),
    );

    // Assert
    expect(result).toEqual({ eligible: true });
  });

  it('ignores empty prefixes, which would match every path', () => {
    // Act / Assert
    expect(checkEligibility(pr({ protectedPaths: [''] }))).toEqual({
      eligible: true,
    });
  });
});
