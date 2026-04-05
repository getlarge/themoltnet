import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { execFileText } from './process.js';

const activeWorktrees: string[] = [];

function ensureSigintHandler(): void {
  if (process.listenerCount('SIGINT') > 0) return;
  process.on('SIGINT', () => {
    void cleanupAllWorktrees().then(() => process.exit(130));
  });
}

export async function createWorktree(
  baseCommit: string,
  label: string,
): Promise<string> {
  ensureSigintHandler();
  const tmpDir = await mkdtemp(resolve(tmpdir(), 'tasksmith-'));
  const worktreeDir = `${tmpDir}/tasksmith-${label}`;
  activeWorktrees.push(worktreeDir);
  await execFileText('git', ['worktree', 'add', worktreeDir, baseCommit]);
  return worktreeDir;
}

export async function removeWorktree(worktreeDir: string): Promise<void> {
  try {
    const list = await execFileText('git', ['worktree', 'list']);
    if (list.includes(worktreeDir)) {
      await execFileText('git', ['worktree', 'remove', '--force', worktreeDir]);
    } else {
      await rm(worktreeDir, { recursive: true, force: true });
    }
  } catch {
    // best-effort
  }
  const idx = activeWorktrees.indexOf(worktreeDir);
  if (idx !== -1) activeWorktrees.splice(idx, 1);
}

export async function cleanupAllWorktrees(): Promise<void> {
  await Promise.all([...activeWorktrees].map((p) => removeWorktree(p)));
}
