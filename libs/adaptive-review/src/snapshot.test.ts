import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canonicalJson } from '@moltnet/crypto-service';
import { createGit } from '@moltnet/docs-impact-review';
import { describe, expect, it } from 'vitest';

import { changedPaths, loadAdaptivePolicy } from './snapshot.js';

const base = 'a'.repeat(40);
const head = 'b'.repeat(40);
const testsOnly = JSON.stringify({
  version: 1,
  lanes: ['tests'],
  rules: [],
  checks: [],
});

function gitWithPolicy(raw: string | null) {
  return (args: string[]): string => {
    if (args[0] === 'ls-tree')
      return raw === null ? '' : '.github/adaptive-review.json';
    if (args[0] === 'show') return raw ?? '';
    throw new Error(`unexpected git command: ${args[0]}`);
  };
}

describe('pinned adaptive policy snapshot', () => {
  it('treats absent policy as opt-out and never consults PR head', () => {
    expect(loadAdaptivePolicy(gitWithPolicy(null), base)).toBeNull();
    const seen: string[][] = [];
    const git = (args: string[]) => {
      seen.push(args);
      return gitWithPolicy(testsOnly)(args);
    };
    const snapshot = loadAdaptivePolicy(git, base);
    expect(snapshot?.policy.lanes).toEqual(['tests']);
    expect(snapshot?.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(
      seen.every(
        (args) =>
          args.includes(base) || args.some((arg) => arg.startsWith(`${base}:`)),
      ),
    ).toBe(true);
    expect(seen.flat().join(' ')).not.toContain(head);
  });

  it('fails malformed policy instead of treating it as opt-out', () => {
    expect(() => loadAdaptivePolicy(gitWithPolicy('{'), base)).toThrow(
      'invalid JSON',
    );
    expect(() =>
      loadAdaptivePolicy(
        gitWithPolicy(
          '{"version":1,"lanes":["unknown"],"rules":[],"checks":[]}',
        ),
        base,
      ),
    ).toThrow('schema');
  });

  it('digests the validated policy with the shared canonical JSON contract', () => {
    const raw = '{"checks":[],"rules":[],"lanes":["tests"],"version":1}';
    const snapshot = loadAdaptivePolicy(gitWithPolicy(raw), base);
    const expected = createHash('sha256')
      .update(canonicalJson(snapshot?.policy))
      .digest('hex');

    expect(snapshot?.digest).toBe(expected);
    expect(snapshot?.digest).toBe(
      loadAdaptivePolicy(gitWithPolicy(testsOnly), base)?.digest,
    );
  });

  it('records renamed and deleted files independently of patch retention', () => {
    const git = (args: string[]) => {
      expect(args).toContain(`${base}...${head}`);
      return 'R100\0old/src/file.ts\0new/src/file.ts\0D\0migrations/old.sql\0';
    };
    expect(changedPaths(git, base, head)).toEqual([
      {
        status: 'renamed',
        previousPath: 'old/src/file.ts',
        path: 'new/src/file.ts',
      },
      { status: 'deleted', path: 'migrations/old.sql' },
    ]);
  });

  it('reads another repository policy and renamed changes from real Git objects', () => {
    const root = mkdtempSync(join(tmpdir(), 'adaptive-foreign-repo-'));
    const git = (args: string[]) =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    try {
      git(['init', '-q']);
      git(['config', 'user.name', 'Test']);
      git(['config', 'user.email', 'test@example.invalid']);
      mkdirSync(join(root, '.github'));
      mkdirSync(join(root, 'src', 'domain'), { recursive: true });
      writeFileSync(
        join(root, '.github', 'adaptive-review.json'),
        JSON.stringify({
          version: 1,
          lanes: ['tests', 'conventions'],
          rules: [
            {
              id: 'domain-tests',
              description: 'Keep domain behavior covered by tests.',
              kind: 'semantic',
              paths: ['src/domain/**'],
              source: 'CONTRIBUTING.md',
            },
          ],
          checks: [],
        }),
      );
      writeFileSync(
        join(root, 'src', 'domain', 'old.ts'),
        'export const n = 1;\n',
      );
      git(['add', '.']);
      git(['commit', '-qm', 'base']);
      const fixtureBase = git(['rev-parse', 'HEAD']);
      git(['mv', 'src/domain/old.ts', 'src/domain/new.ts']);
      git(['commit', '-qam', 'rename']);
      const fixtureHead = git(['rev-parse', 'HEAD']);

      const snapshot = loadAdaptivePolicy(createGit(root), fixtureBase);
      expect(snapshot?.policy.rules[0].id).toBe('domain-tests');
      expect(changedPaths(createGit(root), fixtureBase, fixtureHead)).toEqual([
        {
          status: 'renamed',
          previousPath: 'src/domain/old.ts',
          path: 'src/domain/new.ts',
        },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
