import { describe, expect, it } from 'vitest';

import {
  assembleTasksmithTask,
  extractTouchedTestNames,
  normalizeTestCommand,
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

    const task = assembleTasksmithTask(candidate, extraction, 0);
    expect(task.task_id).toBe('pr-408-0');
    expect(task.fixture_ref).toBe('base111');
    expect(task.gold_fix_ref).toBe('def');
    expect(task.source_commit_ref).toBe('def');
    // vitest run → test normalization applies
    expect(task.fail_to_pass).toEqual([
      'pnpm --filter @moltnet/auth test src/jwt.test.ts',
    ]);
    expect(task.problem_statement).toBe(extraction.problemStatement);
    expect(task.family).toBe('bugfix');
    expect(task.confidence).toBe('high');
  });
});

describe('normalizeTestCommand', () => {
  it('replaces --testPathPattern with -- separator', () => {
    expect(
      normalizeTestCommand(
        "pnpm --filter @moltnet/diary-service test --testPathPattern='diary-service.test'",
      ),
    ).toBe('pnpm --filter @moltnet/diary-service test diary-service.test');
  });

  it('strips repo-root path prefixes', () => {
    expect(
      normalizeTestCommand(
        'pnpm --filter @moltnet/auth test libs/auth/__tests__/relationship-reader.test.ts',
      ),
    ).toBe(
      'pnpm --filter @moltnet/auth test __tests__/relationship-reader.test.ts',
    );
  });

  it('fixes exec vitest → test', () => {
    expect(
      normalizeTestCommand(
        'pnpm --filter @moltnet/mcp-server exec vitest run __tests__/diary-tools.test.ts',
      ),
    ).toBe(
      'pnpm --filter @moltnet/mcp-server test __tests__/diary-tools.test.ts',
    );
  });

  it('rewrites vitest run to test', () => {
    expect(
      normalizeTestCommand(
        'pnpm --filter @moltnet/api-client vitest run __tests__/retry.test.ts',
      ),
    ).toBe('pnpm --filter @moltnet/api-client test __tests__/retry.test.ts');
  });

  it('removes extra -- after test script before file args', () => {
    expect(
      normalizeTestCommand(
        'pnpm --filter @moltnet/rest-api run test -- __tests__/signing-requests.test.ts',
      ),
    ).toBe(
      'pnpm --filter @moltnet/rest-api run test __tests__/signing-requests.test.ts',
    );
  });

  it('rewrites test --run <file> to positional file arg', () => {
    expect(
      normalizeTestCommand(
        'pnpm --filter @themoltnet/sdk test --run __tests__/sign-bytes.test.ts',
      ),
    ).toBe('pnpm --filter @themoltnet/sdk test __tests__/sign-bytes.test.ts');
  });

  it('removes --reporter=verbose', () => {
    expect(
      normalizeTestCommand(
        'pnpm --filter @moltnet/crypto-service run test --reporter=verbose',
      ),
    ).toBe('pnpm --filter @moltnet/crypto-service run test');
  });

  it('prefixes Go test commands with cd when missing', () => {
    expect(normalizeTestCommand('go test ./cmd/moltnet/ -run TestSign')).toBe(
      'cd cmd/moltnet && go test . -run TestSign',
    );
  });

  it('leaves Go test commands with cd prefix untouched', () => {
    const goCmd = 'cd cmd/moltnet && go test -run TestSign ./...';
    expect(normalizeTestCommand(goCmd)).toBe(goCmd);
  });

  it('rewrites duplicated Go package path after cd', () => {
    expect(
      normalizeTestCommand(
        'cd cmd/moltnet && go test ./cmd/moltnet/ -run TestParseGitDiffStat',
      ),
    ).toBe('cd cmd/moltnet && go test . -run TestParseGitDiffStat');
  });

  // ── Package name fixes ──

  it('fixes @themoltnet/ → @moltnet/ for internal packages', () => {
    expect(
      normalizeTestCommand(
        'pnpm --filter @themoltnet/rest-api test -- diary-distill',
      ),
    ).toBe('pnpm --filter @moltnet/rest-api test diary-distill');
  });

  it('fixes @themoltnet/landing → @moltnet/landing', () => {
    expect(normalizeTestCommand('pnpm --filter @themoltnet/landing test')).toBe(
      'pnpm --filter @moltnet/landing test',
    );
  });

  it('fixes legreffier-cli → @themoltnet/legreffier', () => {
    expect(
      normalizeTestCommand(
        'pnpm --filter legreffier-cli run test -- src/adapters/codex.test.ts',
      ),
    ).toBe(
      'pnpm --filter @themoltnet/legreffier run test src/adapters/codex.test.ts',
    );
  });

  it('fixes @moltnet/legreffier-cli → @themoltnet/legreffier', () => {
    expect(
      normalizeTestCommand(
        'pnpm --filter @moltnet/legreffier-cli run test -- src/api.test.ts',
      ),
    ).toBe('pnpm --filter @themoltnet/legreffier run test src/api.test.ts');
  });

  it('fixes bare package names by adding scope', () => {
    expect(
      normalizeTestCommand(
        'pnpm --filter rest-api test __tests__/config.test.ts',
      ),
    ).toBe('pnpm --filter @moltnet/rest-api test __tests__/config.test.ts');
  });

  // ── Shell pipe fix ──

  it('quotes test patterns containing shell pipe |', () => {
    expect(
      normalizeTestCommand(
        'pnpm --filter @moltnet/crypto-service run test pack-cid|provenance-lifecycle',
      ),
    ).toBe(
      "pnpm --filter @moltnet/crypto-service run test 'pack-cid|provenance-lifecycle'",
    );
  });

  // ── packages/ prefix strip ──

  it('strips packages/ path prefix from test file paths', () => {
    expect(
      normalizeTestCommand(
        'pnpm --filter @themoltnet/legreffier test packages/legreffier-cli/src/setup.test.ts',
      ),
    ).toBe('pnpm --filter @themoltnet/legreffier test src/setup.test.ts');
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

describe('extractTouchedTestNames', () => {
  it('captures newly added test declarations', () => {
    const diff = `
@@
+it('adds signingInput to response', () => {
+  expect(body.signingInput).toBeDefined();
+});
`;
    expect(extractTouchedTestNames(diff)).toEqual([
      'adds signingInput to response',
    ]);
  });

  it('captures existing test blocks touched by added assertions', () => {
    const diff = `
@@
 it('returns 200 with compile result', async () => {
   expect(response.statusCode).toBe(200);
+  expect(response.json()).toHaveProperty('packCid');
   expect(response.json()).toHaveProperty('entries');
 });
`;
    expect(extractTouchedTestNames(diff)).toEqual([
      'returns 200 with compile result',
    ]);
  });
});
