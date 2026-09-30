import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computeLock, staleLocks } from './action-runtime-lock.js';

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
