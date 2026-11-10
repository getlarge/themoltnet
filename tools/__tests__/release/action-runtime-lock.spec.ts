import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  computeLock,
  locksForProject,
  RUNTIME_LOCKS,
  stageLocks,
  staleLocks,
} from '../../src/release/action-runtime-lock.js';

describe('action runtime locks', () => {
  let root: string;
  const spec = {
    lock: 'pkg/runtime.lock',
    pathspecs: [
      'workflow.yml',
      ':(glob)dep/src/**',
      ':(exclude,glob)dep/src/**/*.test.ts',
    ],
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'runtime-lock-'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    mkdirSync(join(root, 'dep/src'), { recursive: true });
    mkdirSync(join(root, 'pkg'));
    writeFileSync(join(root, 'workflow.yml'), 'on: workflow_call\n');
    writeFileSync(join(root, 'dep/src/main.ts'), 'export {};\n');
    writeFileSync(join(root, 'dep/src/main.test.ts'), 'test\n');
    execFileSync('git', ['add', '-A'], { cwd: root });
    writeFileSync(join(root, spec.lock), computeLock(root, spec));
    execFileSync('git', ['add', spec.lock], { cwd: root });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('is current until a covered file changes', () => {
    // Act / Assert
    expect(staleLocks(root, [spec])).toEqual([]);
    writeFileSync(join(root, 'workflow.yml'), 'on: push\n');
    expect(staleLocks(root, [spec])).toEqual([spec.lock]);
  });

  it('ignores excluded files and untracked ones, and notices staged ones', () => {
    // Act / Assert
    writeFileSync(join(root, 'dep/src/main.test.ts'), 'changed\n');
    expect(staleLocks(root, [spec])).toEqual([]);
    writeFileSync(join(root, 'dep/src/extra.ts'), 'export {};\n');
    expect(staleLocks(root, [spec])).toEqual([]);
    execFileSync('git', ['add', 'dep/src/extra.ts'], { cwd: root });
    expect(staleLocks(root, [spec])).toEqual([spec.lock]);
  });

  it('checks only the selected component while the repository-wide check remains strict', () => {
    const script = new URL(
      '../../src/release/action-runtime-lock.ts',
      import.meta.url,
    ).pathname;
    // This old source has no adaptive-review lock; daemon publication owns none.
    expect(
      spawnSync(
        'node',
        [script, '--check', '--project-root', 'packages/agent-daemon-action'],
        { cwd: root },
      ).status,
    ).toBe(0);
    expect(
      spawnSync(
        'node',
        [
          script,
          '--check',
          '--project-root',
          'packages/adaptive-review-action',
        ],
        { cwd: root },
      ).status,
    ).toBe(1);
    expect(spawnSync('node', [script, '--check'], { cwd: root }).status).toBe(
      1,
    );
  });

  it('lists hashes by path', () => {
    // Act
    const lock = computeLock(root, spec);

    // Assert
    expect(lock).toMatch(/^[0-9a-f]{64} {2}dep\/src\/main\.ts$/m);
    expect(lock).not.toContain('main.test.ts');
  });

  it('stages hashes of the index while preserving partially staged source edits', () => {
    writeFileSync(join(root, 'workflow.yml'), 'on: push\n');
    execFileSync('git', ['add', 'workflow.yml'], { cwd: root });
    const expected = computeLock(root, spec);
    writeFileSync(join(root, 'workflow.yml'), 'on: pull_request\n');

    expect(stageLocks(root, [spec])).toEqual([spec.lock]);
    expect(
      execFileSync('git', ['show', `:${spec.lock}`], {
        cwd: root,
        encoding: 'utf8',
      }),
    ).toBe(expected);
    expect(readFileSync(join(root, 'workflow.yml'), 'utf8')).toBe(
      'on: pull_request\n',
    );
    expect(stageLocks(root, [spec])).toEqual([]);
  });

  it('includes staged additions and deletions but ignores untracked inputs', () => {
    writeFileSync(join(root, 'dep/src/new.ts'), 'export const added = 1;\n');
    writeFileSync(join(root, 'dep/src/local.ts'), 'local only\n');
    execFileSync('git', ['add', 'dep/src/new.ts'], { cwd: root });
    execFileSync('git', ['rm', '--cached', '-f', 'dep/src/main.ts'], {
      cwd: root,
    });

    stageLocks(root, [spec]);

    const lock = readFileSync(join(root, spec.lock), 'utf8');
    expect(lock).toContain('dep/src/new.ts');
    expect(lock).not.toContain('dep/src/main.ts');
    expect(lock).not.toContain('dep/src/local.ts');
    expect(lock).not.toContain('main.test.ts');
  });

  it('does not overwrite unstaged lock edits or stage other files', () => {
    writeFileSync(join(root, 'workflow.yml'), 'on: push\n');
    execFileSync('git', ['add', 'workflow.yml'], { cwd: root });
    writeFileSync(join(root, spec.lock), 'local lock edits\n');
    const indexBefore = execFileSync('git', ['write-tree'], { cwd: root });

    expect(() => stageLocks(root, [spec])).toThrow('has unstaged changes');
    expect(readFileSync(join(root, spec.lock), 'utf8')).toBe(
      'local lock edits\n',
    );
    expect(execFileSync('git', ['write-tree'], { cwd: root })).toEqual(
      indexBefore,
    );
  });

  it('ignores unstaged source edits when the indexed lock is already current', () => {
    writeFileSync(join(root, 'workflow.yml'), 'on: push\n');
    expect(stageLocks(root, [spec])).toEqual([]);
  });

  it('runs the commit hook refresh after formatting and restoring unstaged edits', () => {
    mkdirSync(join(root, 'tools/src/release'), { recursive: true });
    mkdirSync(join(root, 'node_modules/.bin'), { recursive: true });
    mkdirSync(join(root, 'packages/agent-daemon-action'), { recursive: true });
    mkdirSync(join(root, 'packages/adaptive-review-action'), {
      recursive: true,
    });
    copyFileSync(
      new URL('../../src/release/action-runtime-lock.ts', import.meta.url),
      join(root, 'tools/src/release/action-runtime-lock.ts'),
    );
    writeFileSync(
      join(root, 'node_modules/.bin/lint-staged'),
      '#!/bin/sh\nset -eu\nprintf "formatted\\n" > packages/agent-daemon-action/action.yml\ngit add packages/agent-daemon-action/action.yml\nprintf "unstaged\\n" > packages/agent-daemon-action/action.yml\n',
      { mode: 0o755 },
    );
    const hook = new URL('../../../.husky/pre-commit', import.meta.url)
      .pathname;

    execFileSync('sh', [hook], { cwd: root });

    const [adaptive] = RUNTIME_LOCKS;
    expect(
      execFileSync('git', ['show', `:${adaptive.lock}`], {
        cwd: root,
        encoding: 'utf8',
      }),
    ).toBe(computeLock(root, adaptive, true));
    expect(
      readFileSync(
        join(root, 'packages/agent-daemon-action/action.yml'),
        'utf8',
      ),
    ).toBe('unstaged\n');
  });
});

describe('released action runtime inputs', () => {
  it('locks what the adaptive review runs from outside its package', () => {
    const [adaptive] = RUNTIME_LOCKS;
    expect(adaptive.lock).toBe('packages/adaptive-review-action/runtime.lock');
    expect(adaptive.pathspecs).toEqual(
      expect.arrayContaining([
        '.github/workflows/adaptive-review-reusable.yml',
        'libs/adaptive-review/src',
        ':(exclude,glob)**/*.spec.ts',
      ]),
    );
  });

  it('excludes test files and only the .spec convention', () => {
    const [adaptive] = RUNTIME_LOCKS;
    expect(adaptive.pathspecs).toContain(':(exclude,glob)**/*.spec.ts');
    expect(adaptive.pathspecs).not.toContain(':(exclude,glob)**/*.test.ts');
  });

  it("selects only the publishing project's locks", () => {
    const locks = [
      { lock: 'packages/a-action/runtime.lock', pathspecs: ['x'] },
      { lock: 'packages/a-action-extra/runtime.lock', pathspecs: ['y'] },
    ];
    expect(locksForProject('packages/a-action', locks)).toEqual([locks[0]]);
    expect(locksForProject('packages/a-action/', locks)).toEqual([locks[0]]);
    expect(locksForProject('packages/b-action', locks)).toEqual([]);
  });

  it('never locks generated bundles', () => {
    for (const lock of RUNTIME_LOCKS) {
      expect(lock.pathspecs.some((path) => path.includes('/dist'))).toBe(false);
    }
  });
});
