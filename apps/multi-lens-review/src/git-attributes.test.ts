import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { generatedPathsFromBaseAttributes } from './git-attributes.js';

describe('generatedPathsFromBaseAttributes', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('uses only the trusted base attributes when the worktree changes them', () => {
    const root = mkdtempSync(join(tmpdir(), 'review-gitattributes-'));
    tempRoots.push(root);
    mkdirSync(join(root, 'generated'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(
      join(root, '.gitattributes'),
      'generated/** linguist-generated=true\n',
    );
    writeFileSync(join(root, 'generated', 'client.ts'), 'generated\n');
    writeFileSync(join(root, 'src', 'auth.ts'), 'authored\n');
    execFileSync('git', ['init'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: root,
    });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'base'], { cwd: root });
    const baseRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();

    writeFileSync(
      join(root, '.gitattributes'),
      'src/auth.ts linguist-generated=true\n',
    );
    const previousCwd = process.cwd();
    process.chdir(root);
    try {
      expect(
        generatedPathsFromBaseAttributes(
          ['generated/client.ts', 'src/auth.ts'],
          baseRevision,
        ),
      ).toEqual(new Set(['generated/client.ts']));
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('rejects a non-object-id base before invoking Git', () => {
    expect(() =>
      generatedPathsFromBaseAttributes(['src/auth.ts'], '--help'),
    ).toThrow(/40-hex object id/);
  });
});
