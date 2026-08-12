import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  const root = mkdtempSync(join(tmpdir(), 'moltnet-review-workspace-'));
  roots.push(root);
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Test']);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', root, 'config', 'commit.gpgsign', 'false']);
  writeFileSync(join(root, 'file.txt'), 'first\n');
  execFileSync('git', ['-C', root, 'add', 'file.txt']);
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
