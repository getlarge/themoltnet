import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  checkEligibility,
  type PullRequestFacts,
  RUNTIME_PATH_PREFIXES,
} from './eligibility.js';

const REPO = 'getlarge/themoltnet';

function pr(overrides: Partial<PullRequestFacts> = {}): PullRequestFacts {
  return {
    headRepo: REPO,
    baseRepo: REPO,
    author: 'someone',
    files: [{ filename: 'apps/cli/src/flags.ts' }],
    ...overrides,
  };
}

describe('checkEligibility', () => {
  it('admits a same-repository PR that leaves the runtime alone', () => {
    // Act / Assert
    expect(checkEligibility(pr())).toEqual({ eligible: true });
  });

  it.each([
    ['a fork', { headRepo: 'someone/themoltnet' }, /fork/],
    ['a deleted fork', { headRepo: null }, /fork/],
    ['Dependabot', { author: 'dependabot[bot]' }, /Dependabot/],
  ])('rejects %s', (_label, overrides, reason) => {
    // Act
    const result = checkEligibility(pr(overrides));

    // Assert
    expect(result.eligible).toBe(false);
    expect(!result.eligible && result.reason).toMatch(reason);
  });

  it.each([
    ['the workflow', '.github/workflows/docs-impact-review.yml'],
    [
      'a docs-review profile',
      '.github/runtime-profiles/legreffier-docs-review-gemma-v1.json',
    ],
    [
      'a runtime policy',
      '.github/runtime-policies/legreffier-review-readonly-v1.json',
    ],
    ['the reviewer app', 'apps/docs-impact-review/src/stages.ts'],
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
        previous_filename: 'apps/docs-impact-review/src/stages.ts',
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
            filename: 'apps/docs-impact-review/src/new.ts',
            previous_filename: 'tools/old.ts',
          },
        ],
      }),
    );

    // Assert
    expect(result.eligible).toBe(false);
  });
});

describe('eligibility CLI', () => {
  it('prints GitHub output lines when run with plain node', () => {
    // Arrange: exactly how the workflow's prepare job invokes it.
    const dir = mkdtempSync(join(tmpdir(), 'eligibility-'));
    const facts = join(dir, 'facts.json');
    writeFileSync(facts, JSON.stringify(pr({ author: 'dependabot[bot]' })));

    try {
      // Act
      const output = execFileSync(
        process.execPath,
        [resolve(import.meta.dirname, 'eligibility.ts'), facts],
        { encoding: 'utf8' },
      );

      // Assert
      expect(output).toBe(
        'skip=true\nreason=Dependabot pull requests are not reviewed\n',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is the gate the workflow actually runs', () => {
    // Arrange
    const workflow = readFileSync(
      resolve(
        import.meta.dirname,
        '../../../.github/workflows/docs-impact-review.yml',
      ),
      'utf8',
    );

    // Assert: the workflow protects itself and invokes this module.
    expect(RUNTIME_PATH_PREFIXES).toContain(
      '.github/workflows/docs-impact-review.yml',
    );
    expect(workflow).toContain('apps/docs-impact-review/src/eligibility.ts');
  });
});
