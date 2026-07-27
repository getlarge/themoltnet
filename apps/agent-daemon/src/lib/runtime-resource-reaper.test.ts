import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TaskAttempt } from '@moltnet/tasks';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  ListedRuntimeSlotContext,
  RuntimeSlotStore,
} from './execution-plan-cache.js';
import { reapRuntimeSlotResources } from './runtime-resource-reaper.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('reapRuntimeSlotResources', () => {
  it('removes expired idle session and workspace directories', async () => {
    const fixture = await makeFixture('idle', 1);

    const result = await reapRuntimeSlotResources(
      makeDeps([fixture.slot], []),
      fixture.input,
    );

    expect(result).toMatchObject({
      removedSessions: 1,
      removedWorkspaces: 1,
      scanned: 1,
    });
    expect(existsSync(fixture.sessionDir)).toBe(false);
    expect(existsSync(fixture.workspacePath)).toBe(false);
  });

  it('retains an active running attempt even after its slot TTL', async () => {
    const fixture = await makeFixture('active', 1);

    const result = await reapRuntimeSlotResources(
      makeDeps([fixture.slot], [attempt('running')]),
      fixture.input,
    );

    expect(result.removedSessions).toBe(0);
    expect(result.removedWorkspaces).toBe(0);
    expect(existsSync(fixture.sessionDir)).toBe(true);
    expect(existsSync(fixture.workspacePath)).toBe(true);
  });

  it('removes resources left by a crashed terminal attempt', async () => {
    const fixture = await makeFixture('active', Date.now() + 60_000);

    const result = await reapRuntimeSlotResources(
      makeDeps([fixture.slot], [attempt('failed')]),
      fixture.input,
    );

    expect(result.removedSessions).toBe(1);
    expect(result.removedWorkspaces).toBe(1);
  });

  it('refuses to delete paths outside daemon-owned roots', async () => {
    const fixture = await makeFixture('idle', 1);
    const outside = await mkdtemp(join(tmpdir(), 'daemon-reaper-outside-'));
    roots.push(outside);
    fixture.slot.session = {
      sessionDir: outside,
      sessionPath: null,
    };
    fixture.slot.workspace = {
      ...fixture.slot.workspace!,
      worktreePath: outside,
    };

    const result = await reapRuntimeSlotResources(
      makeDeps([fixture.slot], []),
      fixture.input,
    );

    expect(result.unsafePaths).toBe(2);
    expect(existsSync(outside)).toBe(true);
  });

  it('sweeps registered legacy worktrees whose Pi session is gone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'daemon-reaper-legacy-'));
    roots.push(root);
    const mainWorktree = join(root, 'repo');
    const sessionRootDir = join(root, 'sessions');
    const scratchRootDir = join(root, 'scratch');
    const workspacePath = join(
      mainWorktree,
      '.worktrees',
      'session-agent%3Alegreffier%3Aprofile%3Aold%3Akey%3Afreeform',
    );
    await Promise.all([
      mkdir(mainWorktree, { recursive: true }),
      mkdir(sessionRootDir, { recursive: true }),
      mkdir(scratchRootDir, { recursive: true }),
    ]);
    runGit(mainWorktree, ['init']);
    runGit(mainWorktree, ['config', 'user.name', 'Test Agent']);
    runGit(mainWorktree, ['config', 'user.email', 'agent@example.com']);
    await writeFile(join(mainWorktree, 'README.md'), 'seed\n');
    runGit(mainWorktree, ['add', 'README.md']);
    runGit(mainWorktree, ['commit', '-m', 'seed']);
    runGit(mainWorktree, [
      'worktree',
      'add',
      '-b',
      'task/legacy-orphan',
      workspacePath,
    ]);
    await writeFile(join(workspacePath, 'review.patch'), 'scratch\n');

    const result = await reapRuntimeSlotResources(makeDeps([], []), {
      agentName: 'legreffier',
      mainWorktree,
      runtimeProfileId: '22222222-2222-4222-8222-222222222222',
      sessionRootDir,
      scratchRootDir,
      teamId: '33333333-3333-4333-8333-333333333333',
    });

    expect(result.removedWorkspaces).toBe(1);
    expect(existsSync(workspacePath)).toBe(false);
    expect(
      runGit(mainWorktree, ['worktree', 'list', '--porcelain']),
    ).not.toContain(workspacePath);
  });
});

async function makeFixture(state: 'active' | 'idle', expiresAtMs: number) {
  const root = await mkdtemp(join(tmpdir(), 'daemon-reaper-'));
  roots.push(root);
  const mainWorktree = join(root, 'repo');
  const sessionRootDir = join(root, 'sessions');
  const scratchRootDir = join(root, 'scratch');
  const sessionDir = join(sessionRootDir, 'slot-a');
  const workspacePath = join(mainWorktree, '.worktrees', 'daemon-task-a');
  await Promise.all([
    mkdir(sessionDir, { recursive: true }),
    mkdir(workspacePath, { recursive: true }),
    mkdir(scratchRootDir, { recursive: true }),
  ]);
  await writeFile(join(sessionDir, 'session.jsonl'), '{}\n');
  await writeFile(join(workspacePath, 'scratch.txt'), 'temporary\n');

  const slot: ListedRuntimeSlotContext = {
    slot: {
      expiresAtMs,
      id: 'slot-a',
      lastAttemptN: 1,
      lastTaskId: '11111111-1111-4111-8111-111111111111',
      runtimeProfileId: '22222222-2222-4222-8222-222222222222',
      state,
      taskType: 'freeform',
    },
    session: {
      sessionDir,
      sessionPath: null,
    },
    workspace: {
      kind: 'origin',
      workspaceId: 'daemon-task-a',
      worktreeBranch: 'task/freeform-11111111',
      worktreePath: workspacePath,
    },
  };
  return {
    input: {
      agentName: 'legreffier',
      mainWorktree,
      now: Date.now(),
      runtimeProfileId: '22222222-2222-4222-8222-222222222222',
      sessionRootDir,
      scratchRootDir,
      teamId: '33333333-3333-4333-8333-333333333333',
    },
    sessionDir,
    slot,
    workspacePath,
  };
}

function makeDeps(slots: ListedRuntimeSlotContext[], attempts: TaskAttempt[]) {
  return {
    runtimeSlotStore: {
      listSlots: vi.fn((input: { state?: 'active' | 'idle' }) =>
        Promise.resolve(
          slots.filter(
            (slot) => !input.state || slot.slot.state === input.state,
          ),
        ),
      ),
    } as unknown as RuntimeSlotStore,
    taskReader: {
      listAttempts: vi.fn().mockResolvedValue(attempts),
    },
  };
}

function attempt(status: TaskAttempt['status']): TaskAttempt {
  return {
    attemptN: 1,
    status,
    taskId: '11111111-1111-4111-8111-111111111111',
  } as TaskAttempt;
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim();
}
