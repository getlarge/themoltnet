import { describe, expect, it } from 'vitest';

import {
  changedLines,
  isRoutineDependencyUpdate,
  renderComment,
  validateCandidates,
  validateResult,
} from './review.js';

const diff = [
  'diff --git a/src/repair.ts b/src/repair.ts',
  '--- a/src/repair.ts',
  '+++ b/src/repair.ts',
  '@@ -10,4 +10,5 @@',
  ' context',
  '-old',
  '+if (size > cap) return skipOneRepair();',
  '+return repairOtherPath();',
  ' end',
].join('\n');

const candidates = {
  summary: 'One guard needs a scope check.',
  findings: [
    {
      id: 'size-cap',
      path: 'src/repair.ts',
      side: 'new',
      line: 11,
      title: 'Size cap may skip repair',
      hypothesis: 'The cap may skip repairs.',
    },
  ],
};

describe('security review evidence boundary', () => {
  it('defers only dependency-only Renovate changes to existing automation', () => {
    expect(
      isRoutineDependencyUpdate('themoltnet-renovate[bot]', [
        'package.json',
        'pnpm-lock.yaml',
      ]),
    ).toBe(true);
    expect(
      isRoutineDependencyUpdate('themoltnet-renovate[bot]', [
        'package.json',
        'src/auth.ts',
      ]),
    ).toBe(false);
    expect(isRoutineDependencyUpdate('contributor', ['package.json'])).toBe(
      false,
    );
    expect(
      isRoutineDependencyUpdate('themoltnet-renovate[bot]', [
        'pnpm-workspace.yaml',
        'pnpm-lock.yaml',
      ]),
    ).toBe(true);
    expect(
      isRoutineDependencyUpdate('themoltnet-renovate[bot]', [
        'infra/otel/custom-collector/builder.yaml',
      ]),
    ).toBe(true);
    expect(
      isRoutineDependencyUpdate('themoltnet-renovate[bot]', [
        'apps/agent-desktop/src-tauri/Cargo.toml',
        'apps/agent-desktop/src-tauri/Cargo.lock',
      ]),
    ).toBe(true);
    expect(
      isRoutineDependencyUpdate('themoltnet-renovate[bot]', [
        '.github/workflows/renovate.yml',
      ]),
    ).toBe(false);
  });
  it('tracks added lines through context and deletions', () => {
    expect([...changedLines(diff).get('src/repair.ts')!.new]).toEqual([11, 12]);
    expect([...changedLines(diff).get('src/repair.ts')!.old]).toEqual([11]);
    expect(() =>
      validateCandidates(
        { ...candidates, findings: [{ ...candidates.findings[0], line: 10 }] },
        diff,
      ),
    ).toThrow('changed diff line');
    expect(
      validateCandidates(
        {
          ...candidates,
          findings: [{ ...candidates.findings[0], side: 'old', line: 11 }],
        },
        diff,
      ),
    ).toHaveLength(1);
  });

  it('accepts a deleted guard in a removed file as review evidence', () => {
    const removed = [
      'diff --git a/src/auth.ts b/src/auth.ts',
      '--- a/src/auth.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-requirePermission();',
      '-handleRequest();',
    ].join('\n');
    expect(
      validateCandidates(
        {
          summary: 'An authorization path was removed.',
          findings: [
            {
              id: 'removed-auth',
              path: 'src/auth.ts',
              side: 'old',
              line: 1,
              title: 'Removed guard',
              hypothesis: 'The replacement path may skip authorization.',
            },
          ],
        },
        removed,
      ),
    ).toHaveLength(1);
  });

  it('tracks changed lines in Git-quoted Unicode paths', () => {
    const quoted = [
      String.raw`diff --git "a/src/caf\303\251.ts" "b/src/caf\303\251.ts"`,
      String.raw`--- "a/src/caf\303\251.ts"`,
      String.raw`+++ "b/src/caf\303\251.ts"`,
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n');
    expect([...changedLines(quoted).get('src/café.ts')!.old]).toEqual([1]);
    expect([...changedLines(quoted).get('src/café.ts')!.new]).toEqual([1]);
  });

  it('does not treat added source text as a quoted patch header', () => {
    const forged = [
      'diff --git a/src/real.ts b/src/real.ts',
      '--- a/src/real.ts',
      '+++ b/src/real.ts',
      '@@ -0,0 +1,2 @@',
      String.raw`++ "b/src/caf\303\251.ts"`,
      '+actual change',
    ].join('\n');
    expect([...changedLines(forged).get('src/real.ts')!.new]).toEqual([1, 2]);
    expect(changedLines(forged).has('src/café.ts')).toBe(false);
  });

  it('keys old-side renamed lines by their old path', () => {
    const renamed = [
      'diff --git a/src/before.ts b/src/after.ts',
      'rename from src/before.ts',
      'rename to src/after.ts',
      '--- a/src/before.ts',
      '+++ b/src/after.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n');
    expect([...changedLines(renamed).get('src/before.ts')!.old]).toEqual([1]);
    expect([...changedLines(renamed).get('src/after.ts')!.new]).toEqual([1]);
    expect(changedLines(renamed).get('src/after.ts')!.old.size).toBe(0);
  });

  it('requires every suspicion to be verified and keeps uncertainty separate', () => {
    const source = validateCandidates(candidates, diff);
    const result = validateResult(
      {
        summary: 'The cap affects one repair path only.',
        findings: [
          {
            id: 'size-cap',
            status: 'refuted',
            severity: 'info',
            path: 'src/repair.ts',
            side: 'new',
            line: 11,
            title: 'Size cap',
            evidence: 'The return is scoped to skipOneRepair.',
            reachability: 'repairOtherPath remains reachable.',
            remediation: 'No change needed.',
          },
        ],
      },
      source,
      diff,
    );
    expect(result.findings[0].status).toBe('refuted');
    expect(
      renderComment(
        'a'.repeat(40),
        'b'.repeat(8) + '-bbbb-bbbb-bbbb-' + 'b'.repeat(12),
      ),
    ).toContain('team-scoped MoltNet task');
    expect(
      renderComment(
        'a'.repeat(40),
        'b'.repeat(8) + '-bbbb-bbbb-bbbb-' + 'b'.repeat(12),
      ),
    ).not.toContain('Size cap');
    expect(() =>
      validateResult({ summary: 'Missing', findings: [] }, source, diff),
    ).toThrow('every candidate');
  });
});
