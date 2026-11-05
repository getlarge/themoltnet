import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { type RuntimeLock, staleLocks } from './action-runtime-lock.js';

/** The moving major tag for `version`, e.g. `v0` or `agent-daemon-action-v1`. */
export function stableMajorTagFor(version: string, prefix = 'v'): string {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`GitHub Action package version is not semver: ${version}`);
  }
  return `${prefix}${version.split('.')[0]}`;
}

/**
 * The immutable tag that keeps one built bundle commit reachable, e.g.
 * `bundles/adaptive-review-action-v0.3.0-e81a938c96a6`. Bundle commits are
 * detached, so once the stable major tag moves on, this tag is the only ref
 * reaching a commit that callers pinned by SHA. GitHub Actions cannot resolve
 * a reusable workflow from an unreachable commit. The `bundles/` namespace
 * keeps these tags out of Release Please's version-tag matching.
 */
export function bundleTagFor(
  version: string,
  prefix: string,
  commit: string,
): string {
  stableMajorTagFor(version, prefix);
  if (!/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error(`Bundle commit is not a full SHA: ${commit}`);
  }
  return `bundles/${prefix}${version}-${commit.slice(0, 12)}`;
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
  return entries.filter((entry) => {
    const path = join(bundleDir, entry);
    return (
      !existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0
    );
  });
}

export interface GitCommand {
  args: string[];
  /** Extra environment for this one `git` process. */
  env: Record<string, string>;
}

/**
 * The `git` command that force-pushes the moving tag and, in the same atomic
 * push, creates each `keepTags` tag without force, so an existing immutable
 * tag is never rewritten. With a token, it authenticates only this push, so the checkout never persists a write-capable credential.
 * The header goes through `GIT_CONFIG_*` rather than `-c`, so it is not in
 * the process arguments; callers mask `authHeaderValue` in logs.
 */
