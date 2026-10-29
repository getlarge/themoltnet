import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ClaimedTask } from '@themoltnet/agent-runtime';
import { afterEach, describe, expect, it } from 'vitest';

import type { PiTaskExecutionPlan } from './execution-plan.js';
import { prepareTaskWorkspace } from './task-workspace.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function repository(): { root: string; first: string; second: string } {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), 'moltnet-review-workspace-')),
  );
  roots.push(root);
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Test']);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', root, 'config', 'commit.gpgsign', 'false']);
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, '..config'));
  writeFileSync(join(root, 'src', 'file.txt'), 'pinned source\n');
  writeFileSync(join(root, '..config', 'file.txt'), 'pinned config\n');
  writeFileSync(join(root, 'file.txt'), 'first\n');
  execFileSync('git', ['-C', root, 'add', 'file.txt', 'src', '..config']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'first']);
  const first = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  writeFileSync(join(root, 'file.txt'), 'second\n');
  execFileSync('git', ['-C', root, 'commit', '-am', 'second']);
  const second = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  return { root, first, second };
}

function task(): ClaimedTask['task'] {
  return {
    id: '11111111-1111-4111-8111-111111111111',
  } as ClaimedTask['task'];
}

function plan(
  workspaceMode: PiTaskExecutionPlan['workspaceMode'],
  revision: string,
): PiTaskExecutionPlan {
  return {
    workspaceMode,
    workspaceRevision: revision,
    sessionKey: null,
    workspaceId:
      workspaceMode === 'dedicated_worktree' ? 'revision-test' : null,
    worktreeBranch: null,
    workspaceScope: 'attempt',
  };
}

