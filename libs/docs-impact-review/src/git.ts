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

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * A `git` command that exited with a status. Timeouts, signals and output
 * limits are thrown as plain errors instead, so callers can tell "git said
 * no" from "git never answered".
 */
export class GitCommandError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GitCommandError';
  }
}

/** Names the command, and the limit when git was stopped rather than failed. */
export function describeGitFailure(
  args: readonly string[],
  error: unknown,
  timeoutMs: number,
): Error {
  const command = `git ${args[0] ?? ''}`.trim();
  const failure = error as NodeJS.ErrnoException & {
    status?: number | null;
    signal?: NodeJS.Signals | null;
    stderr?: string | Buffer;
  };
  if (failure.code === 'ETIMEDOUT') {
    return new Error(`${command} timed out after ${timeoutMs} ms`);
  }
  if (failure.code === 'ENOBUFS') {
    return new Error(
      `${command} wrote more than ${MAX_OUTPUT_BYTES} bytes of output`,
    );
  }
  if (typeof failure.status === 'number' && !failure.signal) {
    const stderr = String(failure.stderr ?? '').trim();
    return new GitCommandError(
      `${command} exited with ${failure.status}${stderr ? `: ${stderr}` : ''}`,
      failure.status,
    );
  }
  return new Error(
    `${command} failed${failure.signal ? ` (${failure.signal})` : ''}: ${failure.message}`,
  );
}

/**
 * Git never prompts (a missing credential fails instead of hanging), and a
 * command that stalls is killed after `timeoutMs`.
 */
export function createGit(cwd: string, timeoutMs = GIT_TIMEOUT_MS): Git {
  return (args, input) => {
    try {
      return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        input,
        maxBuffer: MAX_OUTPUT_BYTES,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: timeoutMs,
        env: gitEnv(),
      });
    } catch (error) {
      throw describeGitFailure(args, error, timeoutMs);
    }
  };
}

/**
 * Whether `path` exists at `revision`. Only git's own "no such object"
 * answer means absent: a timeout or a killed process is rethrown, so it
 * fails the review instead of reporting a page as missing.
 */
export function existsAt(git: Git, revision: string, path: string): boolean {
  try {
    git(['cat-file', '-e', `${revision}:${path}`]);
    return true;
  } catch (error) {
    if (error instanceof GitCommandError) return false;
    throw error;
  }
}