export function tagPushCommand(
  tag: string,
  token?: string,
  serverUrl = 'https://github.com',
  keepTags: readonly string[] = [],
  expectedMajor?: string,
): GitCommand {
  return {
    args: [
      'push',
      '--atomic',
      ...(expectedMajor === undefined
        ? []
        : [`--force-with-lease=refs/tags/${tag}:${expectedMajor}`]),
      'origin',
      ...keepTags.map((keep) => `refs/tags/${keep}:refs/tags/${keep}`),
      ...(tag
        ? [
            `${expectedMajor === undefined ? '+' : ''}refs/tags/${tag}:refs/tags/${tag}`,
          ]
        : []),
    ],
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
 * entry point is bundled and runtime locks are current. Bundles are built
 * at the version tag and included only in the stable major tag's commit.
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
  for (const dir of options.otherBundleDirs ?? []) {
    if (!existsSync(join(options.root, dir))) {
      problems.push(`${dir} is missing`);
    }
  }
  for (const lock of staleLocks(options.root, options.locks)) {
    problems.push(`${lock} is out of date`);
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

export interface PublishBundleOptions {
  root: string;
  project: string;
  projectRoot: string;
  version: string;
  prefix: string;
  bundleDir: string;
  bundleDirs: string[];
  entries: string[];
  token?: string;
  serverUrl?: string;
}

/** Idempotent immutable mapping plus compare-and-swap major promotion. */
export function publishBundleTags(options: PublishBundleOptions): string {
  const git = (
    args: string[],
    command: { stdio?: 'inherit'; env?: Record<string, string> } = {},
  ) =>
    execFileSync('git', args, {
      cwd: options.root,
      encoding: 'utf8',
      stdio: command.stdio,
      env: { ...process.env, ...command.env },
    })?.trim() ?? '';
  const source = git(['rev-parse', 'HEAD']);
  const stableTag = stableMajorTagFor(options.version, options.prefix);
  const message = `chore(actions): bundle ${options.project} ${options.version}`;
  // One immutable version-to-bundle mapping. Historical SHA-suffixed tags
  // remain valid; retries reuse their current major target when appropriate.
  const exactTag = `bundles/${options.project.replace('@themoltnet/', '')}-v${options.version}`;
  const remote = (tag: string) =>
    git(['ls-remote', 'origin', `refs/tags/${tag}`]).split(/\s/)[0];
  const fetchCommit = (sha: string) => {
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Expected a commit SHA');
    git(['fetch', '--no-tags', 'origin', sha]);
  };
  const versionAt = (sha: string) => {
    const metadata = JSON.parse(
      git(['show', `${sha}:${options.projectRoot}/package.json`]),
    ) as { version: string };
    if (!/^\d+\.\d+\.\d+$/.test(metadata.version))
      throw new Error('Invalid action version');
    return metadata.version;
  };
  const compare = (a: string, b: string) => {
    const left = a.split('.').map(Number);
    const right = b.split('.').map(Number);
    for (let i = 0; i < 3; i++)
      if (left[i] !== right[i]) return left[i] - right[i];
    return 0;
  };
  const previousMajor = remote(stableTag);
  if (previousMajor) fetchCommit(previousMajor);
  let target = remote(exactTag);
  if (target) fetchCommit(target);
  // Adopt a legacy bundle, without rebuilding or changing its identity.
  if (!target && previousMajor && versionAt(previousMajor) === options.version)
    target = previousMajor;
  if (target) {
    if (
      git(['rev-parse', `${target}^`]) !== source ||
      git(['rev-list', '--parents', '-n', '1', target]).split(' ').length !== 2
    ) {
      throw new Error(
        `${exactTag} does not descend directly from this source tag`,
      );
    }
    if (versionAt(target) !== options.version)
      throw new Error('Immutable bundle version mismatch');
    const changes = git([
      'diff-tree',
      '--no-commit-id',
      '--name-only',
      '-r',
      target,
    ]).split('\n');
    if (
      changes.some(
        (path) => !options.bundleDirs.some((dir) => path.startsWith(`${dir}/`)),
      )
    )
      throw new Error('Bundle changes files outside dist/');
    for (const entry of options.entries) {
      if (
        Number(
          git(['cat-file', '-s', `${target}:${options.bundleDir}/${entry}`]),
        ) <= 0
      )
        throw new Error(`Empty bundle entry ${entry}`);
    }
  } else {
    target = createReleaseCommit(
      git(['rev-parse', '--show-toplevel']),
      options.bundleDirs,
      message,
    );
  }
  const bundleTag = bundleTagFor(options.version, options.prefix, target);
  const promote =
    !previousMajor || compare(versionAt(previousMajor), options.version) <= 0;
  if (
    previousMajor &&
    versionAt(previousMajor) === options.version &&
    previousMajor !== target
  ) {
    throw new Error(
      'Refusing to replace an existing action version with a different bundle',
    );
  }
  process.stdout.write(
    `built commit: ${target}\nbundle tag: ${exactTag} -> ${target}\n`,
  );
  // Local tags can be recreated; remote immutable tags are never forced.
  git(['tag', '-f', exactTag, target], { stdio: 'inherit' });
  git(['tag', '-f', bundleTag, target], { stdio: 'inherit' });
  if (promote) git(['tag', '-f', stableTag, target], { stdio: 'inherit' });
  else
    process.stdout.write(
      `Keeping newer ${stableTag}; retaining historical ${exactTag} only\n`,
    );

  // The release job checks out without persisted credentials and hands the
  // token to this one push.
  const token = options.token;
  if (token && process.env.GITHUB_ACTIONS === 'true') {
    process.stdout.write(`::add-mask::${authHeaderValue(token)}\n`);
  }
  const keepTags = [exactTag, bundleTag];
  if (previousMajor) {
    const previousRetention = bundleTagFor(
      versionAt(previousMajor),
      options.prefix,
      previousMajor,
    );
    git(['tag', '-f', previousRetention, previousMajor]);
    if (!keepTags.includes(previousRetention)) keepTags.push(previousRetention);
  }
  const push = tagPushCommand(
    promote ? stableTag : '',
    token,
    options.serverUrl,
    keepTags,
    promote ? previousMajor : undefined,
  );
  git(push.args, { stdio: 'inherit', env: push.env });
  if (remote(exactTag) !== target)
    throw new Error('Published bundle ref failed read-back');
  return target;
}
