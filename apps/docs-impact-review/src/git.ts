import { execFileSync } from 'node:child_process';

import { gitEnv } from './config.js';

/** Runs `git` with the given arguments and returns stdout. */
export type Git = (args: string[], input?: string) => string;

const FULL_OID = /^[0-9a-f]{40}$/;

export function requireFullOid(value: string, label: string): string {
  if (!FULL_OID.test(value)) {
    throw new Error(`${label} must be a full 40-character lowercase git OID`);
  }
  return value;
}

/** Long enough for a cold fetch of a large pull request. */
export const GIT_TIMEOUT_MS = 5 * 60_000;

/**
 * Git never prompts (a missing credential fails instead of hanging), and a
 * command that stalls is killed after `timeoutMs`.
 */
export function createGit(cwd: string, timeoutMs = GIT_TIMEOUT_MS): Git {
  return (args, input) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      input,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
      env: gitEnv(),
    });
}

/** Whether `path` exists at `revision`. */
export function existsAt(git: Git, revision: string, path: string): boolean {
  try {
    git(['cat-file', '-e', `${revision}:${path}`]);
    return true;
  } catch {
    return false;
  }
}
