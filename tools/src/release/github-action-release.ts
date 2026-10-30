import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The moving major tag for `version`, e.g. `v0` or `agent-daemon-action-v1`. */
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
 * entry point is bundled and every included bundle exists. Bundles are built
 * at the version tag and included only in the stable major tag's commit.
 */
export function releaseProblems(options: {
  root: string;
  bundleDir: string;
  entries: readonly string[];
  /** Bundles of other actions this one runs from the same commit. */
  otherBundleDirs?: readonly string[];
}): string[] {
  const problems: string[] = [];
  const missing = missingBundleEntries(
    join(options.root, options.bundleDir),
    options.entries,
  );
  if (missing.length > 0) {
    problems.push(`${options.bundleDir} lacks: ${missing.join(', ')}`);
  }
  for (const dir of options.otherBundleDirs ?? []) {
    if (!existsSync(join(options.root, dir))) {
      problems.push(`${dir} is missing`);
    }
  }
  return problems;
}

/** Add only the built bundles on a detached release checkout; never move a branch. */
export function createReleaseCommit(
  root: string,
  bundleDirs: readonly string[],
  message: string,
): string {
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'HEAD') {
    throw new Error(
      'Action publishing requires a detached HEAD at the version tag',
    );
  }
  if (git('status', '--porcelain', '--untracked-files=no')) {
    throw new Error(
      'Action publishing requires a clean tracked checkout and index',
    );
  }
  git('add', '-f', '--', ...bundleDirs);
  git('commit', '-m', message);
  return git('rev-parse', 'HEAD');
}
