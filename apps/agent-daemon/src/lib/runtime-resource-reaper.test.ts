import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
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

  it('retains an active slot when its attempt row is missing', async () => {
    const fixture = await makeFixture('active', 1);

    const result = await reapRuntimeSlotResources(
      makeDeps([fixture.slot], []),
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
    const onIssue = vi.fn();

    const result = await reapRuntimeSlotResources(
      {
        ...makeDeps([fixture.slot], []),
        onIssue,
      },
      fixture.input,
    );

    expect(result.unsafePaths).toBe(2);
    expect(result.unsafePathDetails).toEqual([
      expect.objectContaining({
        kind: 'unsafe_path',
        path: outside,
        root: fixture.input.sessionRootDir,
        slotId: fixture.slot.slot.id,
      }),
      expect.objectContaining({
        kind: 'unsafe_path',
        path: outside,
        slotId: fixture.slot.slot.id,
      }),
    ]);
    expect(onIssue).toHaveBeenCalledTimes(2);
    expect(existsSync(outside)).toBe(true);
  });

  it('refuses a nested symlink escape immediately before deletion', async () => {
    const fixture = await makeFixture('idle', 1);
    const outside = await mkdtemp(join(tmpdir(), 'daemon-reaper-symlink-'));
    roots.push(outside);
    const outsideSession = join(outside, 'live-session');
    await mkdir(outsideSession);
    await writeFile(join(outsideSession, 'keep.txt'), 'keep\n');
    const linkPath = join(fixture.input.sessionRootDir, 'escape');
    await symlink(outside, linkPath);
    fixture.slot.session = {
      sessionDir: join(linkPath, 'live-session'),
      sessionPath: null,
    };
    fixture.slot.workspace = null;

    const result = await reapRuntimeSlotResources(
      makeDeps([fixture.slot], []),
      fixture.input,
    );

    expect(result.unsafePaths).toBe(1);
    expect(existsSync(join(outsideSession, 'keep.txt'))).toBe(true);
  });

  it('does not reap slots owned by another runtime instance', async () => {
    const fixture = await makeFixture('idle', 1);
    fixture.slot.slot.slotKey =
      'freeform:correlation:test:worker:another-worker';

    const result = await reapRuntimeSlotResources(
      makeDeps([fixture.slot], []),
      fixture.input,
    );

    expect(result.scanned).toBe(0);
    expect(result.removedSessions).toBe(0);
    expect(existsSync(fixture.sessionDir)).toBe(true);
  });

  it('revalidates an expired slot and retains it when ownership changed', async () => {
    const fixture = await makeFixture('idle', 1);
    let idleReads = 0;
    const runtimeSlotStore = {
      listSlots: vi.fn((input: { state?: 'active' | 'idle' }) => {
        if (input.state === 'active') return Promise.resolve([]);
        idleReads++;
        return Promise.resolve(idleReads === 1 ? [fixture.slot] : []);
      }),
    } as unknown as RuntimeSlotStore;

    const result = await reapRuntimeSlotResources(
      {
        runtimeSlotStore,
        taskReader: { listAttempts: vi.fn().mockResolvedValue([]) },
      },
      fixture.input,
    );

    expect(idleReads).toBe(2);
    expect(result.removedSessions).toBe(0);
    expect(existsSync(fixture.sessionDir)).toBe(true);
  });

  it('deduplicates attempt lookups by task and bounds cleanup to terminal rows', async () => {
    const first = await makeFixture('active', 1);
    const second = structuredClone(first.slot);
    second.slot.id = 'slot-b';
    second.slot.lastAttemptN = 2;
    second.slot.slotKey = 'freeform:correlation:other:worker:worker-a';
    second.session = null;
    second.workspace = null;
    const listAttempts = vi
      .fn()
      .mockResolvedValue([
        attempt('failed'),
        { ...attempt('running'), attemptN: 2 },
      ]);

    const result = await reapRuntimeSlotResources(
      {
        ...makeDeps([first.slot, second], []),
        taskReader: { listAttempts },
      },
      first.input,
    );

    expect(listAttempts).toHaveBeenCalledTimes(1);
    expect(result.removedSessions).toBe(1);
  });

  it('surfaces a full API page and skips legacy sweeping', async () => {
    const fixture = await makeLegacyFixture();
    const foreignSlots = Array.from({ length: 200 }, (_, index) => ({
      slot: {
        expiresAtMs: 1,
        id: `foreign-${index}`,
        lastAttemptN: 1,
        lastTaskId: '11111111-1111-4111-8111-111111111111',
        runtimeProfileId: fixture.input.runtimeProfileId,
        slotKey: `freeform:${index}:worker:other-worker`,
        state: 'idle' as const,
        taskType: 'freeform',
      },
      session: null,
      workspace: null,
    }));

    const result = await reapRuntimeSlotResources(
      makeDeps(foreignSlots, []),
      fixture.input,
    );

    expect(result.truncated).toBe(true);
    expect(existsSync(fixture.workspacePath)).toBe(true);
  });

  it('sweeps registered legacy worktrees whose Pi session is gone', async () => {
    const fixture = await makeLegacyFixture();

    const result = await reapRuntimeSlotResources(
      makeDeps([], []),
      fixture.input,
    );

    expect(result.removedWorkspaces).toBe(1);
    expect(existsSync(fixture.workspacePath)).toBe(false);
    expect(
      runGit(fixture.input.mainWorktree, ['worktree', 'list', '--porcelain']),
    ).not.toContain(fixture.workspacePath);
  });

  it('retains a legacy worktree while its same-named session exists', async () => {
    const fixture = await makeLegacyFixture();
    await mkdir(fixture.sessionDir, { recursive: true });

    const result = await reapRuntimeSlotResources(
      makeDeps([], []),
      fixture.input,
    );

    expect(result.removedWorkspaces).toBe(0);
    expect(existsSync(fixture.workspacePath)).toBe(true);
    expect(
      runGit(fixture.input.mainWorktree, ['worktree', 'list', '--porcelain']),
    ).toContain(fixture.workspacePath);
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
  runGit(mainWorktree, ['init']);

  const slot: ListedRuntimeSlotContext = {
    slot: {
      expiresAtMs,
      id: 'slot-a',
      lastAttemptN: 1,
      lastTaskId: '11111111-1111-4111-8111-111111111111',
      runtimeProfileId: '22222222-2222-4222-8222-222222222222',
      slotKey: 'freeform:correlation:test:worker:worker-a',
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
      runtimeInstanceId: 'worker-a',
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

async function makeLegacyFixture() {
  const root = await mkdtemp(join(tmpdir(), 'daemon-reaper-legacy-'));
  roots.push(root);
  const mainWorktree = join(root, 'repo');
  const sessionRootDir = join(root, 'sessions');
  const scratchRootDir = join(root, 'scratch');
  const workspaceName =
    'session-agent%3Alegreffier%3Aprofile%3Aold%3Akey%3Afreeform';
  const workspacePath = join(mainWorktree, '.worktrees', workspaceName);
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
    `task/legacy-orphan-${roots.length}`,
    workspacePath,
  ]);
  await writeFile(join(workspacePath, 'review.patch'), 'scratch\n');
  return {
    input: {
      agentName: 'legreffier',
      mainWorktree,
      runtimeInstanceId: 'worker-a',
      runtimeProfileId: '22222222-2222-4222-8222-222222222222',
      sessionRootDir,
      scratchRootDir,
      teamId: '33333333-3333-4333-8333-333333333333',
    },
    sessionDir: join(sessionRootDir, workspaceName.slice('session-'.length)),
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
