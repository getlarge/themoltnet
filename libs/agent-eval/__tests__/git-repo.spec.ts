import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildGitFixtureRepo } from '../src/git-repo.js';

function writeTree(root: string, files: Record<string, string>): string {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function git(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
  }).trim();
}

describe('buildGitFixtureRepo', () => {
  let scratch: string;
  let base: string;
  let head: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'agent-eval-git-'));
    base = writeTree(join(scratch, 'base'), {
      'README.md': 'base\n',
      'src/removed.ts': 'export const removed = 1;\n',
    });
    head = writeTree(join(scratch, 'head'), {
      'README.md': 'head\n',
      'src/added.ts': 'export const added = 2;\n',
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(scratch, { recursive: true, force: true });
  });

  it('commits each tree verbatim and returns stable commit ids', () => {
    // Arrange
    const first = join(scratch, 'repo-a');
    const second = join(scratch, 'repo-b');
    const commits = [
      { tree: base, message: 'base' },
      { tree: head, message: 'head' },
    ];

    // Act
    const oidsA = buildGitFixtureRepo({ root: first, commits });
    const oidsB = buildGitFixtureRepo({ root: second, commits });

    // Assert — fixed identity and dates pin the ids across machines.
    expect(oidsA).toEqual(oidsB);
    expect(oidsA).toEqual([
      '99ede4972a96bb8810ce9a41e0b575ed9a0de310',
      '8ceee4ed94d58159820e641dd25d04931053c5cf',
    ]);
    expect(git(first, ['ls-tree', '-r', '--name-only', oidsA[0]])).toBe(
      'README.md\nsrc/removed.ts',
    );
    expect(git(first, ['ls-tree', '-r', '--name-only', oidsA[1]])).toBe(
      'README.md\nsrc/added.ts',
    );
    expect(git(first, ['rev-parse', `${oidsA[1]}^`])).toBe(oidsA[0]);
    expect(git(first, ['log', '-1', '--format=%an <%ae> %G?'])).toBe(
      'MoltNet Eval Fixture <eval-fixture@themolt.net> N',
    );
  });

  it('records the executable bit of tree files', () => {
    // Arrange
    chmodSync(join(head, 'src/added.ts'), 0o755);
    const root = join(scratch, 'repo');

    // Act
    const [, headOid] = buildGitFixtureRepo({
      root,
      commits: [
        { tree: base, message: 'base' },
        { tree: head, message: 'head' },
      ],
    });

    // Assert
    expect(git(root, ['ls-tree', headOid, 'src/added.ts'])).toMatch(/^100755 /);
  });

  it('checks out the requested commit and keeps later ones on extra branches', () => {
    // Arrange
    const root = join(scratch, 'repo');

    // Act
    const [baseOid, headOid] = buildGitFixtureRepo({
      root,
      commits: [
        { tree: base, message: 'base' },
        { tree: head, message: 'head' },
      ],
      checkoutIndex: 0,
      extraBranches: { 'pr-head': 1 },
    });

    // Assert
    expect(git(root, ['rev-parse', 'HEAD'])).toBe(baseOid);
    expect(git(root, ['rev-parse', 'main'])).toBe(baseOid);
    expect(git(root, ['rev-parse', 'pr-head'])).toBe(headOid);
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe('base\n');
    expect(existsSync(join(root, 'src/added.ts'))).toBe(false);
    expect(git(root, ['status', '--porcelain'])).toBe('');
  });

  it('commits files a fixture .gitignore would otherwise drop', () => {
    // Arrange
    writeTree(head, { '.gitignore': '*.log\n', 'debug.log': 'kept\n' });
    const root = join(scratch, 'repo');

    // Act
    const [, headOid] = buildGitFixtureRepo({
      root,
      commits: [
        { tree: base, message: 'base' },
        { tree: head, message: 'head' },
      ],
    });

    // Assert
    expect(git(root, ['ls-tree', '--name-only', headOid])).toContain(
      'debug.log',
    );
  });

  it('ignores inherited GIT_* overrides from the calling process', () => {
    // Arrange — e.g. a git hook running the suite exports GIT_DIR.
    const decoy = join(scratch, 'decoy');
    mkdirSync(decoy);
    vi.stubEnv('GIT_DIR', decoy);
    vi.stubEnv('GIT_AUTHOR_NAME', 'Someone Else');
    const root = join(scratch, 'repo');

    // Act
    buildGitFixtureRepo({ root, commits: [{ tree: base, message: 'base' }] });

    // Assert
    vi.unstubAllEnvs();
    expect(existsSync(join(root, '.git'))).toBe(true);
    expect(git(root, ['log', '-1', '--format=%an'])).toBe(
      'MoltNet Eval Fixture',
    );
  });

  it('rejects a non-empty root and an empty commit', () => {
    // Arrange
    const occupied = writeTree(join(scratch, 'occupied'), { x: 'x' });

    // Act / Assert
    expect(() =>
      buildGitFixtureRepo({
        root: occupied,
        commits: [{ tree: base, message: 'base' }],
      }),
    ).toThrow(/must be empty/);
    expect(() =>
      buildGitFixtureRepo({
        root: join(scratch, 'repo'),
        commits: [
          { tree: base, message: 'base' },
          { tree: base, message: 'same' },
        ],
      }),
    ).toThrow(/git commit .* failed/);
  });
});