describe('exact-revision task workspaces', () => {
  it('fails a shared mount before model execution when HEAD drifted', () => {
    const repo = repository();

    expect(() =>
      prepareTaskWorkspace(task(), repo.root, plan('shared_mount', repo.first)),
    ).toThrow(
      `Shared workspace is at ${repo.second}, but task requires ${repo.first}`,
    );
  });

  it('fails an exact-revision workspace when tracked bytes are dirty', () => {
    const repo = repository();
    writeFileSync(join(repo.root, 'file.txt'), 'locally modified\n');

    expect(() =>
      prepareTaskWorkspace(
        task(),
        repo.root,
        plan('shared_mount', repo.second),
      ),
    ).toThrow(/modified, staged, or untracked files/);
  });

  it('fails an exact-revision workspace when untracked files are present', () => {
    const repo = repository();
    writeFileSync(join(repo.root, 'untracked.txt'), 'not in the revision\n');

    expect(() =>
      prepareTaskWorkspace(
        task(),
        repo.root,
        plan('shared_mount', repo.second),
      ),
    ).toThrow(/modified, staged, or untracked files/);
  });

  it('creates and cleans a detached dedicated worktree at the required commit', () => {
    const repo = repository();
    const workspace = prepareTaskWorkspace(
      task(),
      repo.root,
      plan('dedicated_worktree', repo.first),
    );

    expect(workspace.mode).toBe('dedicated_worktree');
    expect(workspace.revision).toBe(repo.first);
    expect(
      execFileSync('git', ['-C', workspace.cwdPath, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
    ).toBe(repo.first);
    expect(
      execFileSync(
        'git',
        ['-C', workspace.cwdPath, 'rev-parse', '--abbrev-ref', 'HEAD'],
        { encoding: 'utf8' },
      ).trim(),
    ).toBe('HEAD');

    workspace.cleanup();
    expect(() =>
      execFileSync('git', ['-C', workspace.cwdPath, 'rev-parse', 'HEAD']),
    ).toThrow();
  });
});

describe('resuming a task workspace', () => {
  it('keeps the agent edits in a seeded scratch workspace', () => {
    const { root } = repository();
    const scratchPlan: PiTaskExecutionPlan = {
      ...plan('scratch_mount', ''),
      workspaceRevision: null,
      workspaceSeed: { copyFromPath: root, source: 'producer' },
    };
    const first = prepareTaskWorkspace(task(), root, scratchPlan);
    writeFileSync(join(first.cwdPath, 'file.txt'), 'agent edit\n');

    const resumed = prepareTaskWorkspace(task(), root, scratchPlan, {
      reuseExisting: true,
    });

    expect(resumed.cwdPath).toBe(first.cwdPath);
    expect(readFileSync(join(resumed.cwdPath, 'file.txt'), 'utf8')).toBe(
      'agent edit\n',
    );
  });

  it('fails when the scratch workspace is gone', () => {
    const { root } = repository();
    const scratchPlan: PiTaskExecutionPlan = {
      ...plan('scratch_mount', ''),
      workspaceRevision: null,
    };
    expect(() =>
      prepareTaskWorkspace(task(), root, scratchPlan, { reuseExisting: true }),
    ).toThrow('Scratch workspace is missing');
  });

  it('accepts a shared mount whose HEAD moved after the first run', () => {
    const { root, first } = repository();
    expect(() =>
      prepareTaskWorkspace(task(), root, plan('shared_mount', first), {
        reuseExisting: true,
      }),
    ).not.toThrow();
  });

  it('fails when the dedicated worktree is gone', () => {
    const { root, second } = repository();
    expect(() =>
      prepareTaskWorkspace(task(), root, plan('dedicated_worktree', second), {
        reuseExisting: true,
      }),
    ).toThrow('Task worktree is missing');
  });
});

describe('dedicated workspace source checkout paths', () => {
  it.each([
    ['main', ''],
    ['main', 'src'],
    ['nested', ''],
    ['nested', 'src'],
    ['sibling', ''],
    ['sibling', 'src'],
    ['nested', '..config'],
  ])(
    'preserves the subdirectory for a %s checkout at %s',
    (location, subdir) => {
      const repo = repository();
      let sourceRoot = repo.root;
      if (location !== 'main') {
        sourceRoot =
          location === 'nested'
            ? join(repo.root, '.worktrees', 'source')
            : `${repo.root}-source`;
        if (location === 'sibling') roots.push(sourceRoot);
        execFileSync(
          'git',
          [
            '-C',
            repo.root,
            'worktree',
            'add',
            '--detach',
            sourceRoot,
            repo.second,
          ],
          { stdio: 'pipe' },
        );
      }
      const requestedPath = join(sourceRoot, subdir);
      writeFileSync(join(requestedPath, 'file.txt'), 'source-only edits\n');
      const executionPlan = plan('dedicated_worktree', repo.first);
      const workspace = prepareTaskWorkspace(
        task(),
        requestedPath,
        executionPlan,
      );
      const taskRoot = join(repo.root, '.worktrees', 'revision-test');

      expect(workspace.cwdPath).toBe(join(taskRoot, subdir));
      expect(workspace.mountPath).toBe(repo.root);
      expect(
        execFileSync('git', ['-C', workspace.cwdPath, 'rev-parse', 'HEAD'], {
          encoding: 'utf8',
        }).trim(),
      ).toBe(repo.first);
      expect(readFileSync(join(workspace.cwdPath, 'file.txt'), 'utf8')).toBe(
        subdir === 'src'
          ? 'pinned source\n'
          : subdir === '..config'
            ? 'pinned config\n'
            : 'first\n',
      );
      expect(
        prepareTaskWorkspace(task(), requestedPath, executionPlan, {
          reuseExisting: true,
        }).cwdPath,
      ).toBe(workspace.cwdPath);
      workspace.cleanup();
      expect(readFileSync(join(requestedPath, 'file.txt'), 'utf8')).toBe(
        'source-only edits\n',
      );
    },
  );

  it('resolves a symlinked source directory within its checkout', () => {
    const repo = repository();
    const alias = `${repo.root}-alias`;
    roots.push(alias);
    symlinkSync(join(repo.root, 'src'), alias);
    const workspace = prepareTaskWorkspace(
      task(),
      alias,
      plan('dedicated_worktree', repo.first),
    );
    expect(workspace.cwdPath).toBe(
      join(repo.root, '.worktrees', 'revision-test', 'src'),
    );
    workspace.cleanup();
  });

  it('fails for a non-repository source without falling back to the shared checkout', () => {
    const source = mkdtempSync(join(tmpdir(), 'moltnet-non-repository-'));
    roots.push(source);
    expect(() =>
      prepareTaskWorkspace(
        task(),
        source,
        plan('dedicated_worktree', 'a'.repeat(40)),
      ),
    ).toThrow('Dedicated worktree tasks require a git repository');
  });
});
