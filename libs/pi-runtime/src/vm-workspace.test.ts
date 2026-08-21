/**
 * Workspace topology tests: how pi-runtime's task workspace composes with the
 * Gondolin VM mount. They live here because they exercise
 * `prepareTaskWorkspace`, which belongs to the Pi runtime, against the sandbox
 * package below it.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { findMainWorktree } from '@themoltnet/sandbox-gondolin';
import { describe, expect, it } from 'vitest';

import { prepareTaskWorkspace } from './runtime/task-workspace.js';

describe('dedicated worktree mount topology', () => {
  function runGit(cwd: string, args: string[]): string {
    const output = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
    if (args[0] === 'init') {
      execFileSync('git', ['config', 'commit.gpgsign', 'false'], {
        cwd,
        stdio: 'pipe',
      });
    }
    return output;
  }

  it('discovers the main worktree from the requested mount path', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'pi-worktree-root-'));
    const nestedMount = path.join(repoRoot, 'apps', 'daemon');

    try {
      runGit(repoRoot, ['init']);
      mkdirSync(nestedMount, { recursive: true });

      expect(realpathSync(findMainWorktree(nestedMount))).toBe(
        realpathSync(repoRoot),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('keeps normal absolute git metadata when host and guest paths match', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'pi-worktree-repro-'));
    const oldCwd = process.cwd();
    let workspace: {
      mountPath: string;
      cwdPath: string;
      cleanup: () => void;
    } | null = null;

    try {
      runGit(repoRoot, ['init']);
      runGit(repoRoot, ['config', 'user.name', 'Test User']);
      runGit(repoRoot, ['config', 'user.email', 'test@example.com']);
      writeFileSync(path.join(repoRoot, 'README.md'), 'seed\n', 'utf8');
      runGit(repoRoot, ['add', 'README.md']);
      runGit(repoRoot, ['commit', '-m', 'seed']);

      process.chdir(repoRoot);
      const task = {
        id: 'task-1',
        taskType: 'fulfill_brief',
        correlationId: 'correlation-1',
        input: {
          brief: 'demo task',
          title: 'demo task',
        },
      } as unknown as Parameters<typeof prepareTaskWorkspace>[0];

      workspace = prepareTaskWorkspace(task, repoRoot, {
        workspaceMode: 'dedicated_worktree',
        sessionKey: 'slot-1',
        workspaceId: 'session-slot-1',
        worktreeBranch: 'moltnet/correlation-1/demo-task',
        workspaceScope: 'session',
      });

      const guestWorkspace = path.resolve(workspace.cwdPath);
      const gitdirPointer = readFileSync(path.join(guestWorkspace, '.git'), {
        encoding: 'utf8',
      }).trim();
      const resolvedGitdir = gitdirPointer.slice('gitdir: '.length);
      expect(realpathSync(resolvedGitdir)).toBe(
        realpathSync(
          path.join(repoRoot, '.git', 'worktrees', 'session-slot-1'),
        ),
      );
      const adminBacklink = readFileSync(
        path.join(resolvedGitdir, 'gitdir'),
        'utf8',
      ).trim();
      expect(adminBacklink).toBe(path.join(guestWorkspace, '.git'));
      expect(
        realpathSync(runGit(guestWorkspace, ['rev-parse', '--git-dir'])),
      ).toBe(realpathSync(resolvedGitdir));
      expect(
        realpathSync(runGit(guestWorkspace, ['rev-parse', '--show-toplevel'])),
      ).toBe(realpathSync(guestWorkspace));
    } finally {
      process.chdir(oldCwd);
      workspace?.cleanup();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('forks a new branch from the parent tip when worktreeBaseRef is set', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'pi-worktree-fork-'));
    const oldCwd = process.cwd();
    let workspace: {
      mountPath: string;
      cwdPath: string;
      cleanup: () => void;
    } | null = null;

    try {
      runGit(repoRoot, ['init', '-b', 'main']);
      runGit(repoRoot, ['config', 'user.name', 'Test User']);
      runGit(repoRoot, ['config', 'user.email', 'test@example.com']);
      writeFileSync(path.join(repoRoot, 'README.md'), 'seed\n', 'utf8');
      runGit(repoRoot, ['add', 'README.md']);
      runGit(repoRoot, ['commit', '-m', 'seed']);
      const mainTip = runGit(repoRoot, ['rev-parse', 'HEAD']);

      // A parent branch that has advanced one commit beyond main.
      runGit(repoRoot, ['branch', 'feat/parent']);
      runGit(repoRoot, ['checkout', 'feat/parent']);
      writeFileSync(path.join(repoRoot, 'PARENT.md'), 'parent work\n', 'utf8');
      runGit(repoRoot, ['add', 'PARENT.md']);
      runGit(repoRoot, ['commit', '-m', 'parent work']);
      const parentTip = runGit(repoRoot, ['rev-parse', 'feat/parent']);
      runGit(repoRoot, ['checkout', 'main']);

      process.chdir(repoRoot);
      const task = {
        id: 'fork-task',
        taskType: 'freeform',
        correlationId: 'correlation-1',
        input: { brief: 'diverge' },
      } as unknown as Parameters<typeof prepareTaskWorkspace>[0];

      workspace = prepareTaskWorkspace(task, repoRoot, {
        workspaceMode: 'dedicated_worktree',
        sessionKey: null,
        workspaceId: 'fork-task-attempt-1',
        worktreeBranch: 'feat/parent-fork-1',
        worktreeBaseRef: 'feat/parent',
        workspaceScope: 'attempt',
      });

      const guestWorkspace = path.resolve(workspace.cwdPath);
      const forkTip = runGit(guestWorkspace, ['rev-parse', 'HEAD']);
      // The fork branch starts at the PARENT tip, not main.
      expect(forkTip).toBe(parentTip);
      expect(forkTip).not.toBe(mainTip);
      // PARENT.md (committed only on the parent branch) is present in the fork.
      expect(existsSync(path.join(guestWorkspace, 'PARENT.md'))).toBe(true);
    } finally {
      process.chdir(oldCwd);
      workspace?.cleanup();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('creates and cleans up scratch workspaces outside a git repository', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'pi-scratch-repro-'));
    const oldCwd = process.cwd();
    let workspace: {
      mountPath: string;
      cwdPath: string;
      cleanup: () => void;
    } | null = null;

    try {
      process.chdir(repoRoot);
      const task = {
        id: 'task-2',
        taskType: 'run_eval',
        correlationId: 'correlation-2',
        input: {
          scenario: { prompt: 'Evaluate this workspace' },
          variantLabel: 'baseline',
          execution: { mode: 'vitro', workspace: 'none' },
          context: [],
        },
      } as unknown as Parameters<typeof prepareTaskWorkspace>[0];

      workspace = prepareTaskWorkspace(task, repoRoot, {
        workspaceMode: 'scratch_mount',
        sessionKey: null,
        workspaceId: 'task-task-2',
        worktreeBranch: null,
        workspaceScope: 'attempt',
      });

      expect(realpathSync(workspace.mountPath)).toBe(
        realpathSync(
          path.join(
            repoRoot,
            '.moltnet',
            'd',
            'task-workspaces',
            'task-task-2',
          ),
        ),
      );
      expect(workspace.cwdPath).toBe(workspace.mountPath);
      expect(path.basename(workspace.mountPath)).toBe('task-task-2');
      expect(realpathSync(path.dirname(workspace.mountPath))).toBe(
        realpathSync(path.join(repoRoot, '.moltnet', 'd', 'task-workspaces')),
      );
      expect(workspace.mountPath).not.toBe(repoRoot);
      expect(workspace.mountPath).not.toContain(
        `${path.sep}.worktrees${path.sep}`,
      );
    } finally {
      process.chdir(oldCwd);
      const scratchPath = workspace?.mountPath ?? null;
      workspace?.cleanup();
      if (scratchPath) {
        expect(existsSync(scratchPath)).toBe(false);
      }
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('keeps shared mounts repo-free', () => {
    const sandboxRoot = mkdtempSync(path.join(tmpdir(), 'pi-shared-repro-'));
    const oldCwd = process.cwd();

    try {
      process.chdir(sandboxRoot);
      const task = {
        id: 'task-shared',
        taskType: 'freeform',
        input: { brief: 'research only' },
      } as unknown as Parameters<typeof prepareTaskWorkspace>[0];

      const workspace = prepareTaskWorkspace(task, sandboxRoot, {
        workspaceMode: 'shared_mount',
        sessionKey: null,
        workspaceId: null,
        worktreeBranch: null,
        workspaceScope: 'attempt',
      });

      expect(workspace.mountPath).toBe(sandboxRoot);
      expect(workspace.cwdPath).toBe(sandboxRoot);
      expect(workspace.mode).toBe('shared_mount');
      workspace.cleanup();
    } finally {
      process.chdir(oldCwd);
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });

  it('fails clearly for dedicated worktrees outside a git repository', () => {
    const sandboxRoot = mkdtempSync(path.join(tmpdir(), 'pi-worktree-none-'));
    const oldCwd = process.cwd();

    try {
      process.chdir(sandboxRoot);
      const task = {
        id: 'task-worktree',
        taskType: 'fulfill_brief',
        input: { brief: 'change code' },
      } as unknown as Parameters<typeof prepareTaskWorkspace>[0];

      expect(() =>
        prepareTaskWorkspace(task, sandboxRoot, {
          workspaceMode: 'dedicated_worktree',
          sessionKey: null,
          workspaceId: 'task-worktree',
          worktreeBranch: 'task/worktree',
          workspaceScope: 'attempt',
        }),
      ).toThrow(/Dedicated worktree tasks require a git repository/);
    } finally {
      process.chdir(oldCwd);
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });

  it('copies a producer workspace snapshot into a fresh judge scratch workspace', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'pi-attach-repro-'));
    const producerWorkspace = mkdtempSync(path.join(tmpdir(), 'pi-producer-'));
    const oldCwd = process.cwd();

    try {
      runGit(repoRoot, ['init']);
      process.chdir(repoRoot);
      writeFileSync(
        path.join(producerWorkspace, 'artifact.txt'),
        'producer artifact\n',
        'utf8',
      );

      const task = {
        id: 'task-3',
        taskType: 'judge_eval_attempt',
        correlationId: 'correlation-3',
        input: {
          targetTaskId: 'producer-task',
          targetAttemptN: 1,
          successCriteria: { version: 1 },
        },
      } as unknown as Parameters<typeof prepareTaskWorkspace>[0];

      const workspace = prepareTaskWorkspace(task, repoRoot, {
        workspaceMode: 'scratch_mount',
        sessionKey: null,
        workspaceId: 'task-task-3',
        worktreeBranch: null,
        workspaceScope: 'attempt',
        workspaceSeed: {
          copyFromPath: producerWorkspace,
          source: 'producer',
        },
      });

      expect(workspace.mountPath).not.toBe(producerWorkspace);
      expect(workspace.cwdPath).toBe(workspace.mountPath);
      expect(
        readFileSync(path.join(workspace.mountPath, 'artifact.txt'), 'utf8'),
      ).toBe('producer artifact\n');
      expect(workspace.mode).toBe('scratch_mount');
      workspace.cleanup();
      expect(existsSync(producerWorkspace)).toBe(true);
    } finally {
      process.chdir(oldCwd);
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(producerWorkspace, { recursive: true, force: true });
    }
  });

  it('seeds a judge scratch workspace from the shared mount root without recursive self-copy', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'pi-shared-judge-seed-'));
    const oldCwd = process.cwd();
    let workspace: ReturnType<typeof prepareTaskWorkspace> | null = null;

    try {
      runGit(repoRoot, ['init']);
      runGit(repoRoot, ['config', 'user.name', 'Test User']);
      runGit(repoRoot, ['config', 'user.email', 'test@example.com']);
      writeFileSync(path.join(repoRoot, 'README.md'), 'seed\n', 'utf8');
      runGit(repoRoot, ['add', 'README.md']);
      runGit(repoRoot, ['commit', '-m', 'seed']);
      writeFileSync(
        path.join(repoRoot, 'producer-artifact.txt'),
        'producer artifact\n',
        'utf8',
      );

      process.chdir(repoRoot);
      const task = {
        id: 'task-4',
        taskType: 'judge_eval_attempt',
        correlationId: 'correlation-4',
        input: {
          targetTaskId: 'producer-task',
          targetAttemptN: 1,
          successCriteria: { version: 1 },
        },
      } as unknown as Parameters<typeof prepareTaskWorkspace>[0];

      workspace = prepareTaskWorkspace(task, repoRoot, {
        workspaceMode: 'scratch_mount',
        sessionKey: null,
        workspaceId: 'task-task-4',
        worktreeBranch: null,
        workspaceScope: 'attempt',
        workspaceSeed: {
          copyFromPath: repoRoot,
          source: 'producer',
        },
      });

      expect(
        readFileSync(path.join(workspace.mountPath, 'README.md'), 'utf8'),
      ).toBe('seed\n');
      expect(
        readFileSync(
          path.join(workspace.mountPath, 'producer-artifact.txt'),
          'utf8',
        ),
      ).toBe('producer artifact\n');
      expect(
        realpathSync(
          path.resolve(
            workspace.mountPath,
            runGit(workspace.mountPath, ['rev-parse', '--git-dir']),
          ),
        ),
      ).toBe(realpathSync(path.join(workspace.mountPath, '.git')));
      expect(
        existsSync(
          path.join(
            workspace.mountPath,
            '.moltnet',
            'd',
            'task-workspaces',
            'task-task-4',
          ),
        ),
      ).toBe(false);
    } finally {
      process.chdir(oldCwd);
      workspace?.cleanup();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('keeps judge scratch git state isolated from a producer dedicated worktree', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'pi-judge-git-copy-'));
    const producerWorktreeParent = mkdtempSync(
      path.join(tmpdir(), 'pi-producer-wt-parent-'),
    );
    const producerWorktree = path.join(
      producerWorktreeParent,
      'producer-worktree',
    );
    const oldCwd = process.cwd();
    let workspace: ReturnType<typeof prepareTaskWorkspace> | null = null;

    try {
      runGit(repoRoot, ['init']);
      runGit(repoRoot, ['config', 'user.name', 'Test User']);
      runGit(repoRoot, ['config', 'user.email', 'test@example.com']);
      writeFileSync(path.join(repoRoot, 'README.md'), 'seed\n', 'utf8');
      runGit(repoRoot, ['add', 'README.md']);
      runGit(repoRoot, ['commit', '-m', 'seed']);
      runGit(repoRoot, [
        'worktree',
        'add',
        '-b',
        'producer-branch',
        producerWorktree,
      ]);
      writeFileSync(
        path.join(producerWorktree, 'producer-artifact.txt'),
        'producer artifact\n',
        'utf8',
      );

      process.chdir(repoRoot);
      const task = {
        id: 'task-5',
        taskType: 'judge_eval_attempt',
        correlationId: 'correlation-5',
        input: {
          targetTaskId: 'producer-task',
          targetAttemptN: 1,
          successCriteria: { version: 1 },
        },
      } as unknown as Parameters<typeof prepareTaskWorkspace>[0];

      workspace = prepareTaskWorkspace(task, repoRoot, {
        workspaceMode: 'scratch_mount',
        sessionKey: null,
        workspaceId: 'task-task-5',
        worktreeBranch: null,
        workspaceScope: 'attempt',
        workspaceSeed: {
          copyFromPath: producerWorktree,
          source: 'producer',
        },
      });

      expect(
        realpathSync(
          path.resolve(
            workspace.mountPath,
            runGit(workspace.mountPath, ['rev-parse', '--git-dir']),
          ),
        ),
      ).toBe(realpathSync(path.join(workspace.mountPath, '.git')));
      expect(
        readFileSync(
          path.join(workspace.mountPath, 'producer-artifact.txt'),
          'utf8',
        ),
      ).toBe('producer artifact\n');

      writeFileSync(
        path.join(workspace.mountPath, 'judge-only.txt'),
        'judge output\n',
        'utf8',
      );
      runGit(workspace.mountPath, ['add', 'judge-only.txt']);

      expect(
        runGit(workspace.mountPath, ['diff', '--cached', '--name-only']),
      ).toContain('judge-only.txt');
      expect(
        runGit(producerWorktree, ['diff', '--cached', '--name-only']),
      ).not.toContain('judge-only.txt');
    } finally {
      process.chdir(oldCwd);
      workspace?.cleanup();
      if (existsSync(producerWorktree)) {
        runGit(repoRoot, ['worktree', 'remove', '--force', producerWorktree]);
      }
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(producerWorktreeParent, { recursive: true, force: true });
    }
  });
});
