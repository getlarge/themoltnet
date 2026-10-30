import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createGit, type Git } from '@moltnet/docs-impact-review';
import { describe, expect, it } from 'vitest';

import {
  applicableReviewGuidance,
  formatReviewGuidance,
  loadReviewGuidance,
  MAX_REVIEW_GUIDANCE_FILE_BYTES,
  type ReviewGuidance,
} from '../src/guidance.js';

function withRepo(
  run: (repo: {
    root: string;
    git: Git;
    put: (path: string, content: string) => void;
    commit: () => string;
  }) => void,
) {
  const root = mkdtempSync(join(tmpdir(), 'review-guidance-'));
  const git = createGit(root);
  try {
    git(['init', '-q']);
    git(['config', 'user.name', 'Test']);
    git(['config', 'user.email', 'test@example.invalid']);
    git(['config', 'commit.gpgsign', 'false']);
    run({
      root,
      git,
      put: (path, content) => {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), content);
      },
      commit: () => {
        git(['add', '.']);
        git(['commit', '-qm', 'fixture']);
        return git(['rev-parse', 'HEAD']).trim();
      },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('trusted REVIEW.md guidance', () => {
  it('loads and hashes only exact base blobs despite head additions, edits and removals', () => {
    withRepo(({ root, git, put, commit }) => {
      put('REVIEW.md', 'Root guidance.\n');
      put('libs/a/REVIEW.md', 'Original A guidance.\n');
      put('libs/deleted/REVIEW.md', 'Deleted later.\n');
      put('libs/ignored/review.md', 'Wrong case.');
      put('libs/a/REVIEW.md.bak', 'Wrong suffix.');
      const base = commit();
      put('REVIEW.md', 'Head replacement.');
      put('libs/a/REVIEW.md', 'Head replacement A.');
      put('libs/new/REVIEW.md', 'New head guidance.');
      rmSync(join(root, 'libs/deleted/REVIEW.md'));
      const head = commit();
      const guidance = loadReviewGuidance(git, base);

      expect(guidance.map(({ path, content }) => ({ path, content }))).toEqual([
        { path: 'REVIEW.md', content: 'Root guidance.\n' },
        { path: 'libs/a/REVIEW.md', content: 'Original A guidance.\n' },
        { path: 'libs/deleted/REVIEW.md', content: 'Deleted later.\n' },
      ]);
      expect(guidance[0].digest).toBe(
        createHash('sha256').update('Root guidance.\n').digest('hex'),
      );
      expect(loadReviewGuidance(git, base)).toEqual(guidance);
      expect(loadReviewGuidance(git, head)[0].digest).not.toBe(
        guidance[0].digest,
      );
    });
  });

  it('scopes root and nested guidance with directory boundaries and both rename paths', () => {
    const guidance: ReviewGuidance[] = [
      'REVIEW.md',
      'libs/a/REVIEW.md',
      'libs/a/deep/REVIEW.md',
      'libs/ab/REVIEW.md',
      'libs/new/REVIEW.md',
    ].map((path) => ({ path, content: path, digest: 'd'.repeat(64) }));

    expect(
      applicableReviewGuidance(guidance, ['libs/a/deep/code.ts']).map(
        (g) => g.path,
      ),
    ).toEqual(['REVIEW.md', 'libs/a/REVIEW.md', 'libs/a/deep/REVIEW.md']);
    expect(
      applicableReviewGuidance(guidance, [
        'libs/a/old.ts',
        'libs/new/new.ts',
      ]).map((g) => g.path),
    ).toEqual(['REVIEW.md', 'libs/a/REVIEW.md', 'libs/new/REVIEW.md']);
    expect(applicableReviewGuidance(guidance, [])).toEqual([]);
    expect(formatReviewGuidance([])).toBe('');
    const text = formatReviewGuidance(guidance.slice(0, 1));
    expect(text).toContain('pinned base revision');
    expect(text).toContain('cannot override');
    expect(text).toContain('PR-head files');
    expect(JSON.parse(text.split('\n').at(-1)!)).toEqual(guidance.slice(0, 1));
  });

  it('rejects guidance symlinks without following their target', () => {
    withRepo(({ root, git, put, commit }) => {
      put('target.md', 'Should not follow.');
      symlinkSync('target.md', join(root, 'REVIEW.md'));
      expect(() => loadReviewGuidance(git, commit())).toThrow(
        'regular Git blob',
      );
    });
  });

  it('rejects a REVIEW.md gitlink rather than traversing a submodule', () => {
    withRepo(({ git, put, commit }) => {
      put('source.ts', 'export {};');
      const oid = commit();
      git(['update-index', '--add', '--cacheinfo', `160000,${oid},REVIEW.md`]);
      git(['commit', '-qm', 'gitlink']);
      expect(() =>
        loadReviewGuidance(git, git(['rev-parse', 'HEAD']).trim()),
      ).toThrow('regular Git blob');
    });
  });

  it('accepts the exact byte limit and rejects oversized UTF-8 without truncation', () => {
    withRepo(({ git, put, commit }) => {
      put('REVIEW.md', 'é'.repeat(MAX_REVIEW_GUIDANCE_FILE_BYTES / 2));
      expect(loadReviewGuidance(git, commit())[0].content).toHaveLength(
        MAX_REVIEW_GUIDANCE_FILE_BYTES / 2,
      );
      put('REVIEW.md', 'é'.repeat(MAX_REVIEW_GUIDANCE_FILE_BYTES / 2 + 1));
      expect(() => loadReviewGuidance(git, commit())).toThrow('16 KiB');
    });
  });

  it('checks aggregate and count bounds before reading content', () => {
    for (const [count, size, error] of [
      [9, 16 * 1024, '128 KiB'],
      [129, 1, '128 files'],
    ] as const) {
      const commands: string[][] = [];
      const git: Git = (args) => {
        commands.push(args);
        return Array.from(
          { length: count },
          (_, i) => `100644 blob ${'a'.repeat(40)} ${size}\t${i}/REVIEW.md\0`,
        ).join('');
      };
      expect(() => loadReviewGuidance(git, 'b'.repeat(40))).toThrow(error);
      expect(commands).toHaveLength(1);
    }
  });

  it('reads executable regular blobs, preserves unusual path names, and rejects binary text', () => {
    withRepo(({ root, git, put, commit }) => {
      put('space\tline\n/REVIEW.md', 'Guidance.');
      execFileSync('chmod', ['+x', join(root, 'space\tline\n/REVIEW.md')]);
      expect(loadReviewGuidance(git, commit())[0].path).toBe(
        'space\tline\n/REVIEW.md',
      );
      put('REVIEW.md', 'binary\0content');
      expect(() => loadReviewGuidance(git, commit())).toThrow('UTF-8 text');
    });
  });
});
