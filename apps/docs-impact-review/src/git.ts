import { execFileSync } from 'node:child_process';

/** Runs `git` with the given arguments and returns stdout. */
export type Git = (args: string[], input?: string) => string;

const FULL_OID = /^[0-9a-f]{40}$/;

export function requireFullOid(value: string, label: string): string {
  if (!FULL_OID.test(value)) {
    throw new Error(`${label} must be a full 40-character lowercase git OID`);
  }
  return value;
}

export function createGit(cwd: string): Git {
  return (args, input) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      input,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
}
