/**
 * Deterministic git history builder for eval fixtures.
 *
 * Each commit snapshots one directory tree verbatim (the tree replaces the
 * previous commit's contents, so deletions are recorded). Author, committer,
 * dates, and messages are fixed and every command runs isolated from the
 * caller's git configuration, so identical trees always produce identical
 * commit ids on any machine.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const FULL_OBJECT_ID = /^[0-9a-f]{40}$/;
const FIXED_IDENTITY = {
  name: 'MoltNet Eval Fixture',
  email: 'eval-fixture@themolt.net',
};
/** Commit dates advance one minute per commit from this fixed instant. */
const FIXED_EPOCH_SECONDS = 1_700_000_000;

export interface GitFixtureCommit {
  /** Absolute path of the directory whose contents become this commit's tree. */
  tree: string;
  message: string;
}

export interface BuildGitFixtureRepoOptions {
  /** Empty or missing directory that becomes the repository's main checkout. */
  root: string;
  /** Commits in order; each one is the parent of the next. */
  commits: readonly GitFixtureCommit[];
  /** Branch created at the first commit. Defaults to `main`. */
  branch?: string;
  /**
   * Commit index `branch` and the main checkout end on. Defaults to the last.
   * Later commits stay reachable only through `extraBranches`.
   */
  checkoutIndex?: number;
  /** Extra branches to point at commits, as `{ name: commitIndex }`. */
  extraBranches?: Record<string, number>;
}

/**
 * Environment for every fixture git command: no global/system config, no
 * inherited `GIT_*` overrides (for example `GIT_DIR` set by a hook that is
 * running the test suite), and a fixed identity.
 */
function isolatedGitEnv(epochSeconds: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  // The child needs the caller's PATH/HOME; this filters, never configures.
  // eslint-disable-next-line no-restricted-syntax
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) env[key] = value;
  }
  const date = `${epochSeconds} +0000`;
  return {
    ...env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: FIXED_IDENTITY.name,
    GIT_AUTHOR_EMAIL: FIXED_IDENTITY.email,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_NAME: FIXED_IDENTITY.name,
    GIT_COMMITTER_EMAIL: FIXED_IDENTITY.email,
    GIT_COMMITTER_DATE: date,
  };
}

function git(
  root: string,
  args: string[],
  epochSeconds = FIXED_EPOCH_SECONDS,
): string {
  try {
    return execFileSync(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'core.autocrlf=false',
        '-C',
        root,
        ...args,
      ],
      {
        encoding: 'utf8',
        env: isolatedGitEnv(epochSeconds),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.trim();
    throw new Error(
      `git ${args.join(' ')} failed in ${root}${stderr ? `: ${stderr}` : ''}`,
      { cause: err },
    );
  }
}

function replaceWorkingTree(root: string, tree: string): void {
  for (const entry of readdirSync(root)) {
    if (entry !== '.git') {
      rmSync(join(root, entry), { recursive: true, force: true });
    }
  }
  for (const entry of readdirSync(tree, { withFileTypes: true })) {
    cpSync(join(tree, entry.name), join(root, entry.name), {
      recursive: entry.isDirectory(),
      errorOnExist: true,
      force: false,
    });
  }
}

/**
 * Build a linear history in `root` and return the full commit id of each
 * commit, in order.
 *
 * @throws if `root` is not empty, a tree is missing, a commit would be empty,
 *   or git produces anything but a full SHA-1 object id.
 */
export function buildGitFixtureRepo(
  options: BuildGitFixtureRepoOptions,
): string[] {
  const { root, commits } = options;
  const branch = options.branch ?? 'main';
  const checkoutIndex = options.checkoutIndex ?? commits.length - 1;
  if (commits.length === 0) {
    throw new Error('buildGitFixtureRepo requires at least one commit');
  }
  if (checkoutIndex < 0 || checkoutIndex >= commits.length) {
    throw new Error(`checkoutIndex ${checkoutIndex} is out of range`);
  }
  mkdirSync(root, { recursive: true });
  if (readdirSync(root).length > 0) {
    throw new Error(`git fixture root ${root} must be empty`);
  }

  git(root, ['init', '--quiet', '--template=', '--initial-branch', branch]);
  for (const [key, value] of [
    ['user.name', FIXED_IDENTITY.name],
    ['user.email', FIXED_IDENTITY.email],
    ['commit.gpgsign', 'false'],
    ['tag.gpgsign', 'false'],
  ]) {
    git(root, ['config', '--local', key, value]);
  }

  const oids = commits.map((commit, index) => {
    if (!existsSync(commit.tree)) {
      throw new Error(`git fixture tree ${commit.tree} is missing`);
    }
    replaceWorkingTree(root, commit.tree);
    // `--force` so a fixture `.gitignore` cannot silently drop tree files.
    git(root, ['add', '--all', '--force']);
    const epoch = FIXED_EPOCH_SECONDS + index * 60;
    git(
      root,
      ['commit', '--quiet', '--no-verify', '-m', commit.message],
      epoch,
    );
    const oid = git(root, ['rev-parse', 'HEAD']).trim();
    if (!FULL_OBJECT_ID.test(oid)) {
      throw new Error(`git fixture commit id ${oid} is not a full SHA-1`);
    }
    return oid;
  });

  for (const [name, index] of Object.entries(options.extraBranches ?? {})) {
    const oid = oids[index];
    if (!oid) throw new Error(`extra branch ${name} index is out of range`);
    git(root, ['branch', name, oid]);
  }
  if (checkoutIndex !== commits.length - 1) {
    git(root, ['reset', '--quiet', '--hard', oids[checkoutIndex]]);
  }
  return oids;
}
