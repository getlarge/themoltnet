import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  computeLock,
  locksForProject,
  RUNTIME_LOCKS,
  staleLocks,
} from './action-runtime-lock.js';

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

  it('lists hashes by path', () => {
    // Act
    const lock = computeLock(root, spec);

    // Assert
    expect(lock).toMatch(/^[0-9a-f]{64} {2}dep\/src\/main\.ts$/m);
    expect(lock).not.toContain('main.test.ts');
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
        ':(exclude,glob)**/*.test.ts',
      ]),
    );
  });

  it('excludes both test file conventions', () => {
    const [adaptive] = RUNTIME_LOCKS;
    expect(adaptive.pathspecs).toEqual(
      expect.arrayContaining([
        ':(exclude,glob)**/*.test.ts',
        ':(exclude,glob)**/*.spec.ts',
      ]),
    );
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
