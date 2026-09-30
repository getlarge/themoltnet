import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { type RuntimeLock, staleLocks } from './action-runtime-lock.js';

/** The moving major tag for `version`, e.g. `v0` or `docs-impact-review-action-v1`. */
export function stableMajorTagFor(version: string, prefix = 'v'): string {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`GitHub Action package version is not semver: ${version}`);
  }
  return `${prefix}${version.split('.')[0]}`;
}

/**
 * The bundle entries an action runs (`node dist/<entry>`). A `dist/` holding
 * only shared chunks must not pass as a release, so each entry is required.
 */
export function missingBundleEntries(
  bundleDir: string,
  entries: readonly string[],
): string[] {
  if (entries.length === 0) {
    throw new Error('--entries must name at least one bundle entry');
  }
  return entries.filter((entry) => !existsSync(join(bundleDir, entry)));
}

export interface GitCommand {
  args: string[];
  /** Extra environment for this one `git` process. */
  env: Record<string, string>;
}

/**
 * The `git` command that force-pushes the tag. With a token, it authenticates
 * only this push, so the checkout never persists a write-capable credential.
 * The header goes through `GIT_CONFIG_*` rather than `-c`, so it is not in
 * the process arguments; callers mask `authHeaderValue` in logs.
 */
export function tagPushCommand(
  tag: string,
  token?: string,
  serverUrl = 'https://github.com',
): GitCommand {
  return {
    args: ['push', 'origin', `refs/tags/${tag}:refs/tags/${tag}`, '--force'],
    env: token
      ? {
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: `http.${serverUrl.replace(/\/?$/, '/')}.extraheader`,
          GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${authHeaderValue(token)}`,
        }
      : {},
  };
}

/** The base64 credential in the header; GitHub masks the token, not this. */
export function authHeaderValue(token: string): string {
  return Buffer.from(`x-access-token:${token}`).toString('base64');
}

/**
 * Everything that must hold before an action release moves its tag: every
 * entry point is bundled, each bundle (this action's and those it runs from
 * the same commit) matches its committed files, and the runtime locks are
 * current. Returns the problems; empty means ready.
 */
export function releaseProblems(options: {
  root: string;
  bundleDir: string;
  entries: readonly string[];
  /** Bundles of other actions this one runs from the same commit. */
  otherBundleDirs?: readonly string[];
  locks?: RuntimeLock[];
}): string[] {
  const problems: string[] = [];
  const missing = missingBundleEntries(
    join(options.root, options.bundleDir),
    options.entries,
  );
  if (missing.length > 0) {
    problems.push(`${options.bundleDir} lacks: ${missing.join(', ')}`);
  }
  // `git status --porcelain`, not `git diff`: the bundle code-splits into
  // content-hashed chunks, and a renamed chunk is untracked, which `git diff`
  // does not report.
  for (const dir of [options.bundleDir, ...(options.otherBundleDirs ?? [])]) {
    const changes = execFileSync('git', ['status', '--porcelain', '--', dir], {
      cwd: options.root,
      encoding: 'utf8',
    }).trim();
    if (changes) {
      problems.push(`${dir} does not match its sources:\n${changes}`);
    }
  }
  for (const lock of staleLocks(options.root, options.locks)) {
    problems.push(`${lock} is out of date`);
  }
  return problems;
}
